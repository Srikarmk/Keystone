/*
 * How one paper reaches another.
 *
 * The idea is borrowed from Inciteful's literature connector, which finds a citation
 * path between two papers. On an untyped graph such a path only proves the two are
 * connected. Here the edges carry a stance, so the same path reads as a chain of
 * claims — "BERT adopts the Transformer, which adopts ResNet" — and the chain is the
 * answer rather than evidence that one exists.
 *
 * Citation is directional but reading is not: a reader asking how two papers relate
 * does not care which one cites the other. So the search walks edges in both
 * directions and records which way each one actually points, because "A adopts B" and
 * "B adopts A" are completely different statements and the display has to say which.
 */

import type { LibraryGraph, Stance } from "@/lib/dossier";

export interface Step {
  from: string;
  to: string;
  stance: Stance;
  cue: string;
  sentence: string;
  section: string;
  /** False when the path traverses this edge against the direction of citation. */
  forward: boolean;
}

//: Beyond this a "path" stops explaining anything — six hops through a 74-paper
//: library connects almost any two papers and tells the reader nothing.
const MAX_HOPS = 4;

/**
 * The shortest chain of stated relationships between two papers, or null.
 *
 * Breadth-first, so the first path found is the shortest. Shortest is the right
 * objective here rather than, say, strongest: a long path through weak relationships
 * is not a better answer than no path, it is a worse one, because it looks like an
 * explanation.
 */
export function connect(
  graph: LibraryGraph,
  from: string,
  to: string,
): Step[] | null {
  if (from === to) return null;

  // Both directions, each remembering which way the citation runs.
  const out = new Map<string, Step[]>();
  for (const edge of graph.edges) {
    const forward: Step = { ...edge, forward: true };
    const backward: Step = { ...edge, forward: false };
    if (!out.has(edge.from)) out.set(edge.from, []);
    if (!out.has(edge.to)) out.set(edge.to, []);
    out.get(edge.from)!.push(forward);
    out.get(edge.to)!.push(backward);
  }

  const seen = new Set([from]);
  let frontier: { at: string; path: Step[] }[] = [{ at: from, path: [] }];

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const next: { at: string; path: Step[] }[] = [];
    for (const { at, path } of frontier) {
      for (const step of out.get(at) ?? []) {
        const onward = step.forward ? step.to : step.from;
        if (onward === at || seen.has(onward)) continue;
        const extended = [...path, step];
        if (onward === to) return extended;
        seen.add(onward);
        next.push({ at: onward, path: extended });
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return null;
}

/** Papers reachable from this one, so the picker can offer only those. */
export function reachable(graph: LibraryGraph, from: string): Set<string> {
  const out = new Map<string, string[]>();
  for (const { from: a, to: b } of graph.edges) {
    if (!out.has(a)) out.set(a, []);
    if (!out.has(b)) out.set(b, []);
    out.get(a)!.push(b);
    out.get(b)!.push(a);
  }
  const seen = new Set([from]);
  let frontier = [from];
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const next: string[] = [];
    for (const at of frontier) {
      for (const onward of out.get(at) ?? []) {
        if (seen.has(onward)) continue;
        seen.add(onward);
        next.push(onward);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  seen.delete(from);
  return seen;
}
