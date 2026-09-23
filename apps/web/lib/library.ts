"use client";

/*
 * The whole library's readings, in one fetch.
 *
 * `search.json` is built alongside the dossiers and already holds every row the
 * analysis produced — 491 citation readings and 408 assumptions, each with the
 * sentence, the cue phrase that placed it, the section, the work it points at, and
 * the row id a deep link uses. It was written for the search box, but it is exactly
 * the shape the library-wide pages need, so they read it rather than fetching
 * seventy-four dossiers to reassemble the same thing.
 *
 * One consequence worth stating: these pages are as current as the last build of the
 * index, which is the same build that writes the dossiers. They cannot drift apart.
 */

import { useEffect, useState } from "react";

export interface LibraryRow {
  paper: string;
  kind: "edge" | "assumption";
  /** For an edge, its stance. For an assumption, what the paper offered for it. */
  stance: string;
  text: string;
  cue: string;
  section: string;
  /** The work a citation points at. Empty for an assumption. */
  about: string;
  /** The row's own id, so a link lands on the line rather than the paper. */
  row: string;
}

export interface Library {
  titles: Record<string, string>;
  rows: LibraryRow[];
}

export type Stance = "inherits" | "extends" | "contests" | "compares" | "background";

export const STANCE_LABEL: Record<string, string> = {
  inherits: "adopts",
  extends: "extends",
  contests: "disputes",
  compares: "measures against",
  background: "mentions",
};

export const SUPPORT_LABEL: Record<string, string> = {
  cited: "points at a citation",
  shown: "points at its own evidence",
  bare: "offers nothing",
};

/** The library index, or null while it is on its way. */
export function useLibrary(): { library: Library | null; failed: boolean } {
  const [library, setLibrary] = useState<Library | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/dossiers/search.json")
      .then((r) => r.json())
      .then((body: Library) => {
        if (cancelled) return;
        if (body && Array.isArray(body.rows)) setLibrary(body);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { library, failed };
}

/** A link that lands on one reading, with its section already open. */
export function rowHref(row: LibraryRow): string {
  return `/paper/${row.paper}#${row.row}`;
}

/**
 * The cue phrases a set of rows was placed by, commonest first.
 *
 * Case-folded, because "We believe" and "we believe" are the same phrase written at
 * different points in a sentence and splitting them would report the library's
 * favourite hedge as two smaller ones.
 */
export function byCue(rows: LibraryRow[]): { cue: string; rows: LibraryRow[] }[] {
  const by = new Map<string, { cue: string; rows: LibraryRow[] }>();
  for (const row of rows) {
    const key = row.cue.toLowerCase().trim();
    const found = by.get(key) ?? { cue: key, rows: [] };
    found.rows.push(row);
    by.set(key, found);
  }
  return [...by.values()].sort(
    (a, b) => b.rows.length - a.rows.length || a.cue.localeCompare(b.cue),
  );
}
