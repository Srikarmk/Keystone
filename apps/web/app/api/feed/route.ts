import { SOURCES, newestFirst, parseFeed, type Item } from "@/lib/feeds";

/*
 * What the field published recently, gathered from the feeds its authors publish.
 *
 * Every source is fetched in parallel and cached for fifteen minutes. A source that is
 * slow, down, or has changed its address does not take the page with it: it is dropped
 * from the results and *named* in the response, because a feed that quietly shows
 * fewer sources than it lists is a feed you cannot trust to be complete.
 *
 * Unlike the library's own files, these are not keyed to the deployment — news is
 * genuinely time-based, and fifteen minutes stale is the correct amount of stale.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const AGENT = "keystone/0.1 (+https://github.com/Srikarmk/Keystone)";
const PER_SOURCE = 12;

async function read(source: (typeof SOURCES)[number]): Promise<Item[]> {
  const response = await fetch(source.url, {
    headers: { "User-Agent": AGENT, Accept: "application/rss+xml, application/xml, */*" },
    signal: AbortSignal.timeout(9_000),
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`${source.name} answered ${response.status}`);
  return parseFeed(await response.text(), source).slice(0, PER_SOURCE);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const only = params.get("source");
  const wanted = only ? SOURCES.filter((s) => s.id === only) : SOURCES;

  const settled = await Promise.allSettled(wanted.map(read));
  const items: Item[] = [];
  const failed: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") items.push(...result.value);
    else failed.push(wanted[i].name);
  });

  return Response.json(
    {
      items: newestFirst(items),
      sources: wanted.map(({ id, name, kind, about }) => ({ id, name, kind, about })),
      // Named, not swallowed. The page says which sources it could not reach.
      unreachable: failed,
      fetched: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
}
