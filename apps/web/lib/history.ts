/*
 * What you have read, kept on your own machine.
 *
 * This is the only thing a Keystone account would carry, so it is worth being precise
 * about where it lives: in this browser's local storage and nowhere else. No request
 * sends it anywhere, signed in or not, because there is no server keeping reading
 * histories. That makes it useless across machines and perfectly private, and a guest
 * gets exactly the same feature a signed-in visitor does.
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

/** A short, honest summary for the profile page. */
export function summary(all: Visit[]): { papers: number; opens: number; since: number | null } {
  return {
    papers: all.length,
    opens: all.reduce((n, visit) => n + visit.count, 0),
    since: all.length === 0 ? null : Math.min(...all.map((visit) => visit.at)),
  };
}
