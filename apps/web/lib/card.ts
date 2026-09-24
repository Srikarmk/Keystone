/*
 * What a shared link to a paper should say, for pages rendered on a server.
 *
 * The library's seventy-four papers are in an index the bundler can see, which is
 * what the social card and the page title have always read. A paper somebody pasted
 * is in neither — it exists only in the ingest function's cache — and the card for
 * one used to come out reading "1709.01507 · 0 works it stands on", which is not a
 * missing card but a wrong one.
 *
 * So: the index first, then the cache, and then an honest absence. The cache is read
 * with `cached=1`, which never starts an ingest — a crawler following a link must not
 * be able to make this service download a paper from arXiv.
 */

import index from "@/public/dossiers/index.json";

export interface Card {
  title: string;
  category: string;
  stands: number;
  argues: number;
  bare: number;
  /** The one work it would not stand without, by title. Empty when there is none. */
  quote: string;
  /** False when the paper has never been read, so nothing may be asserted about it. */
  known: boolean;
}

interface Entry {
  id: string;
  title?: string;
  lineage?: { inherits?: number; extends?: number; contests?: number };
  assumptions?: { bare?: number };
  arxiv?: { primaryName?: string } | null;
  foundation?: string;
}

const BY_ID = new Map((index as Entry[]).map((entry) => [entry.id, entry]));

const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://keystone-research.vercel.app";

function fromEntry(entry: Entry, id: string): Card {
  const tally = entry.lineage ?? {};
  return {
    title: entry.title ?? id,
    category: entry.arxiv?.primaryName ?? "",
    stands: (tally.inherits ?? 0) + (tally.extends ?? 0),
    argues: tally.contests ?? 0,
    bare: entry.assumptions?.bare ?? 0,
    quote: entry.foundation ?? "",
    known: true,
  };
}

/** Nothing is asserted: no counts, and the id in place of a title. */
export function unread(id: string): Card {
  return { title: id, category: "", stands: 0, argues: 0, bare: 0, quote: "", known: false };
}

export async function cardFor(id: string): Promise<Card> {
  const entry = BY_ID.get(id);
  if (entry) return fromEntry(entry, id);

  try {
    const response = await fetch(
      `${SITE}/api/ingest?id=${encodeURIComponent(id)}&cached=1`,
      // Bounded, because this sits in front of a page render. A card is worth a
      // second of somebody's time and not five.
      { signal: AbortSignal.timeout(6000), cache: "force-cache" },
    );
    if (!response.ok) return unread(id);
    const dossier = (await response.json()) as {
      title?: string;
      arxiv?: { primaryName?: string } | null;
      lineage?: {
        tally?: { inherits?: number; extends?: number; contests?: number };
        foundation?: { title?: string } | null;
      };
      assumptionTally?: { bare?: number };
    };
    const tally = dossier.lineage?.tally ?? {};
    return {
      title: dossier.title || id,
      category: dossier.arxiv?.primaryName ?? "",
      stands: (tally.inherits ?? 0) + (tally.extends ?? 0),
      argues: tally.contests ?? 0,
      bare: dossier.assumptionTally?.bare ?? 0,
      quote: dossier.lineage?.foundation?.title ?? "",
      known: true,
    };
  } catch {
    return unread(id);
  }
}
