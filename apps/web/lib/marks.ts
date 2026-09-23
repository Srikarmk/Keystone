/*
 * A reader's own marks on a paper: what they highlighted, and what they wrote about it.
 *
 * The one decision the rest of this rests on: a mark is stored in the *PDF's own
 * coordinate space* — points, origin top-left — which is exactly the space the anchor
 * layer already uses. Not CSS pixels, not a scroll offset, not a character offset into
 * the text layer.
 *
 * That costs one division at capture time and buys three things. A mark survives zoom,
 * a window resize and a different screen, because it was never recorded in screen
 * units. It survives a re-render of the text layer, because it does not name spans.
 * And it can be compared directly against what Keystone read, since both are
 * rectangles on the same page in the same units — which is why `overlapping` below is
 * twenty lines of geometry rather than a model call.
 */

import type { AnchorJson, AnchorRect } from "@/lib/dossier";

export const MARK_COLOURS = ["brass", "moss", "rose", "slate"] as const;
export type MarkColour = (typeof MARK_COLOURS)[number];

export interface Mark {
  /** Client-generated. Marks are per-reader, so there is nothing to collide with. */
  id: string;
  page: number;
  rects: AnchorRect[];
  /** The words as the PDF gave them, kept so a mark still says something in a list. */
  quote: string;
  colour: MarkColour;
  /** Empty when this is a highlight and nothing more. */
  note: string;
  at: number;
  edited: number;
}

//: Bounds, enforced at both ends — the browser that makes a mark and the route that
//: stores one. A page-wide selection is legitimate and produces a lot of rectangles;
//: a forged request is not, and the store should not be fillable from a fetch.
export const MAX_RECTS = 96;
export const MAX_QUOTE = 2_000;
export const MAX_NOTE = 4_000;
export const MAX_MARKS = 500;

const round = (value: number) => Math.round(value * 100) / 100;

/** Zero-area, inverted and absurd rectangles, gone before anything else looks at them. */
function sane(rect: AnchorRect): boolean {
  const width = rect.x1 - rect.x0;
  const height = rect.y1 - rect.y0;
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0.5 &&
    height > 0.5 &&
    rect.x0 >= -2 &&
    rect.y0 >= -2 &&
    width < 2_000 &&
    height < 2_000
  );
}

/**
 * The browser's per-span rectangles, condensed into one bar per line.
 *
 * `Range.getClientRects()` reports a rectangle for every text node the selection
 * touches, so a highlighted sentence arrives as twenty or thirty slivers: one per
 * word run, with seams between them and, where pdf.js splits a span, overlaps. Drawn
 * raw with a multiply blend those overlaps darken into stripes, and the seams make a
 * continuous sentence look like a dashed line.
 *
 * So: group by line, union each line horizontally, and let the line's tallest glyph
 * set its height. The gap test is relative to line height rather than absolute,
 * because the space between two words at 9pt and at 24pt are different numbers of
 * points but the same amount of "one space".
 */
export function condense(raw: AnchorRect[]): AnchorRect[] {
  const rects = raw.filter(sane);
  if (rects.length === 0) return [];

  // By vertical position first. Lines then come out in reading order for free.
  const sorted = [...rects].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: AnchorRect[][] = [];
  for (const rect of sorted) {
    const line = lines[lines.length - 1];
    if (line) {
      // Same line when the vertical overlap covers most of the shorter rectangle.
      // A superscript shares a line with its base; the line below does not.
      const top = Math.max(line[0].y0, rect.y0);
      const bottom = Math.min(Math.max(...line.map((r) => r.y1)), rect.y1);
      const shorter = Math.min(
        rect.y1 - rect.y0,
        Math.max(...line.map((r) => r.y1 - r.y0)),
      );
      if (bottom - top > shorter * 0.5) {
        line.push(rect);
        continue;
      }
    }
    lines.push([rect]);
  }

  const out: AnchorRect[] = [];
  for (const line of lines) {
    const height = Math.max(...line.map((r) => r.y1 - r.y0));
    const gap = Math.max(1.5, height * 0.6);
    let run: AnchorRect | null = null;
    for (const rect of [...line].sort((a, b) => a.x0 - b.x0)) {
      if (run && rect.x0 - run.x1 <= gap) {
        run.x1 = Math.max(run.x1, rect.x1);
        run.y0 = Math.min(run.y0, rect.y0);
        run.y1 = Math.max(run.y1, rect.y1);
        continue;
      }
      if (run) out.push(run);
      run = { ...rect };
    }
    if (run) out.push(run);
  }

  return out
    .slice(0, MAX_RECTS)
    .map((r) => ({ x0: round(r.x0), y0: round(r.y0), x1: round(r.x1), y1: round(r.y1) }));
}

function area(rect: AnchorRect): number {
  return Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0);
}

function intersection(a: AnchorRect, b: AnchorRect): number {
  const width = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Whether a mark and something Keystone read cover the same words.
 *
 * Scored against the *smaller* of the two areas, deliberately. A reading is a whole
 * sentence and a mark is often four words inside it, so intersection over union would
 * score that pair at 0.1 and call it unrelated when the reader has in fact underlined
 * part of the exact sentence the cue was found in. Over the smaller area it scores
 * near 1.0, which is the truth of it.
 *
 * Two sentences that merely share a line do not pass: they occupy different x ranges,
 * so the intersection is zero however close their y ranges are. That is the whole
 * reason this works on rectangles at all — a line test would confuse neighbours in a
 * two-column layout constantly.
 */
export function overlaps(mark: Mark, anchor: AnchorJson | null): number {
  if (!anchor || anchor.page !== mark.page) return 0;
  let best = 0;
  for (const one of mark.rects) {
    for (const other of anchor.rects) {
      const shared = intersection(one, other);
      if (shared <= 0) continue;
      const smaller = Math.min(area(one), area(other));
      if (smaller <= 0) continue;
      best = Math.max(best, shared / smaller);
    }
  }
  return best;
}

//: Half of the smaller rectangle. Below this it is usually a descender from the line
//: above clipping into a mark, which is not the reader pointing at anything.
export const SAME_WORDS = 0.5;

/** Readings whose words this mark covers, best overlap first. */
export function readingsFor<T extends { anchor: AnchorJson | null }>(
  mark: Mark,
  readings: T[],
): T[] {
  return readings
    .map((reading) => ({ reading, score: overlaps(mark, reading.anchor) }))
    .filter(({ score }) => score >= SAME_WORDS)
    .sort((a, b) => b.score - a.score)
    .map(({ reading }) => reading);
}

/** Field by field: this is data that left the building and came back. */
export function parseMark(raw: unknown): Mark | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.slice(0, 40) : "";
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
  const page = typeof value.page === "number" ? Math.round(value.page) : -1;
  if (!Number.isFinite(page) || page < 0 || page > 5_000) return null;
  const rects = Array.isArray(value.rects)
    ? value.rects.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const { x0, y0, x1, y1 } = entry as Record<string, unknown>;
        if (
          typeof x0 !== "number" ||
          typeof y0 !== "number" ||
          typeof x1 !== "number" ||
          typeof y1 !== "number"
        ) {
          return [];
        }
        const rect = { x0: round(x0), y0: round(y0), x1: round(x1), y1: round(y1) };
        return sane(rect) ? [rect] : [];
      })
    : [];
  if (rects.length === 0) return null;
  const colour = MARK_COLOURS.includes(value.colour as MarkColour)
    ? (value.colour as MarkColour)
    : "brass";
  const at = typeof value.at === "number" && Number.isFinite(value.at) ? value.at : 0;
  return {
    id,
    page,
    rects: rects.slice(0, MAX_RECTS),
    quote: typeof value.quote === "string" ? value.quote.slice(0, MAX_QUOTE) : "",
    colour,
    note: typeof value.note === "string" ? value.note.slice(0, MAX_NOTE) : "",
    at,
    edited:
      typeof value.edited === "number" && Number.isFinite(value.edited)
        ? value.edited
        : at,
  };
}

/** Reading order: page, then down the page, then across. */
export function inOrder(marks: Mark[]): Mark[] {
  return [...marks].sort(
    (a, b) =>
      a.page - b.page ||
      (a.rects[0]?.y0 ?? 0) - (b.rects[0]?.y0 ?? 0) ||
      (a.rects[0]?.x0 ?? 0) - (b.rects[0]?.x0 ?? 0),
  );
}
