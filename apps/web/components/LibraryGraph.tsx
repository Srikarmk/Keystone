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
const HEIGHT = 380;
const PAD_X = 96;
const PAD_Y = 52;
const ROWS = 4;

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
function layout(data: GraphData): Placed[] {
  const dated = [...data.nodes]
    .map((node) => ({ node, at: posted(node.id) }))
    .sort((a, b) => a.at - b.at);

  const earliest = dated[0]?.at ?? 0;
  const latest = dated[dated.length - 1]?.at ?? earliest + 1;
  const span = Math.max(1, latest - earliest);

  // Rows cycle so that papers close together in time are never on the same line.
  // Labels alternate above and below their node for the same reason.
  return dated.map(({ node, at }, i) => ({
    id: node.id,
    title: node.title,
    short: shorten(node.title),
    x: PAD_X + ((at - earliest) / span) * (WIDTH - PAD_X * 2),
    y: PAD_Y + ((i % ROWS) / (ROWS - 1)) * (HEIGHT - PAD_Y * 2),
    above: i % 2 === 0,
    bare: node.bare,
  }));
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
  const nodes = useMemo(() => layout(data), [data]);
  const [active, setActive] = useState<number | null>(null);
  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  if (nodes.length === 0) return null;
  const shown = active === null ? null : data.edges[active];

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`${nodes.length} papers and ${data.edges.length} relationships between them, read from their own prose`}
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

        {data.edges.map((edge, i) => {
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
            {data.edges.length} of these relationships run between papers in this
            library. Hover one to read the sentence that put it there.
          </p>
        )}
      </div>
    </div>
  );
}
