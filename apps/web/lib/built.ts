/*
 * Fetching the library's own build artefacts from a server route.
 *
 * Routes cannot read `public/` — they run in a serverless function where it is not on
 * disk — so they fetch these over HTTP from the site itself. The catch is that Next's
 * data cache **survives a deployment**: a `revalidate: 3600` entry written before a
 * deploy is still served after it. The library grew from 74 papers to 101 and the MCP
 * route went on reporting 40 disputes where there were 52, through a fresh deployment
 * and a fix that was not the cause.
 *
 * So the deployment's own identity goes in the URL. Within one deployment these are
 * cached and cost nothing; a new deployment is a different key and cannot serve the
 * previous library. `?v=` is ignored by the static file handler.
 */

//: Vercel sets the commit SHA on every deployment. Locally there is none, and a
//: constant is right there: `next dev` has no data cache to go stale.
const STAMP = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev";

const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://keystone-research.vercel.app";

/** A URL for a file built into `public/`, keyed to this deployment. */
export function built(path: string): string {
  const joined = path.startsWith("/") ? path : `/${path}`;
  return `${SITE}${joined}?v=${STAMP}`;
}

/** Fetch one, cached for the life of the deployment that built it. */
export async function fetchBuilt(path: string): Promise<Response> {
  return fetch(built(path), { next: { revalidate: 3600 } });
}
