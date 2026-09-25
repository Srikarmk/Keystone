/*
 * The feed parser, against the shapes the real sources actually send.
 *
 * A hand-written XML reader fails quietly: it returns fewer items, or a title with
 * markup in it, and the page still looks like a page. These fixtures are trimmed from
 * live responses — arXiv's RSS, a Hugo RSS feed, and a true Atom feed — so the three
 * shapes in the source list are each pinned.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { decode, newestFirst, parseFeed, plain, when, type Source } from "../lib/feeds.ts";

const papers: Source = { id: "cs.AI", name: "arXiv cs.AI", url: "x", kind: "papers", about: "" };
const writing: Source = { id: "blog", name: "A Blog", url: "x", kind: "writing", about: "" };

const ARXIV = `<rss><channel><item>
  <title>When Should Forecasting Agents Reason?</title>
  <link>https://arxiv.org/abs/2609.28475</link>
  <description>arXiv:2609.28475v1 Announce Type: new
Abstract: Forecasting agents increasingly combine language-model reasoning.</description>
  <pubDate>Thu, 25 Sep 2026 00:00:00 -0400</pubDate>
</item></channel></rss>`;

const HUGO = `<rss><channel><item>
  <title>Harness Engineering for Self-Improvement</title>
  <link>https://lilianweng.github.io/posts/2026-07-04-harness/</link>
  <pubDate>Sat, 04 Jul 2026 00:00:00 +0000</pubDate>
  <description>&lt;p&gt;The concept of &lt;strong&gt;recursive self-improvement&lt;/strong&gt; dates back.&lt;/p&gt;</description>
</item></channel></rss>`;

const ATOM = `<feed><entry>
  <title>Quoting John Gruber</title>
  <link href="https://simonwillison.net/2026/Sep/25/john-gruber/" rel="alternate"/>
  <published>2026-09-25T17:22:01+00:00</published>
  <summary type="html">&lt;blockquote&gt;&lt;p&gt;Muse is getting a lot of attention.&lt;/p&gt;&lt;/blockquote&gt;</summary>
</entry></feed>`;

test("an arXiv item keeps its identifier, so it can be read here", () => {
  const [item] = parseFeed(ARXIV, papers);
  assert.equal(item.arxivId, "2609.28475");
  assert.equal(item.link, "https://arxiv.org/abs/2609.28475");
  assert.equal(item.title, "When Should Forecasting Agents Reason?");
});

test("arXiv's own bookkeeping is stripped from the abstract", () => {
  const [item] = parseFeed(ARXIV, papers);
  // Not "arXiv:2609.28475v1 Announce Type: new Abstract: Forecasting…"
  assert.ok(item.summary.startsWith("Forecasting agents"), item.summary);
  assert.ok(!item.summary.includes("Announce Type"));
});

test("escaped HTML in a description becomes readable prose", () => {
  const [item] = parseFeed(HUGO, writing);
  assert.equal(
    item.summary,
    "The concept of recursive self-improvement dates back.",
  );
});

test("an Atom entry's alternate link and date are read", () => {
  const [item] = parseFeed(ATOM, writing);
  assert.equal(item.link, "https://simonwillison.net/2026/Sep/25/john-gruber/");
  assert.equal(item.published, "2026-09-25T17:22:01.000Z");
  assert.equal(item.summary, "Muse is getting a lot of attention.");
  assert.equal(item.arxivId, undefined);
});

test("RSS dates are parsed into ISO", () => {
  assert.equal(parseFeed(ARXIV, papers)[0].published, "2026-09-25T04:00:00.000Z");
});

test("a date that cannot be read is left empty, not guessed", () => {
  assert.equal(when("next Tuesday-ish"), "");
  assert.equal(when(""), "");
});

test("an item with no title or no link is dropped", () => {
  assert.deepEqual(parseFeed("<rss><item><title>No link</title></item></rss>", writing), []);
  assert.deepEqual(parseFeed("<rss><item><link>http://x</link></item></rss>", writing), []);
});

test("both container shapes are read from one document", () => {
  const mixed = ARXIV.replace("</channel></rss>", "") + ATOM.replace("<feed>", "");
  assert.equal(parseFeed(mixed, writing).length, 2);
});

test("entities, named and numeric", () => {
  assert.equal(decode("A &amp; B &#39;C&#39; &#x2014; D &hellip;"), "A & B 'C' — D …");
});

test("a long summary is cut with an ellipsis, not mid-entity", () => {
  const long = plain("x".repeat(500), 50);
  assert.equal(long.length, 50);
  assert.ok(long.endsWith("…"));
});

test("undated items sort last, not to 1970", () => {
  const order = newestFirst([
    { title: "no date", link: "a", published: "", summary: "", source: "s", sourceName: "S", kind: "writing" },
    { title: "older", link: "b", published: "2024-01-01T00:00:00.000Z", summary: "", source: "s", sourceName: "S", kind: "writing" },
    { title: "newer", link: "c", published: "2026-01-01T00:00:00.000Z", summary: "", source: "s", sourceName: "S", kind: "writing" },
  ]).map((i) => i.title);
  assert.deepEqual(order, ["newer", "older", "no date"]);
});
