"use client";

/*
 * The evidence map: every headline claim, and the table it rests on.
 *
 * This replaces the arch in the reader. The arch encoded one number and cost a whole
 * column to do it, and it could not be clicked reliably — the drifting camera moved
 * the scene between pointer-down and pointer-up, so the raycast landed on a different
 * stone or none at all. Canvas picking is the wrong tool for something whose whole
 * job is navigation.
 *
 * So this is SVG: crisp at any size, clickable with no raycast, keyboard reachable,
 * and it still animates. What it draws is the analysis itself — a ribbon from each
 * claim to the cell that evidences it, and a ribbon that frays into nothing for each
 * claim that could not be traced.
 */

import { useMemo } from "react";

import type { Claim } from "@/lib/dossier";
import { declaredAs, isDeclared, isSupported } from "@/lib/dossier";

/*
 * The chart is laid out in its own coordinate space and scaled to whatever width the
 * analysis column has. WIDTH therefore has to be close to the real rendered width or
 * the scaling works against the design: at 420 in a 555px column the height cap won
 * the aspect fit, so the whole map was drawn at 70% and floated in the middle of the
 * pane with empty air down both sides.
 */
const WIDTH = 560;
const PADDING = 16;
const CLAIM_X = 112;
const TABLE_X = WIDTH - 124;

/** Row pitch, tightened for papers with many claims so the map stays a map. */
function rowPitch(rows: number): number {
  if (rows <= 12) return 28;
  return Math.max(15, Math.floor(400 / rows));
}

export interface EvidenceMapProps {
  claims: Claim[];
  keystoneTable: string | null;
  selected: number | null;
  onSelect: (index: number) => void;
}

interface Node {
  claim: Claim;
  index: number;
  y: number;
  tableY: number | null;
  table: string | null;
  supported: boolean;
  declared: boolean;
  isKeystone: boolean;
}

export function EvidenceMap({ claims, keystoneTable, selected, onSelect }: EvidenceMapProps) {
  const { nodes, tables, height } = useMemo(() => {
    // Tables are ordered by how much they carry, so the keystone sits at the top and
    // the eye lands on the paper's load-bearing evidence first.
    const counts = new Map<string, number>();
    for (const claim of claims) {
      if (isSupported(claim.status) && claim.table) {
        counts.set(claim.table, (counts.get(claim.table) ?? 0) + 1);
      }
    }
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const row = rowPitch(Math.max(claims.length, ordered.length));
    const tableY = new Map(ordered.map((name, i) => [name, PADDING + i * row + row / 2]));

    const nodes: Node[] = claims.map((claim, index) => ({
      claim,
      index,
      y: PADDING + index * row + row / 2,
      table: claim.table,
      tableY: isSupported(claim.status) && claim.table ? (tableY.get(claim.table) ?? null) : null,
      supported: isSupported(claim.status),
      declared: isDeclared(claim.status),
      isKeystone: Boolean(claim.table && claim.table === keystoneTable),
    }));

    const rows = Math.max(claims.length, ordered.length);
    return {
      nodes,
      tables: ordered.map((name) => ({ name, y: tableY.get(name)!, count: counts.get(name)! })),
      height: PADDING * 2 + rows * row,
    };
  }, [claims, keystoneTable]);

  if (claims.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="w-full"
      role="img"
      aria-label={`${claims.length} headline claims and the tables they rest on`}
    >
      <defs>
        {/* The fray. An untraced claim's ribbon fades out along its own length rather
            than being dashed, because a dash pattern and the draw-on animation both
            drive stroke-dasharray and cannot share it.

            userSpaceOnUse, not the default objectBoundingBox: these stubs are exactly
            horizontal, so their bounding box has zero height and a proportional
            gradient degenerates to nothing — the stubs rendered invisible. */}
        <linearGradient
          id="keystone-fray"
          gradientUnits="userSpaceOnUse"
          x1={CLAIM_X}
          x2={(CLAIM_X + TABLE_X) / 2 + 10}
          y1={0}
          y2={0}
        >
          <stop offset="0%" stopColor="var(--color-missing)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--color-missing)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g>
        {nodes.map((node) => (
          <Ribbon
            key={node.index}
            node={node}
            active={selected === node.index}
            dimmed={selected !== null && selected !== node.index}
          />
        ))}
      </g>

      {nodes.map((node) => (
        <g
          key={`claim-${node.index}`}
          onClick={() => onSelect(node.index)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(node.index);
            }
          }}
          tabIndex={0}
          role="button"
          aria-label={`${node.claim.value}, ${
            node.supported
              ? `rests on ${node.table}`
              : node.declared
                ? `rests on ${declaredAs(node.claim.status)}`
                : "no evidence found"
          }`}
          className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-brass"
        >
          <rect
            x={4}
            y={node.y - 11}
            width={CLAIM_X - 14}
            height={22}
            rx={2}
            fill={selected === node.index ? "var(--color-paper-deep)" : "transparent"}
            stroke={selected === node.index ? "var(--color-brass)" : "transparent"}
            strokeWidth={1}
          />
          <text
            x={CLAIM_X - 18}
            y={node.y + 4}
            textAnchor="end"
            className="numeral"
            fontSize="13"
            fill={
              node.supported
                ? "var(--color-ink)"
                : node.declared
                  ? "var(--color-ink-soft)"
                  : "var(--color-missing)"
            }
          >
            {node.claim.value.length > 13
              ? `${node.claim.value.slice(0, 12)}…`
              : node.claim.value}
          </text>
        </g>
      ))}

      {tables.map((table) => (
        <g key={table.name}>
          <circle
            cx={TABLE_X}
            cy={table.y}
            r={3.5}
            fill={
              table.name === keystoneTable ? "var(--color-brass)" : "var(--color-ink-faint)"
            }
          />
          <text
            x={TABLE_X + 10}
            y={table.y + 4}
            fontSize="12.5"
            fill={table.name === keystoneTable ? "var(--color-brass)" : "var(--color-ink-soft)"}
          >
            {table.name}
            <tspan className="numeral" fill="var(--color-ink-faint)" fontSize="11">
              {"  "}×{table.count}
            </tspan>
          </text>
        </g>
      ))}
    </svg>
  );
}

function Ribbon({ node, active, dimmed }: { node: Node; active: boolean; dimmed: boolean }) {
  const start = `${CLAIM_X} ${node.y}`;
  const midpoint = (CLAIM_X + TABLE_X) / 2;
  // Declared evidence gets a stub too: it goes somewhere, just not to a table cell
  // this chart can point at.
  const untraced = node.tableY === null;

  // An untraced claim still gets a ribbon — one that sets out and fades into nothing.
  // Drawing no line at all would read as a hole in the chart rather than a gap in the
  // paper, and the gap is the finding.
  const path = untraced
    ? `M ${start} C ${midpoint - 40} ${node.y}, ${midpoint - 20} ${node.y}, ${midpoint + 10} ${node.y}`
    : `M ${start} C ${midpoint} ${node.y}, ${midpoint} ${node.tableY}, ${TABLE_X - 6} ${node.tableY}`;

  const colour = node.supported
    ? node.isKeystone
      ? "var(--color-brass)"
      : "var(--color-supported)"
    : node.declared
      ? "var(--color-ink-faint)"
      : "url(#keystone-fray)";

  return (
    <path
      d={path}
      fill="none"
      stroke={colour}
      strokeWidth={active ? 2.4 : 1.4}
      strokeLinecap="round"
      className="ribbon"
      style={{
        // A dash longer than any path here, offset by the same amount, hides the line
        // completely; animating the offset to zero draws it. Avoids having to measure
        // each path, and avoids motion's pathLength, which normalises dasharray into
        // units this SVG does not declare and renders as 1px dots.
        strokeDasharray: 900,
        strokeDashoffset: 900,
        animationDelay: `${0.1 + node.index * 0.06}s`,
        opacity: dimmed ? 0.2 : active ? 1 : 0.7,
        transition: "opacity 220ms ease, stroke-width 220ms ease",
      }}
    />
  );
}
