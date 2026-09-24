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

//: `UPSTASH_*` first, `KV_*` second, and the order is load-bearing.
//:
//: Both name a working store. `UPSTASH_*` is the database provisioned directly at
//: upstash.com, which is the one on the free tier — Vercel's marketplace flow offers
//: only Pay-As-You-Go and the Fixed plans, with no free option in the list. `KV_*` is
//: that marketplace resource.
//:
//: With the old order the metered store won and the free one was never read, which is
//: the kind of thing that shows up as a bill rather than as a bug. Two stores also
//: means data lands in whichever one this resolves to, so the marketplace resource
//: should be disconnected once this is confirmed — until then, this order decides.
const ENDPOINT =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";

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

/* ---------------------------------------------------------------------------------
 * Marks: what a reader highlighted, and what they wrote about it.
 *
 * Filed per paper rather than in one blob per reader, because the reader opens one
 * paper at a time and a person who annotates heavily should not make their own library
 * slower to open. The price is a second key listing which papers they have marked,
 * kept as a set so adding a mark to an already-marked paper is idempotent.
 *
 * Unlike the reading list there is no guest path here. A mark is the reader's own
 * writing about a specific place in a document, and putting it in `localStorage` would
 * mean promising to keep something and then losing it to a cleared cache — so it is
 * offered only to a signed-in reader and stored only on the server.
 * --------------------------------------------------------------------------------- */

import { inOrder, MAX_MARKS, parseMark, type Mark } from "@/lib/marks";
import { isArxivId } from "@/lib/arxiv";

const MARKS = (handle: string, paper: string) => `keystone:marks:${handle}:${paper}`;
const MARKED = (handle: string) => `keystone:marked:${handle}`;

export async function readMarks(handle: string, paper: string): Promise<Mark[]> {
  if (!storeAvailable()) return [];
  const raw = await command("GET", MARKS(handle, paper));
  if (typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return inOrder(parsed.flatMap((entry) => {
    const mark = parseMark(entry);
    return mark ? [mark] : [];
  }));
}

export async function writeMarks(
  handle: string,
  paper: string,
  marks: Mark[],
): Promise<void> {
  if (!storeAvailable()) return;
  if (marks.length === 0) {
    // Erasing the last mark erases the record of having marked the paper too, so a
    // reader who clears their annotations does not leave the paper listed as annotated.
    await command("DEL", MARKS(handle, paper));
    await command("SREM", MARKED(handle), paper);
    return;
  }
  await command(
    "SET",
    MARKS(handle, paper),
    JSON.stringify(inOrder(marks).slice(0, MAX_MARKS)),
  );
  await command("SADD", MARKED(handle), paper);
}

/** Which papers this reader has marked. For the profile page, and nothing else yet. */
export async function markedPapers(handle: string): Promise<string[]> {
  if (!storeAvailable()) return [];
  const raw = await command("SMEMBERS", MARKED(handle));
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is string => typeof entry === "string" && isArxivId(entry),
  );
}

/**
 * Every mark this reader has made, gone.
 *
 * Deleted one paper at a time from the set's own membership, so nothing is left
 * orphaned under a key no index points at. Called when a reader asks for their data
 * to be removed, where leaving a stray key behind would make the deletion a lie.
 */
export async function deleteMarks(handle: string): Promise<number> {
  if (!storeAvailable()) return 0;
  const papers = await markedPapers(handle);
  for (const paper of papers) await command("DEL", MARKS(handle, paper));
  await command("DEL", MARKED(handle));
  return papers.length;
}
