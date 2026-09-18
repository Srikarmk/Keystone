/*
 * What you have read.
 *
 * Local storage is the home of it, always. A guest's list never leaves the browser,
 * and a signed-in reader's is *also* kept here — the server copy is a mirror so the
 * list survives moving between machines, not the source of truth. Written that way so
 * the page works offline, works signed out, and works when the store is down, all
 * without a branch in the component that renders it.
 *
 * The sync is one round trip: send what this browser has, get back the union of that
 * and what the account already had. See app/api/history/route.ts.
 */

const KEY = "keystone-reading";
const LIMIT = 200;

export interface Visit {
  id: string;
  title: string;
  /** Epoch milliseconds of the most recent visit. */
  at: number;
  /** How many separate visits. A paper read four times is not the same as one read once. */
  count: number;
}

function read(): Visit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Validated field by field rather than cast: this is storage a user can edit, and
    // a malformed entry should drop out silently instead of breaking the page.
    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const { id, title, at, count } = entry as Record<string, unknown>;
      if (typeof id !== "string" || !id) return [];
      return [{
        id,
        title: typeof title === "string" ? title : id,
        at: typeof at === "number" && Number.isFinite(at) ? at : 0,
        count: typeof count === "number" && Number.isFinite(count) ? count : 1,
      }];
    });
  } catch {
    return [];
  }
}

/** Every paper visited, most recent first. */
export function visits(): Visit[] {
  return read().sort((a, b) => b.at - a.at);
}

/** Note that a paper was opened. Safe to call on every mount; same-session repeats
 *  inside a minute are treated as one visit rather than as reading it twice. */
export function record(id: string, title: string): void {
  if (typeof window === "undefined" || !id) return;
  const now = Date.now();
  const all = read();
  const found = all.find((visit) => visit.id === id);
  if (found) {
    const same = now - found.at < 60_000;
    found.at = now;
    found.title = title || found.title;
    if (!same) found.count += 1;
  } else {
    all.push({ id, title: title || id, at: now, count: 1 });
  }
  const kept = all.sort((a, b) => b.at - a.at).slice(0, LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Storage full or blocked. Losing a reading list is not worth an error.
  }
}

export function clear(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

function replace(visits: Visit[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(visits.slice(0, LIMIT)));
  } catch {
    /* storage full or blocked */
  }
}

export interface Synced {
  visits: Visit[];
  /** True only when a signed-in account and a configured store both exist. */
  syncing: boolean;
}

/**
 * Reconcile this browser's list with the account's, if there is one.
 *
 * Returns the local list unchanged on every failure path — signed out, no store
 * configured, network down, malformed reply. The caller renders what it gets back and
 * does not need to know which of those happened, because in all of them the honest
 * answer is "here is what this browser knows".
 */
export async function sync(): Promise<Synced> {
  const local = visits();
  if (typeof window === "undefined") return { visits: local, syncing: false };
  try {
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visits: local }),
    });
    if (!response.ok) return { visits: local, syncing: false };
    const body = (await response.json()) as { syncing?: unknown; visits?: unknown };
    if (!body.syncing || !Array.isArray(body.visits)) {
      return { visits: local, syncing: false };
    }
    const merged = visitsFrom(body.visits);
    replace(merged);
    return { visits: merged, syncing: true };
  } catch {
    return { visits: local, syncing: false };
  }
}

/** Forget everything, here and on the account. */
export async function forget(): Promise<void> {
  clear();
  try {
    await fetch("/api/history", { method: "DELETE" });
  } catch {
    /* the local copy is gone either way */
  }
}

function visitsFrom(raw: unknown[]): Visit[] {
  return raw
    .flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const { id, title, at, count } = entry as Record<string, unknown>;
      if (typeof id !== "string" || !id) return [];
      return [
        {
          id,
          title: typeof title === "string" ? title : id,
          at: typeof at === "number" && Number.isFinite(at) ? at : 0,
          count: typeof count === "number" && Number.isFinite(count) ? count : 1,
        },
      ];
    })
    .sort((a, b) => b.at - a.at);
}

/** A short, honest summary for the profile page. */
export function summary(all: Visit[]): { papers: number; opens: number; since: number | null } {
  return {
    papers: all.length,
    opens: all.reduce((n, visit) => n + visit.count, 0),
    since: all.length === 0 ? null : Math.min(...all.map((visit) => visit.at)),
  };
}
