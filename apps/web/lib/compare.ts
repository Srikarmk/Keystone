/*
 * Two papers, side by side: what they share and where they part.
 *
 * Built only from what each paper's bibliography and citing sentences already say.
 * Two references are the same work when their arXiv identifiers agree or their
 * folded titles do — the same exact-match rule the engine resolves citations with
 * (`fold` in services/core/keystone/lineage/graph.py), mirrored here rather than
 * loosened, so a pairing on this page is one the library would also have made.
 *
 * Deliberately absent: shared *assumptions*. Two papers assuming the same thing in
 * different words is a similarity judgement, not a match, and the project's rule is
 * to say nothing it cannot point at. A pair of quoted sentences about the same cited
 * work is something a reader can check; "these two assumptions are alike" is not.
 */

import type { Dossier, LineageEdge, Reference, Stance } from "@/lib/dossier";

/** A title reduced to what two bibliographies can be expected to agree on. */
export function fold(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

//: Below three real words a folded title matches too much ("Adam", "2014") to be an
//: identity. Those references can still match on an arXiv id.
function titleKey(title: string): string | null {
  const words = title.match(/[A-Za-z]{3,}/g) ?? [];
  return words.length >= 3 ? fold(title) : null;
}

const LEANS: ReadonlySet<Stance> = new Set(["inherits", "extends"]);
const PUSHES: ReadonlySet<Stance> = new Set(["contests", "compares"]);

/** One cited work as one paper sees it. */
export interface Side {
  reference: Reference;
  /** What the paper's sentences do with it; empty when it is only cited. */
  edges: LineageEdge[];
}

export interface Shared {
  title: string;
  a: Side;
  b: Side;
}

export interface Comparison {
  /** Sentences in A about B, and in B about A. */
  aOnB: LineageEdge[];
  bOnA: LineageEdge[];
  /** Works both papers adopt or extend. */
  bothStandOn: Shared[];
  /** Works one paper adopts or extends and the other disputes or measures against. */
  partWays: Shared[];
  /** Works both dispute or measure themselves against. */
  bothPush: Shared[];
  /** Everything else both cite, with no stance either way that sets them apart. */
  alsoBothCite: Shared[];
}

function stancesOf(side: Side): Set<Stance> {
  return new Set(side.edges.map((edge) => edge.stance));
}

function some(stances: Set<Stance>, of: ReadonlySet<Stance>): boolean {
  return [...stances].some((s) => of.has(s));
}

/** Whether a reference in one paper names the other paper itself. */
function names(reference: { arxivId: string | null; title: string }, paper: Dossier): boolean {
  if (reference.arxivId && reference.arxivId === paper.id) return true;
  const own = titleKey(paper.title ?? "");
  const theirs = titleKey(reference.title ?? "");
  return Boolean(own && theirs && own === theirs);
}

export function compare(a: Dossier, b: Dossier): Comparison {
  const edgesByKey = (d: Dossier) => {
    const by = new Map<string, LineageEdge[]>();
    for (const edge of d.lineage.edges) {
      by.set(edge.key, [...(by.get(edge.key) ?? []), edge]);
    }
    return by;
  };
  const aEdges = edgesByKey(a);
  const bEdges = edgesByKey(b);

  // B's references, findable by either identity.
  const bById = new Map<string, Reference>();
  const bByTitle = new Map<string, Reference>();
  for (const ref of b.references) {
    if (names(ref, a)) continue;
    if (ref.arxivId) bById.set(ref.arxivId, ref);
    const key = titleKey(ref.title ?? "");
    if (key) bByTitle.set(key, ref);
  }

  const shared: Shared[] = [];
  const taken = new Set<string>();
  for (const ref of a.references) {
    if (names(ref, b)) continue;
    const key = titleKey(ref.title ?? "");
    const match =
      (ref.arxivId ? bById.get(ref.arxivId) : undefined) ??
      (key ? bByTitle.get(key) : undefined);
    // One work cited twice in a bibliography is still one pairing.
    if (!match || taken.has(match.key)) continue;
    taken.add(match.key);
    shared.push({
      title: ref.title || match.title || ref.raw,
      a: { reference: ref, edges: aEdges.get(ref.key) ?? [] },
      b: { reference: match, edges: bEdges.get(match.key) ?? [] },
    });
  }

  const result: Comparison = {
    aOnB: a.lineage.edges.filter((edge) => names(edge, b)),
    bOnA: b.lineage.edges.filter((edge) => names(edge, a)),
    bothStandOn: [],
    partWays: [],
    bothPush: [],
    alsoBothCite: [],
  };

  for (const item of shared) {
    const sa = stancesOf(item.a);
    const sb = stancesOf(item.b);
    const aLeans = some(sa, LEANS);
    const bLeans = some(sb, LEANS);
    const aPushes = some(sa, PUSHES);
    const bPushes = some(sb, PUSHES);
    if ((aLeans && bPushes && !bLeans) || (bLeans && aPushes && !aLeans)) {
      result.partWays.push(item);
    } else if (aLeans && bLeans) {
      result.bothStandOn.push(item);
    } else if (aPushes && bPushes) {
      result.bothPush.push(item);
    } else {
      result.alsoBothCite.push(item);
    }
  }

  const byTitle = (x: Shared, y: Shared) => x.title.localeCompare(y.title);
  result.bothStandOn.sort(byTitle);
  result.partWays.sort(byTitle);
  result.bothPush.sort(byTitle);
  result.alsoBothCite.sort(byTitle);
  return result;
}
