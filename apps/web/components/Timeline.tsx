"use client";

/*
 * The library in the order it happened.
 *
 * The force graph answers "what leans on what". It cannot answer "when", and when is
 * most of what a literature is: a method appears, three papers adopt it over the next
 * eighteen months, and something replaces it. Laid out on a time axis with the
 * adoption edges drawn across it, that shape is visible at a glance and it is not
 * visible any other way this site presents the data.
 *
 * SVG, for the same reason the force graph is SVG: this is a thing whose job is to be
 * clicked.
 *
 * Edges are drawn from the citing paper back to the work it adopts, so every arc
 * should lean left. Three of them do not, and those are not errors — arXiv dates a
 * paper by its v1, and a paper can cite a work whose v1 landed after its own. They
 * are drawn as they are and counted in the caption rather than hidden.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import type { IndexEntry, LibraryGraph as GraphData } from "@/lib/dossier";

const WIDTH = 1000;
const PAD_LEFT = 54;
const PAD_RIGHT = 24;
const TOP = 34;
const LANE = 21;

/*
 * A label's length, and the room a lane must leave for it.
 *
 * These two are one decision written twice, and the first version got it wrong: it
 * truncated at 34 characters and spaced lanes 118 units apart, which measured out as
 * 35 overlapping pairs across the chart — every cluster of papers was a smear.
 *
 * At this font a character is about 5.2 units, so the gap is the widest a label can
 * be plus the dot and its offset. If either number changes the other has to.
 */
const LABEL_CHARS = 26;
const LANE_GAP = LABEL_CHARS * 5.2 + 16;

interface Placed {
  id: string;
  title: string;
  year: number;
  /** Fractional year, so two papers three months apart do not collide. */
  at: number;
  x: number;
  y: number;
  stands: number;
}

function published(paper: IndexEntry): string {
  return paper.arxiv?.published ?? "";
}

/** Fractional year from an ISO date: 2017-06-12 → 2017.44. */
function moment(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NaN;
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return year + (date.getTime() - start) / (end - start);
}

export function Timeline({
  index,
  graph,
}: {
  index: IndexEntry[];
  graph: GraphData;
}) {
  const [focus, setFocus] = useState<string | null>(null);

  const { placed, byId, years, height, span } = useMemo(() => {
    const dated = index
      .map((paper) => ({ paper, at: moment(published(paper)) }))
      .filter((row) => Number.isFinite(row.at))
      .sort((a, b) => a.at - b.at);

    if (dated.length === 0) {
      return { placed: [] as Placed[], byId: new Map<string, Placed>(), years: [] as number[], height: 200, span: [0, 1] as [number, number] };
    }

    const first = Math.floor(dated[0].at);
    const last = Math.ceil(dated[dated.length - 1].at);
    const usable = WIDTH - PAD_LEFT - PAD_RIGHT;
    const xOf = (at: number) => PAD_LEFT + ((at - first) / (last - first)) * usable;

    /*
     * Lanes, assigned greedily by how close the previous paper in that lane is.
     *
     * Papers cluster hard — thirteen of these are from 2021 — so placing each one at
     * its true date on a single line would overlap most of the library into a smear.
     * A paper takes the topmost lane whose last occupant is far enough left to leave
     * room for a label, which keeps the x position honest and moves only y.
     */
    const lastX: number[] = [];
    const out: Placed[] = [];
    for (const { paper, at } of dated) {
      const x = xOf(at);
      let lane = lastX.findIndex((taken) => x - taken > LANE_GAP);
      if (lane === -1) lane = lastX.length;
      lastX[lane] = x;
      out.push({
        id: paper.id,
        title: paper.title,
        year: Math.floor(at),
        at,
        x,
        y: TOP + lane * LANE,
        stands: (paper.lineage?.inherits ?? 0) + (paper.lineage?.extends ?? 0),
      });
    }

    const lanes = lastX.length;
    return {
      placed: out,
      byId: new Map(out.map((row) => [row.id, row])),
      years: Array.from({ length: last - first + 1 }, (_, i) => first + i),
      height: TOP + lanes * LANE + 46,
      span: [first, last] as [number, number],
    };
  }, [index]);

  // Adoption only. Drawing all five stances at once produced a solid wash; what a
  // reader wants from a time axis is the inheritance, and disputes have their own page.
  const edges = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.stance === "inherits" || edge.stance === "extends")
        .map((edge) => ({ edge, from: byId.get(edge.from), to: byId.get(edge.to) }))
        .filter((row) => row.from && row.to) as {
        edge: GraphData["edges"][number];
        from: Placed;
        to: Placed;
      }[],
    [graph, byId],
  );

  const forwards = edges.filter((row) => row.to.at > row.from.at).length;
  const xAt = (year: number) =>
    PAD_LEFT + ((year - span[0]) / (span[1] - span[0])) * (WIDTH - PAD_LEFT - PAD_RIGHT);

  const lit = (id: string) =>
    !focus ||
    focus === id ||
    edges.some(
      ({ edge }) =>
        (edge.from === focus && edge.to === id) || (edge.to === focus && edge.from === id),
    );

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        style={{ maxHeight: "none" }}
        role="img"
        aria-label="The library's papers on a time axis, with the works each one adopts"
      >
        {/* The years, behind everything. */}
        {years.map((year) => (
          <g key={year}>
            <line
              x1={xAt(year)}
              y1={TOP - 16}
              x2={xAt(year)}
              y2={height - 30}
              stroke="var(--color-paper-edge)"
              strokeWidth={1}
            />
            <text
              x={xAt(year)}
              y={height - 14}
              textAnchor="middle"
              className="numeral"
              fontSize={11}
              fill="var(--color-ink-faint)"
            >
              {year}
            </text>
          </g>
        ))}

        {edges.map(({ edge, from, to }, i) => {
          // A quadratic bow, deeper for a longer reach, so parallel arcs separate.
          const midX = (from.x + to.x) / 2;
          const bow = Math.min(46, 10 + Math.abs(from.x - to.x) * 0.16);
          const midY = Math.min(from.y, to.y) - bow;
          const on = !focus || focus === edge.from || focus === edge.to;
          return (
            <path
              key={`${edge.from}-${edge.to}-${i}`}
              d={`M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`}
              fill="none"
              stroke="var(--color-brass)"
              strokeWidth={focus && on ? 1.4 : 0.7}
              opacity={on ? (focus ? 0.85 : 0.28) : 0.05}
              style={{ transition: "opacity 200ms, stroke-width 200ms" }}
            />
          );
        })}

        {placed.map((paper) => {
          const on = lit(paper.id);
          return (
            <Link key={paper.id} href={`/paper/${paper.id}`}>
              <g
                onMouseEnter={() => setFocus(paper.id)}
                onMouseLeave={() => setFocus(null)}
                style={{ cursor: "pointer", transition: "opacity 200ms" }}
                opacity={on ? 1 : 0.22}
              >
                {/* A wide invisible target: the dot is 3px and a reader should not
                    have to hit 3px to read a title. */}
                <circle cx={paper.x} cy={paper.y} r={11} fill="transparent" />
                <circle
                  cx={paper.x}
                  cy={paper.y}
                  r={focus === paper.id ? 4.4 : 3}
                  fill={
                    paper.stands > 0 ? "var(--color-brass)" : "var(--color-ink-faint)"
                  }
                  style={{ transition: "r 150ms" }}
                />
                <text
                  x={paper.x + 7}
                  y={paper.y + 3.5}
                  fontSize={10.5}
                  fill={
                    focus === paper.id ? "var(--color-brass)" : "var(--color-ink-soft)"
                  }
                >
                  {paper.title.length > LABEL_CHARS
                    ? `${paper.title.slice(0, LABEL_CHARS - 1)}…`
                    : paper.title}
                </text>
                {/* The full title, for the truncated ones. A chart this dense has to
                    abbreviate; it does not have to hide. */}
                <title>{paper.title}</title>
              </g>
            </Link>
          );
        })}
      </svg>

      <figcaption className="mt-4 max-w-2xl text-[0.84rem] leading-relaxed text-ink-faint">
        Each dot is a paper, at the date arXiv holds for its first version. Each arc
        runs from a paper to a work it adopts or extends, so arcs lean back in time
        &mdash;{" "}
        <span className="numeral">{edges.length}</span> of them.
        {forwards > 0 ? (
          <>
            {" "}
            <span className="numeral">{forwards}</span> lean forward instead, which is
            not an error: arXiv dates a paper by its v1, and a paper can cite work
            whose first version landed after its own.
          </>
        ) : null}{" "}
        Hover a paper to see only what it leans on.
      </figcaption>
    </figure>
  );
}
