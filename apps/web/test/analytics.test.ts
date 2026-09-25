/*
 * Funnels and paths, which are the part of this that can be silently wrong.
 *
 * A counter that is off is visible; a funnel that counts a visitor at step three who
 * never did step two looks exactly like a good funnel and tells you to build the
 * wrong thing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { commonPaths, funnel, referrerHost, sessionsOf, type Step } from "../lib/analytics.ts";

const at = (s: string, n: string, t: number, label?: string): Step => ({ s, n, t, label });

test("steps are grouped into sessions, newest visit first", () => {
  const sessions = sessionsOf([
    at("a", "view", 1_000, "/"),
    at("b", "view", 5_000, "/news"),
    at("a", "paper.open", 3_000, "1706.03762"),
  ]);
  assert.deepEqual(sessions.map((s) => s.id), ["b", "a"]);
  assert.deepEqual(sessions[1].steps.map((s) => s.n), ["view", "paper.open"]);
  assert.equal(sessions[1].seconds, 2);
});

test("a funnel counts only sessions that reached every earlier stage", () => {
  const sessions = sessionsOf([
    // Landed, searched, opened — completes.
    at("a", "view", 1, "/"), at("a", "search", 2), at("a", "paper.open", 3),
    // Landed, opened, never searched — stops at stage one.
    at("b", "view", 1, "/"), at("b", "paper.open", 2),
    // Landed only.
    at("c", "view", 1, "/"),
  ]);
  assert.deepEqual(funnel(sessions, ["view", "search", "paper.open"]), [3, 1, 1]);
});

test("a funnel respects order, not mere presence", () => {
  // Opened a paper and *then* searched: has both events, completed nothing.
  const sessions = sessionsOf([
    at("a", "view", 1, "/"), at("a", "paper.open", 2), at("a", "search", 3),
  ]);
  assert.deepEqual(funnel(sessions, ["view", "search", "paper.open"]), [1, 1, 0]);
});

test("a stage matches its own sub-events", () => {
  // paper.ingest is a kind of paper event; a funnel on "paper" should catch it.
  const sessions = sessionsOf([at("a", "view", 1), at("a", "paper.ingest", 2)]);
  assert.deepEqual(funnel(sessions, ["view", "paper"]), [1, 1]);
});

test("paths collapse repeats and stop at the requested depth", () => {
  const sessions = sessionsOf([
    at("a", "view", 1, "/"), at("a", "view", 2, "/"), at("a", "view", 3, "/news"), at("a", "search", 4),
    at("b", "view", 1, "/"), at("b", "view", 2, "/news"), at("b", "search", 3),
  ]);
  const paths = commonPaths(sessions, 3);
  assert.equal(paths[0].path, "view / → view /news → search");
  assert.equal(paths[0].n, 2, "the repeated view of / must not make these two paths");
});

test("a referrer is reduced to a host, and our own is not a referrer", () => {
  assert.equal(referrerHost("https://news.ycombinator.com/item?id=1", "keystone.app"), "news.ycombinator.com");
  assert.equal(referrerHost("https://www.google.com/search?q=secret", "keystone.app"), "google.com");
  assert.equal(referrerHost("https://keystone.app/news", "keystone.app"), "direct");
  assert.equal(referrerHost(null, "keystone.app"), "direct");
  assert.equal(referrerHost("not a url", "keystone.app"), "direct");
});

test("a referrer never carries the path or the query", () => {
  // The search terms someone used to find the site are theirs, not ours.
  const host = referrerHost("https://www.google.com/search?q=who+am+i", "keystone.app");
  assert.ok(!host.includes("q="), host);
  assert.ok(!host.includes("/"), host);
});
