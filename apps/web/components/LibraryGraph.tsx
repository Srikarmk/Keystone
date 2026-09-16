"use client";

/*
 * The library as a field: papers as nodes, what they say about each other as edges.
 *
 * This is the thing the arch was gesturing at and could not deliver. The arch encoded
 * one number and cost a whole column to do it. This encodes seven real relationships
 * recovered from nine papers' own prose — VGG to ResNet to the Transformer to BERT and
 * ViT, with batch and layer normalisation feeding in — and every edge carries the
 * sentence that put it there.
 *
 * SVG rather than WebGL, for the reason the reader learned the hard way: this thing's
 * whole job is to be clicked, and canvas picking against a drifting camera loses the
 * raycast between pointer-down and pointer-up.
 */

import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { LibraryGraph as GraphData, Stance } from "@/lib/dossier";

const WIDTH = 940;
const PAD_X = 96;
const PAD_Y = 52;

/**
 * Rows, and therefore height, grow with the number of papers being drawn.
 *
 * Fixed at four rows the graph was fine for nine papers and illegible for forty:
 * every extra paper went onto an existing line and labels piled on top of each
 * other. Roughly four papers per row keeps the spacing about constant as the library
 * grows, and the cap stops a very large library from becoming a tall ribbon.
 */
function rowsFor(count: number): number {
  return Math.max(3, Math.min(9, Math.ceil(count / 4)));
}

const ROW_HEIGHT = 76;

const TONE: Record<Stance, string> = {
  inherits: "var(--color-brass)",
  extends: "var(--color-brass)",
  contests: "var(--color-missing)",
  compares: "var(--color-ink-faint)",
  background: "var(--color-ink-faint)",
};

const VERB: Record<Stance, string> = {
  inherits: "adopts",
  extends: "extends",
  contests: "disputes",
  compares: "measures against",
  background: "mentions",
};

interface Placed {
  id: string;
  title: string;
  short: string;
  x: number;
  y: number;
  above: boolean;
  bare: number;
}

/**
 * An arXiv identifier's first four digits are the year and month it was posted, so
 * the library has an exact date for every paper without a lookup.
 */
function posted(id: string): number {
  const match = /^(\d{2})(\d{2})\./.exec(id);
  if (!match) return 0;
  return Number(match[1]) * 12 + Number(match[2]);
}

/**
 * Lay the papers out along time.
 *
 * The first version arranged them by inheritance depth, which put six of nine papers
 * in one column with their labels overlapping and clipped at both edges. Time is the
 * better axis and it is free: every dependency arrow then points backwards along it,
 * which is both true and immediately legible — you can see the field being built.
 */
/**
 * How many papers the picture can name at once.
 *
 * A node label is about 150px of a 940-unit viewBox, so past roughly this many the
 * labels collide no matter how the rows are arranged. Fading the ones you are not
 * hovering was tried first and is worse: at rest the hero becomes a field of
 * anonymous dots.
 */
const LEGIBLE = 20;

function layout(data: GraphData): { nodes: Placed[]; height: number; hidden: number } {
  // Only papers that take part in a relationship are drawn. A node with no edges
  // contributes nothing to a graph and costs a label slot, and once the library grew
  // past a dozen papers the unconnected ones were most of the picture. They are
  // counted underneath and listed in full further down the page.
  const degree = new Map<string, number>();
  for (const edge of data.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  // Past what can be labelled, keep the best-connected papers rather than an
  // arbitrary slice. Those are the load-bearing ones — the papers everything else
  // leans on — which is exactly what the picture is for.
  const connected = new Set(
    [...degree.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, LEGIBLE)
      .map(([id]) => id),
  );

  const dated = data.nodes
    .filter((node) => connected.has(node.id))
    .map((node) => ({ node, at: posted(node.id) }))
    .sort((a, b) => a.at - b.at);

  const rows = rowsFor(dated.length);
  const height = PAD_Y * 2 + (rows - 1) * ROW_HEIGHT;
  const last = Math.max(1, dated.length - 1);

  // Spaced by position in the ordering rather than by the actual date. Literal time
  // piled 2014-2016 into the left third and left the right half nearly empty, because
  // that is genuinely when this work happened — true, and unreadable. Rank keeps the
  // claim ("every arrow points back at what it took") and spreads the labels.
  //
  // Rows cycle so papers adjacent in time are never on the same line, and labels
  // alternate above and below their node for the same reason.
  const nodes = dated.map(({ node }, i) => ({
    id: node.id,
    title: node.title,
    short: shorten(node.title),
    x: PAD_X + (i / last) * (WIDTH - PAD_X * 2),
    y: PAD_Y + (i % rows) * ROW_HEIGHT,
    above: i % 2 === 0,
    bare: node.bare,
  }));

  return { nodes, height, hidden: degree.size - dated.length };
}

/**
 * Paper titles are long; a graph node needs a handle.
 *
 * Most ML papers put a name before the colon ("BERT: Pre-training of...") and the
 * ones that do not are known by their opening words, so the head of the title is the
 * right thing to keep.
 */
function shorten(title: string): string {
  const head = title.split(":")[0].trim();
  if (head.length <= 26) return head;
  const words = head.split(/\s+/);
  let out = words[0];
  for (const word of words.slice(1)) {
    const next = `${out} ${word}`;
    // Take the word that crosses the limit when it still fits in 30: "Very Deep..."
    // names nothing, where "Very Deep Convolutional..." is unmistakable.
    if (next.length > 26 && (out.length >= 20 || next.length > 30)) break;
    out = next;
  }
  return out === head ? head : `${out}\u2026`;
}

export function LibraryGraph({ data }: { data: GraphData }) {
  const { nodes, height, hidden } = useMemo(() => layout(data), [data]);
  const [active, setActive] = useState<number | null>(null);
  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  // Edges whose endpoints both survived the pruning, carrying their original index so
  // hovering still identifies the right one in `data.edges`.
  const edges = data.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => byId.has(edge.from) && byId.has(edge.to));

  if (nodes.length === 0) return null;
  const shown = active === null ? null : data.edges[active];

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${nodes.length} papers and ${edges.length} relationships between them, read from their own prose`}
      >
        <defs>
          <marker
            id="keystone-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 7 4 L 0 7 z" fill="context-stroke" />
          </marker>
        </defs>

        {edges.map(({ edge, index: i }) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          const dimmed = active !== null && active !== i;
          // Edges run backwards along the time axis, since a paper points at what it
          // took. Control points sit near each end rather than at the midpoint: a
          // midpoint control on widely separated rows overshoots into a tall loop
          // that crosses half the other papers on its way.
          const bend = Math.max(40, Math.abs(from.x - to.x) * 0.4);
          return (
            <g key={i}>
              <path
                d={`M ${from.x - 6} ${from.y} C ${from.x - bend} ${from.y}, ${to.x + bend} ${to.y}, ${to.x + 8} ${to.y}`}
                fill="none"
                stroke={TONE[edge.stance]}
                strokeWidth={active === i ? 2.6 : 1.5}
                strokeLinecap="round"
                markerEnd="url(#keystone-arrow)"
                className="ribbon"
                style={{
                  strokeDasharray: 1400,
                  strokeDashoffset: 1400,
                  animationDelay: `${0.25 + i * 0.09}s`,
                  opacity: dimmed ? 0.16 : active === i ? 1 : 0.55,
                  transition: "opacity 200ms ease, stroke-width 200ms ease",
                }}
              />
              {/* A wide invisible companion path: a 1.5px line is not a click target. */}
              <path
                d={`M ${from.x - 6} ${from.y} C ${from.x - bend} ${from.y}, ${to.x + bend} ${to.y}, ${to.x + 8} ${to.y}`}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                className="cursor-pointer"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                tabIndex={0}
                role="button"
                aria-label={`${byId.get(edge.from)?.title} ${VERB[edge.stance]} ${byId.get(edge.to)?.title}`}
              />
            </g>
          );
        })}

        {nodes.map((node, i) => {
          const touched =
            shown !== null && (shown.from === node.id || shown.to === node.id);
          return (
            <motion.g
              key={node.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 + i * 0.05, duration: 0.4 }}
            >
              <Link href={`/paper/${node.id}`}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={touched ? 6 : 4.5}
                  fill={touched ? "var(--color-brass)" : "var(--color-ink)"}
                  style={{ transition: "r 180ms ease, fill 180ms ease" }}
                />
                <text
                  x={node.x}
                  y={node.y + (node.above ? -14 : 25)}
                  textAnchor="middle"
                  // Below 13px labels stop being readable, so past about twenty papers
                  // they are thinned rather than shrunk: the hovered edge's two ends
                  // stay named and the rest fade to their dots.
                  opacity={shown !== null && !touched ? 0.35 : 1}
                  fontSize="13"
                  fill={touched ? "var(--color-brass)" : "var(--color-ink)"}
                  className="cursor-pointer"
                  style={{ transition: "fill 180ms ease" }}
                >
                  {node.short}
                </text>
                {node.bare > 0 ? (
                  <text
                    x={node.x}
                    y={node.y + (node.above ? 20 : -8)}
                    textAnchor="middle"
                    fontSize="10.5"
                    className="numeral"
                    fill="var(--color-ink-faint)"
                  >
                    {node.bare} bare
                  </text>
                ) : null}
              </Link>
            </motion.g>
          );
        })}
      </svg>

      {/* The sentence. An edge the reader cannot check is a diagram, not evidence. */}
      <div className="mt-2 min-h-[4.5rem] border-t border-paper-edge pt-3">
        {shown ? (
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <p className="text-[0.84rem]">
              <span style={{ color: TONE[shown.stance] }}>
                {byId.get(shown.from)?.short} {VERB[shown.stance]}{" "}
                {byId.get(shown.to)?.short}
              </span>
              <span className="text-ink-faint"> &middot; {shown.section}</span>
            </p>
            <p className="mt-1 text-[0.88rem] italic leading-relaxed text-ink-soft">
              &ldquo;{shown.sentence}&rdquo;
            </p>
          </motion.div>
        ) : (
          <p className="text-[0.84rem] leading-relaxed text-ink-faint">
            {data.edges.length} relationships run between papers in this library, in
            the order they were posted, so every arrow points back at what it took.
            Hover one to read the sentence that put it there.
            {hidden > 0 ? (
              <>
                {" "}
                Showing the <span className="numeral">{nodes.length}</span> best-connected
                papers; <span className="numeral">{hidden}</span> more have relationships
                too, and every paper is listed below.
              </>
            ) : null}
          </p>
        )}
      </div>
    </div>
  );
}
