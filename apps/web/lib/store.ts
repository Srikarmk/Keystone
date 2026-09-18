/*
 * Where a signed-in reader's history is kept.
 *
 * A Redis REST endpoint, spoken to with `fetch` and a bearer token. No client library:
 * the whole protocol used here is "POST a JSON array of command words", and a
 * dependency to wrap that is a dependency to keep current for nothing. It also means
 * any Redis-over-HTTP provider works — Upstash, Vercel's own, a self-hosted proxy —
 * because none of their SDK differences are reachable from here.
 *
 * Absent credentials, every call reports "no store" rather than throwing. Sync is a
 * feature of being signed in, and signing in is optional, so a deployment without a
 * database has to stay a working deployment.
 */

import type { Visit } from "@/lib/history";

const ENDPOINT =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
const TOKEN =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

/** Whether this deployment can sync at all. */
export function storeAvailable(): boolean {
  return Boolean(ENDPOINT && TOKEN);
}

const KEY = (handle: string) => `keystone:reading:${handle}`;

//: A reading list is small — 200 entries of four short fields. Capped anyway, so a
//: forged request cannot fill the store.
const LIMIT = 200;

async function command(...words: (string | number)[]): Promise<unknown> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(words),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`store responded ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result;
}

/** Validated field by field: this is data that left the building and came back. */
function parse(raw: unknown): Visit[] {
  if (typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
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
  });
}

export async function readHistory(handle: string): Promise<Visit[]> {
  if (!storeAvailable()) return [];
  return parse(await command("GET", KEY(handle)));
}

export async function writeHistory(handle: string, visits: Visit[]): Promise<void> {
  if (!storeAvailable()) return;
  const kept = [...visits].sort((a, b) => b.at - a.at).slice(0, LIMIT);
  await command("SET", KEY(handle), JSON.stringify(kept));
}

export async function deleteHistory(handle: string): Promise<void> {
  if (!storeAvailable()) return;
  await command("DEL", KEY(handle));
}

/**
 * One list from two, when a device that has been reading offline signs in.
 *
 * `count` takes the larger of the two rather than the sum. Summing would be right if
 * the two devices had read disjointly and wrong — double — if they had already synced
 * once, and there is no way to tell which from the data. The larger number is the one
 * that is certainly true of at least one device, so it understates rather than
 * inventing reading that did not happen.
 */
export function merge(a: Visit[], b: Visit[]): Visit[] {
  const by = new Map<string, Visit>();
  for (const visit of [...a, ...b]) {
    const found = by.get(visit.id);
    if (!found) {
      by.set(visit.id, { ...visit });
      continue;
    }
    found.count = Math.max(found.count, visit.count);
    if (visit.at > found.at) {
      found.at = visit.at;
      found.title = visit.title || found.title;
    }
  }
  return [...by.values()].sort((x, y) => y.at - x.at).slice(0, LIMIT);
}
