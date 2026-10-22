/*
 * Two papers compared. The failure that matters here is a false pairing: two
 * different works shown as one, with each paper's sentence quoted beside the other's
 * as if they were about the same thing. So most of these check what must *not* match.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { compare, fold } from "../lib/compare.ts";
import type { Dossier } from "../lib/dossier.ts";

type Ref = { key: string; title: string; arxivId?: string };
type Edge = { key: string; stance: string; title: string; arxivId?: string };

function paper(id: string, title: string, refs: Ref[], edges: Edge[] = []): Dossier {
  return {
    id,
    title,
    references: refs.map((r) => ({
      key: r.key, raw: r.title, authors: "", title: r.title, venue: "", year: null,
      arxivId: r.arxivId ?? null, doi: null,
    })),
    lineage: {
      tally: {}, foundation: null,
      edges: edges.map((e) => ({
        key: e.key, stance: e.stance, cue: "we use", sentence: `About ${e.title}.`,
        section: "Method", sectionKind: "method", title: e.title, authors: "",
        year: null, arxivId: e.arxivId ?? null, inCorpus: false, anchor: null,
      })),
    },
  } as unknown as Dossier;
}

const ADAM = "Adam: A method for stochastic optimization";
const LN = "Layer normalization for recurrent networks";
const DROPOUT = "Dropout: a simple way to prevent overfitting";

test("titles fold the way the engine folds them", () => {
  assert.equal(fold("Attention Is All You Need"), fold("attention is all you need"));
  assert.equal(fold("Déjà vu: a study"), "deja vu a study");
});

test("a work matches on its arXiv id even when the titles are written differently", () => {
  const a = paper("A", "Paper A", [{ key: "k1", title: "Adam", arxivId: "1412.6980" }]);
  const b = paper("B", "Paper B", [{ key: "x", title: ADAM, arxivId: "1412.6980" }]);
  assert.equal(compare(a, b).alsoBothCite.length, 1);
});

test("a short title is not an identity on its own", () => {
  // "Adam" folded matches every bibliography that abbreviates it; without an id
  // it must not pair two references.
  const a = paper("A", "Paper A", [{ key: "k1", title: "Adam 2014" }]);
  const b = paper("B", "Paper B", [{ key: "x", title: "Adam 2014" }]);
  const result = compare(a, b);
  assert.equal(
    result.alsoBothCite.length + result.bothStandOn.length + result.partWays.length,
    0,
  );
});

test("stances sort a shared work into where the papers agree or part", () => {
  const a = paper(
    "A", "Paper A",
    [{ key: "a1", title: LN }, { key: "a2", title: ADAM }, { key: "a3", title: DROPOUT }],
    [{ key: "a1", stance: "inherits", title: LN }, { key: "a2", stance: "inherits", title: ADAM }],
  );
  const b = paper(
    "B", "Paper B",
    [{ key: "b1", title: LN }, { key: "b2", title: ADAM }, { key: "b3", title: DROPOUT }],
    [{ key: "b1", stance: "extends", title: LN }, { key: "b2", stance: "contests", title: ADAM }],
  );
  const result = compare(a, b);
  assert.deepEqual(result.bothStandOn.map((s) => s.title), [LN]);
  assert.deepEqual(result.partWays.map((s) => s.title), [ADAM]);
  assert.deepEqual(result.alsoBothCite.map((s) => s.title), [DROPOUT]);
});

test("what each paper says about the other is kept apart from what they share", () => {
  const a = paper(
    "1810.04805", "BERT: Pre-training of deep bidirectional transformers",
    [{ key: "vaswani", title: "Attention is all you need", arxivId: "1706.03762" }],
    [{ key: "vaswani", stance: "inherits", title: "Attention is all you need", arxivId: "1706.03762" }],
  );
  const b = paper("1706.03762", "Attention Is All You Need", []);
  const result = compare(a, b);
  assert.equal(result.aOnB.length, 1);
  assert.equal(result.bOnA.length, 0);
  // The other paper is not also listed as a work they "both cite".
  assert.equal(result.alsoBothCite.length, 0);
});
