import { historyKey } from "@/auth";
import type { Visit } from "@/lib/history";
import { deleteHistory, merge, readHistory, storeAvailable, writeHistory } from "@/lib/store";
import { isArxivId } from "@/lib/arxiv";

/*
 * A signed-in reader's list, shared between their machines.
 *
 * `POST` is the whole protocol: the browser sends what it has, the server merges it
 * with what is stored and returns the union. One round trip, and it works the same
 * whether the browser is ahead (read offline), behind (read elsewhere), or both.
 *
 * Signed out, or with no store configured, it answers `syncing: false` and echoes what
 * it was sent. The caller then keeps its local list and nothing breaks — a guest is a
 * supported state here, not an error.
 */

export const runtime = "nodejs";

function clean(raw: unknown): Visit[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { id, title, at, count } = entry as Record<string, unknown>;
    // Ids are arXiv identifiers and nothing else. This is the boundary where a
    // browser's claim becomes a database key, so the shape is checked here rather
    // than trusted from the client that sent it.
    if (typeof id !== "string" || !isArxivId(id)) return [];
    return [
      {
        id,
        title: typeof title === "string" ? title.slice(0, 300) : id,
        at: typeof at === "number" && Number.isFinite(at) ? at : 0,
        count:
          typeof count === "number" && Number.isFinite(count)
            ? Math.min(Math.max(1, Math.round(count)), 10_000)
            : 1,
      },
    ];
  });
}

export async function POST(request: Request) {
  let sent: Visit[] = [];
  try {
    const body = (await request.json()) as { visits?: unknown };
    sent = clean(body?.visits);
  } catch {
    sent = [];
  }

  let handle: string | null = null;
  try {
    handle = await historyKey();
  } catch {
    handle = null;
  }

  if (!handle || !storeAvailable()) {
    return Response.json({ syncing: false, visits: sent });
  }

  try {
    const merged = merge(await readHistory(handle), sent);
    await writeHistory(handle, merged);
    return Response.json({ syncing: true, visits: merged });
  } catch {
    // A store that is down must not cost the reader their local list.
    return Response.json({ syncing: false, visits: sent });
  }
}

export async function DELETE() {
  let handle: string | null = null;
  try {
    handle = await historyKey();
  } catch {
    handle = null;
  }
  if (!handle || !storeAvailable()) return Response.json({ cleared: false });
  try {
    await deleteHistory(handle);
    return Response.json({ cleared: true });
  } catch {
    return Response.json({ cleared: false }, { status: 502 });
  }
}
