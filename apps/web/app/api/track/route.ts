import {
  analyticsAvailable,
  append,
  record,
  referrerHost,
  today,
  visitorMark,
  type Event,
  type EventName,
} from "@/lib/analytics";

/*
 * Where the browser reports what it did.
 *
 * Deliberately small and deliberately incurious. It accepts a fixed list of event
 * names and a short label, and nothing else — no free text, no URLs, no query
 * strings. A tracking endpoint that accepted arbitrary properties would, sooner or
 * later, receive something personal and store it.
 *
 * It always answers 204, even when it did nothing. A reader should never see a page
 * misbehave because a counter was unavailable, and an endpoint that reports on the
 * analytics store's health to anybody who asks is a small gift to somebody probing.
 */

export const runtime = "nodejs";

const NAMES = new Set<EventName>([
  "view",
  "paper.open",
  "paper.ingest",
  "paper.ingest.failed",
  "search",
  "ask",
  "mark.create",
  "mcp.call",
  "feed.read",
]);

const MAX_EVENTS = 20;

export async function POST(request: Request) {
  const nothing = new Response(null, { status: 204 });
  if (!analyticsAvailable()) return nothing;

  let body: { events?: unknown; session?: unknown; referrer?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return nothing;
  }

  const raw = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const events: Event[] = raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { name, label } = entry as { name?: unknown; label?: unknown };
    if (typeof name !== "string" || !NAMES.has(name as EventName)) return [];
    return [
      {
        name: name as EventName,
        label: typeof label === "string" ? label.slice(0, 60) : undefined,
      },
    ];
  });
  if (events.length === 0) return nothing;

  // The session is whatever the browser made up. It is never checked, never linked
  // to anything, and is worth nothing to anybody who steals it.
  const session =
    typeof body.session === "string" && /^[a-z0-9]{6,32}$/.test(body.session)
      ? body.session
      : "anon";

  const day = today();
  const self = new URL(request.url).host;
  const from =
    typeof body.referrer === "string" ? referrerHost(body.referrer, self) : undefined;

  try {
    const mark = await visitorMark(request, day);
    const now = Date.now();
    await Promise.all([
      record({
        events,
        mark,
        // Counted once per visit rather than once per event, or a session that reads
        // ten pages reports its referrer ten times.
        referrer: events.some((e) => e.name === "view") ? from : undefined,
      }),
      append(
        events.map((event, i) => ({
          t: now + i,
          s: session,
          n: event.name,
          label: event.label,
        })),
      ),
    ]);
  } catch {
    // A counter is never worth an error in somebody's console.
  }
  return nothing;
}
