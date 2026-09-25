/*
 * Who came, and what they did — without recording who anybody is.
 *
 * The site tells its visitors, in its own copy, that a guest's reading is stored
 * nowhere but their browser and that a stored row "does not say whose it is". Those
 * sentences have to stay true, so this is built to the shape that keeps them true:
 *
 *   No cookie. Nothing is set, so there is nothing to consent to and nothing that
 *   follows anybody between sites.
 *
 *   No identifier is stored. A visitor is reduced to a one-way hash of their address,
 *   their browser string and a server secret, salted with *today's date* — so it
 *   cannot be reversed, and the same person tomorrow is a different mark. That hash
 *   is then fed to a HyperLogLog, which keeps a probabilistic sketch and not the
 *   values, so even the hashes are not on disk.
 *
 *   No identity across visits. A *session* is a random number the browser makes and
 *   keeps in `sessionStorage` — it dies with the tab, it is never sent anywhere else,
 *   and two visits by the same person are two unrelated sessions. That is enough to
 *   ask "what did people do in one visit", which is the question funnels and paths
 *   answer, and not enough to build a profile of anybody.
 *
 * So there are two stores, for two horizons. A raw event stream for the last few
 * days, grouped by session, which is what makes journeys and drop-off visible; and
 * daily rollups kept for months, which are cheap and answer trends.
 *
 * A third-party tracker would have been less work and would have sent all of this to
 * somebody else's servers, which is the opposite of what the site's copy promises.
 */

export const RETAIN_DAYS = 90;

export type EventName =
  | "view"
  | "paper.open"
  | "paper.ingest"
  | "paper.ingest.failed"
  | "search"
  | "ask"
  | "mark.create"
  | "mcp.call"
  | "feed.read";

export interface Event {
  name: EventName;
  /** A low-cardinality label: a route, an arXiv id, a tool name. Never free text. */
  label?: string;
}

const ENDPOINT =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";

export function analyticsAvailable(): boolean {
  return Boolean(ENDPOINT && TOKEN);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const KEY = (day: string, part: string) => `ks:a:${day}:${part}`;
const DAYS = "ks:a:days";

/** One round trip for the whole batch. */
async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
  if (!analyticsAvailable() || commands.length === 0) return [];
  const response = await fetch(`${ENDPOINT}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`store responded ${response.status}`);
  const body = (await response.json()) as ({ result?: unknown; error?: string })[];
  return body.map((entry) => entry.result);
}

/**
 * A mark for one visitor, for one day, that cannot be turned back into them.
 *
 * Address and browser string are what every server already sees on every request;
 * the secret is what stops anybody with the database from re-deriving a mark by
 * guessing addresses. The date in the hash is what stops the mark being a lasting
 * identifier: the same person is a different mark tomorrow, on purpose, which is
 * also why this can count "people today" and cannot count "people who came back".
 */
export async function visitorMark(request: Request, day: string): Promise<string> {
  const address =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "";
  const agent = request.headers.get("user-agent") ?? "";
  const secret = process.env.AUTH_SECRET ?? "keystone";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${day}:${secret}:${address}:${agent}`),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Where a visit came from, reduced to a host. Never the full URL. */
export function referrerHost(referrer: string | null, self: string): string {
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).host.replace(/^www\./, "");
    return host && host !== self.replace(/^www\./, "") ? host : "direct";
  } catch {
    return "direct";
  }
}

//: Labels are counted, so an unbounded one would grow the store without limit and
//: could carry something personal from a query string. Trimmed and capped.
//:
//: Square brackets are allowed through because a Next route *is* `/paper/[id]`;
//: stripping them turned every paper view into `/paper/_id_` in the page list. They
//: cannot carry anything personal — the identifier itself is a separate label.
function label(raw: string): string {
  return raw.replace(/[^\w./:\[\]-]+/g, "_").slice(0, 60) || "_";
}

export interface Visit {
  events: Event[];
  /** Already hashed by the caller; this module never sees an address twice. */
  mark?: string;
  referrer?: string;
}

export async function record({ events, mark, referrer }: Visit): Promise<void> {
  if (!analyticsAvailable() || events.length === 0) return;
  const day = today();
  const ttl = RETAIN_DAYS * 24 * 60 * 60;
  const commands: (string | number)[][] = [["SADD", DAYS, day]];

  for (const event of events) {
    commands.push(["HINCRBY", KEY(day, "events"), label(event.name), 1]);
    if (event.label) {
      const bucket =
        event.name === "view"
          ? "views"
          : event.name.startsWith("paper.")
            ? "papers"
            : "labels";
      commands.push(["HINCRBY", KEY(day, bucket), label(event.label), 1]);
    }
  }
  if (mark) commands.push(["PFADD", KEY(day, "people"), mark]);
  if (referrer) commands.push(["HINCRBY", KEY(day, "referrers"), label(referrer), 1]);

  for (const part of ["events", "views", "papers", "labels", "people", "referrers"]) {
    commands.push(["EXPIRE", KEY(day, part), ttl]);
  }

  await pipeline(commands);
}

/* --------------------------------------------------------------------------------- *
 * Reading it back.
 * --------------------------------------------------------------------------------- */

export interface DayStats {
  day: string;
  people: number;
  events: Record<string, number>;
  views: Record<string, number>;
  papers: Record<string, number>;
  labels: Record<string, number>;
  referrers: Record<string, number>;
}

function asCounts(raw: unknown): Record<string, number> {
  // Upstash returns a hash as a flat array, or as an object, depending on the call.
  if (Array.isArray(raw)) {
    const out: Record<string, number> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = Number(raw[i + 1]) || 0;
    return out;
  }
  if (raw && typeof raw === "object") {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, Number(v) || 0]),
    );
  }
  return {};
}

/** The last `days` days, newest first. Days with nothing recorded are omitted. */
export async function readStats(days = 30): Promise<DayStats[]> {
  if (!analyticsAvailable()) return [];
  const known = (await pipeline([["SMEMBERS", DAYS]]))[0];
  const all = Array.isArray(known) ? known.map(String).sort().reverse() : [];
  const wanted = all.slice(0, days);
  if (wanted.length === 0) return [];

  const parts = ["events", "views", "papers", "labels", "referrers"] as const;
  const commands: (string | number)[][] = [];
  for (const day of wanted) {
    for (const part of parts) commands.push(["HGETALL", KEY(day, part)]);
    commands.push(["PFCOUNT", KEY(day, "people")]);
  }

  const results = await pipeline(commands);
  return wanted.map((day, i) => {
    const base = i * (parts.length + 1);
    return {
      day,
      events: asCounts(results[base]),
      views: asCounts(results[base + 1]),
      papers: asCounts(results[base + 2]),
      labels: asCounts(results[base + 3]),
      referrers: asCounts(results[base + 4]),
      people: Number(results[base + 5]) || 0,
    };
  });
}

/** Everything, forgotten. */
export async function forgetAll(): Promise<number> {
  if (!analyticsAvailable()) return 0;
  const known = (await pipeline([["SMEMBERS", DAYS]]))[0];
  const all = Array.isArray(known) ? known.map(String) : [];
  const commands: (string | number)[][] = [];
  for (const day of all) {
    for (const part of ["events", "views", "papers", "labels", "people", "referrers", "stream"]) {
      commands.push(["DEL", KEY(day, part)]);
    }
  }
  commands.push(["DEL", DAYS]);
  await pipeline(commands);
  return all.length;
}

/* --------------------------------------------------------------------------------- *
 * The raw stream, for journeys.
 *
 * A capped list per day: newest first, trimmed to STREAM_CAP, kept for STREAM_DAYS.
 * Long enough to see how a visit actually goes, short enough that it is a window and
 * not an archive.
 * --------------------------------------------------------------------------------- */

export const STREAM_DAYS = 7;
export const STREAM_CAP = 20_000;

const STREAM = (day: string) => `ks:a:${day}:stream`;

export interface Step {
  /** Milliseconds since the epoch. */
  t: number;
  /** The session that did it — random, per tab, never linked to a person. */
  s: string;
  n: string;
  label?: string;
}

export async function append(steps: Step[]): Promise<void> {
  if (!analyticsAvailable() || steps.length === 0) return;
  const day = today();
  await pipeline([
    ["LPUSH", STREAM(day), ...steps.map((step) => JSON.stringify(step))],
    ["LTRIM", STREAM(day), 0, STREAM_CAP - 1],
    ["EXPIRE", STREAM(day), STREAM_DAYS * 24 * 60 * 60],
  ]);
}

export async function readStream(days = STREAM_DAYS): Promise<Step[]> {
  if (!analyticsAvailable()) return [];
  const known = (await pipeline([["SMEMBERS", DAYS]]))[0];
  const all = Array.isArray(known) ? known.map(String).sort().reverse() : [];
  const wanted = all.slice(0, days);
  if (wanted.length === 0) return [];
  const results = await pipeline(
    wanted.map((day) => ["LRANGE", STREAM(day), 0, STREAM_CAP - 1]),
  );
  const steps: Step[] = [];
  for (const chunk of results) {
    if (!Array.isArray(chunk)) continue;
    for (const raw of chunk) {
      try {
        const step = JSON.parse(String(raw)) as Step;
        if (step && typeof step.s === "string" && typeof step.n === "string") steps.push(step);
      } catch {
        // A line that will not parse is a line that tells us nothing. Skipped.
      }
    }
  }
  return steps.sort((a, b) => a.t - b.t);
}

export interface Session {
  id: string;
  steps: Step[];
  started: number;
  ended: number;
  /** How long the visit lasted, in seconds. Zero for a one-event visit. */
  seconds: number;
}

export function sessionsOf(steps: Step[]): Session[] {
  const by = new Map<string, Step[]>();
  for (const step of steps) by.set(step.s, [...(by.get(step.s) ?? []), step]);
  return [...by.entries()]
    .map(([id, own]) => {
      const ordered = [...own].sort((a, b) => a.t - b.t);
      const started = ordered[0].t;
      const ended = ordered[ordered.length - 1].t;
      return { id, steps: ordered, started, ended, seconds: Math.round((ended - started) / 1000) };
    })
    .sort((a, b) => b.started - a.started);
}

/**
 * How many sessions reached each step of a funnel, in order.
 *
 * A session counts at step *n* only if it also reached every step before it, and the
 * ordering is by first occurrence — a visitor who opened a paper before searching has
 * not completed a search-then-open funnel, and counting them would turn a funnel into
 * two unrelated totals.
 */
export function funnel(sessions: Session[], stages: string[]): number[] {
  return stages.map((_, index) => {
    const upto = stages.slice(0, index + 1);
    return sessions.filter((session) => {
      let at = 0;
      for (const step of session.steps) {
        if (step.n === upto[at] || step.n.startsWith(`${upto[at]}.`)) at += 1;
        if (at === upto.length) return true;
      }
      return false;
    }).length;
  });
}

/** The commonest first few things a visit does, as a path. */
export function commonPaths(sessions: Session[], depth = 3, top = 8): { path: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const names: string[] = [];
    for (const step of session.steps) {
      const name = step.n === "view" && step.label ? `view ${step.label}` : step.n;
      if (names[names.length - 1] !== name) names.push(name);
      if (names.length >= depth) break;
    }
    if (names.length === 0) continue;
    const key = names.join(" → ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([path, n]) => ({ path, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, top);
}
