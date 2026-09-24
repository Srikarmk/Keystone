import { historyKey } from "@/auth";
import { isArxivId } from "@/lib/arxiv";
import {
  MAX_MARKS,
  MAX_NOTE,
  MAX_QUOTE,
  condense,
  inOrder,
  parseMark,
  type Mark,
} from "@/lib/marks";
import { deleteMarks, readMarks, storeAvailable, writeMarks } from "@/lib/store";

/*
 * A reader's marks on one paper.
 *
 * Signing in is optional everywhere else on this site and required here, which is a
 * deliberate exception rather than an oversight. Everything else Keystone shows is a
 * public paper quoted from a public source, so a guest loses nothing by staying a
 * guest. A mark is the reader's own writing, and the only honest way to offer to keep
 * something is to have somewhere to keep it — so a signed-out request gets a plain
 * `signedIn: false` and no local consolation prize.
 *
 * The bounds on the way in are the same constants the browser enforces on the way out,
 * imported rather than restated. This is the boundary where a fetch becomes a database
 * key, so nothing that arrives here is trusted for having come from our own code.
 */

export const runtime = "nodejs";



async function handle(): Promise<string | null> {
  try {
    return await historyKey();
  } catch {
    return null;
  }
}

function paperOf(request: Request): string | null {
  const paper = new URL(request.url).searchParams.get("paper") ?? "";
  return isArxivId(paper) ? paper : null;
}

export async function GET(request: Request) {
  const paper = paperOf(request);
  if (!paper) return Response.json({ error: "which paper?" }, { status: 400 });

  const who = await handle();
  if (!who) return Response.json({ signedIn: false, marks: [] });
  if (!storeAvailable()) {
    return Response.json({ signedIn: true, storing: false, marks: [] });
  }
  try {
    return Response.json({
      signedIn: true,
      storing: true,
      marks: await readMarks(who, paper),
    });
  } catch {
    // A store that is down is reported as one. Answering with an empty list would
    // tell the reader their marks are gone, which is a worse lie than an error.
    return Response.json({ signedIn: true, storing: false, marks: [] }, { status: 502 });
  }
}

/**
 * Save one mark — new, or an edit to an existing one.
 *
 * Read-modify-write on a per-paper key, which races if the same reader has the same
 * paper open twice. The loser of that race loses one mark rather than the list,
 * because the write is the whole list and the last writer's copy is complete apart
 * from the other tab's newest addition. A transaction would need either a Lua script
 * or a key per mark, and neither is worth it for the cost of that: one unsaved
 * highlight, in a situation the reader created by annotating the same page twice at
 * once.
 */
export async function POST(request: Request) {
  const paper = paperOf(request);
  if (!paper) return Response.json({ error: "which paper?" }, { status: 400 });

  const who = await handle();
  if (!who) {
    return Response.json({ signedIn: false, error: "sign in to keep marks" }, { status: 401 });
  }
  if (!storeAvailable()) {
    return Response.json({ signedIn: true, storing: false, error: "no store" }, { status: 503 });
  }

  let body: { mark?: unknown };
  try {
    body = (await request.json()) as { mark?: unknown };
  } catch {
    return Response.json({ error: "unreadable" }, { status: 400 });
  }

  const sent = parseMark(body?.mark);
  if (!sent) return Response.json({ error: "not a mark" }, { status: 400 });
  // Re-condensed here as well as in the browser. The browser's copy is a convenience;
  // this is the version that gets stored, and a hand-built request should not be able
  // to plant ninety-six overlapping slivers.
  const rects = condense(sent.rects);
  if (rects.length === 0) return Response.json({ error: "not a mark" }, { status: 400 });

  const now = Date.now();
  const mark: Mark = {
    ...sent,
    rects,
    quote: sent.quote.slice(0, MAX_QUOTE),
    note: sent.note.slice(0, MAX_NOTE),
    at: sent.at || now,
    edited: now,
  };

  try {
    const existing = await readMarks(who, paper);
    const without = existing.filter((one) => one.id !== mark.id);
    if (without.length >= MAX_MARKS) {
      return Response.json(
        { error: `${MAX_MARKS} marks on one paper is the limit` },
        { status: 409 },
      );
    }
    // An edit keeps the original creation time, so the list does not reshuffle
    // because somebody fixed a typo in a note.
    const kept = existing.find((one) => one.id === mark.id);
    const marks = inOrder([...without, { ...mark, at: kept?.at ?? mark.at }]);
    await writeMarks(who, paper, marks);
    return Response.json({ signedIn: true, storing: true, marks });
  } catch {
    return Response.json({ error: "the store did not answer" }, { status: 502 });
  }
}

/** One mark by id, or every mark this reader has made when asked for `all`. */
export async function DELETE(request: Request) {
  const who = await handle();
  if (!who) return Response.json({ signedIn: false }, { status: 401 });
  if (!storeAvailable()) return Response.json({ storing: false }, { status: 503 });

  const params = new URL(request.url).searchParams;
  if (params.get("scope") === "all") {
    try {
      return Response.json({ cleared: await deleteMarks(who) });
    } catch {
      return Response.json({ error: "the store did not answer" }, { status: 502 });
    }
  }

  const paper = paperOf(request);
  const id = params.get("id") ?? "";
  if (!paper || !/^[A-Za-z0-9_-]{4,40}$/.test(id)) {
    return Response.json({ error: "which mark?" }, { status: 400 });
  }
  try {
    const marks = (await readMarks(who, paper)).filter((one) => one.id !== id);
    await writeMarks(who, paper, marks);
    return Response.json({ signedIn: true, storing: true, marks });
  } catch {
    return Response.json({ error: "the store did not answer" }, { status: 502 });
  }
}
