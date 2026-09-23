/*
 * The geometry, checked. Everything here is arithmetic on rectangles, which is exactly
 * the kind of code that is silently wrong: a highlight off by a line still looks like a
 * highlight, and a link between a mark and a reading that is subtly too eager attaches
 * Keystone's opinion to a sentence the reader never touched.
 *
 * Run with `node --test test/` from apps/web. Type annotations are stripped by Node
 * itself; `lib/marks.ts` imports only types from elsewhere, so there is nothing to
 * resolve and no build step.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  condense,
  inOrder,
  overlaps,
  parseMark,
  readingsFor,
  SAME_WORDS,
} from "../lib/marks.ts";

const rect = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

const mark = (page: number, rects: { x0: number; y0: number; x1: number; y1: number }[]) => ({
  id: "abcd1234",
  page,
  rects,
  quote: "",
  colour: "brass" as const,
  note: "",
  at: 0,
  edited: 0,
});

test("a line of word-runs becomes one bar", () => {
  // What getClientRects actually hands back for "we propose a new simple network":
  // one rectangle per span, small gaps between words, all on the same baseline.
  const out = condense([
    rect(100, 200, 118, 210),
    rect(121, 200, 160, 210),
    rect(163, 201, 172, 209),
    rect(175, 200, 220, 210),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], rect(100, 200, 220, 210));
});

test("two lines stay two bars", () => {
  const out = condense([
    rect(100, 200, 220, 210),
    rect(100, 213, 190, 223),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].y0, 200);
  assert.equal(out[1].y0, 213);
});

test("a superscript joins its own line, not the one above", () => {
  const out = condense([
    rect(100, 200, 140, 210),
    rect(141, 197, 146, 204), // superscript: overlaps the line's upper half
    rect(147, 200, 200, 210),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].y0, 197, "the line grows to hold the superscript");
  assert.equal(out[0].y1, 210);
});

test("a column gutter is not bridged", () => {
  // Two columns of a two-column paper on the same line. The gap is many times the
  // line height, so unioning them would paint over the whole page width.
  const out = condense([rect(70, 300, 280, 310), rect(320, 300, 530, 310)]);
  assert.equal(out.length, 2);
});

test("overlapping slivers do not produce a darker band", () => {
  // pdf.js sometimes reports spans that overlap by a fraction of a point.
  const out = condense([rect(100, 200, 150.4, 210), rect(150, 200, 200, 210)]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], rect(100, 200, 200, 210));
});

test("zero-height and inverted rectangles are dropped", () => {
  assert.deepEqual(condense([rect(100, 200, 100, 200)]), []);
  assert.deepEqual(condense([rect(200, 200, 100, 190)]), []);
  assert.deepEqual(condense([]), []);
});

test("a phrase inside a sentence scores as the same words", () => {
  const phrase = mark(3, [rect(120, 300, 180, 310)]);
  const sentence = { anchor: { page: 3, pageWidth: 612, pageHeight: 792, precision: "exact_strict", rects: [rect(70, 299, 540, 311)] } };
  assert.ok(overlaps(phrase, sentence.anchor) > 0.95);
  assert.deepEqual(readingsFor(phrase, [sentence]), [sentence]);
});

test("a neighbour on the same line is not the same words", () => {
  // The failure a line-based test would make: same y, different x.
  const left = mark(3, [rect(70, 300, 280, 310)]);
  const right = { anchor: { page: 3, pageWidth: 612, pageHeight: 792, precision: "exact_strict", rects: [rect(320, 300, 530, 310)] } };
  assert.equal(overlaps(left, right.anchor), 0);
  assert.deepEqual(readingsFor(left, [right]), []);
});

test("a descender clipping the line below does not link it", () => {
  const below = mark(3, [rect(70, 312, 540, 324)]);
  const above = { anchor: { page: 3, pageWidth: 612, pageHeight: 792, precision: "exact_strict", rects: [rect(70, 300, 540, 313)] } };
  assert.ok(overlaps(below, above.anchor) < SAME_WORDS);
  assert.deepEqual(readingsFor(below, [above]), []);
});

test("the same words on another page are not the same words", () => {
  const here = mark(3, [rect(120, 300, 180, 310)]);
  const there = { anchor: { page: 4, pageWidth: 612, pageHeight: 792, precision: "exact_strict", rects: [rect(120, 300, 180, 310)] } };
  assert.equal(overlaps(here, there.anchor), 0);
});

test("readings come back best first", () => {
  const spanning = mark(1, [rect(70, 300, 540, 340)]);
  const partial = { name: "partial", anchor: { page: 1, pageWidth: 612, pageHeight: 792, precision: "fuzzy", rects: [rect(70, 296, 540, 306)] } };
  const inside = { name: "inside", anchor: { page: 1, pageWidth: 612, pageHeight: 792, precision: "exact_strict", rects: [rect(100, 310, 300, 320)] } };
  assert.deepEqual(
    readingsFor(spanning, [partial, inside]).map((r) => r.name),
    ["inside", "partial"],
  );
});

test("an unanchored reading links to nothing", () => {
  assert.equal(overlaps(mark(0, [rect(1, 1, 2, 2)]), null), 0);
});

test("a mark from the wire is rejected unless every field holds", () => {
  const good = { id: "abcd1234", page: 2, rects: [rect(10, 10, 20, 20)], quote: "x", colour: "moss", note: "", at: 1, edited: 1 };
  assert.equal(parseMark(good)?.colour, "moss");
  assert.equal(parseMark({ ...good, id: "../etc" }), null, "ids become store keys");
  assert.equal(parseMark({ ...good, page: -1 }), null);
  assert.equal(parseMark({ ...good, rects: [] }), null, "a mark with no rectangles marks nothing");
  assert.equal(parseMark({ ...good, rects: [rect(0, 0, 0, 0)] }), null);
  assert.equal(parseMark({ ...good, colour: "chartreuse" })?.colour, "brass");
  assert.equal(parseMark({ ...good, note: "z".repeat(99_999) })?.note.length, 4_000);
  assert.equal(parseMark(null), null);
  assert.equal(parseMark("a mark, honestly"), null);
});

test("a mark missing edited inherits its creation time", () => {
  const parsed = parseMark({ id: "abcd1234", page: 0, rects: [rect(1, 1, 9, 9)], at: 42 });
  assert.equal(parsed?.edited, 42);
});

test("marks list in reading order", () => {
  const out = inOrder([
    { ...mark(2, [rect(70, 100, 200, 110)]), id: "third" },
    { ...mark(0, [rect(300, 400, 400, 410)]), id: "second" },
    { ...mark(0, [rect(70, 100, 200, 110)]), id: "first" },
  ]);
  assert.deepEqual(out.map((m) => m.id), ["first", "second", "third"]);
});
