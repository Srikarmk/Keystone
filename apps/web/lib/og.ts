/*
 * Shared pieces for the generated social cards.
 *
 * Both cards — the site's and each paper's — are rendered by Next's own image
 * generator, so there is no external service and nothing to keep running.
 */

/** The palette, in the same values `globals.css` uses. */
export const OG = {
  paper: "#f4f1ea",
  edge: "#ddd6c6",
  ink: "#1c1a17",
  soft: "#5b554b",
  faint: "#8d8578",
  brass: "#a97f3d",
  size: { width: 1200, height: 630 },
} as const;

/**
 * The site's own serif, so a card and the page it points at are set in one voice.
 *
 * Fetched at build rather than vendored, and wrapped because a card in the wrong
 * typeface is a far smaller problem than a build that fails when Google is slow.
 * `next/font` already holds this file locally, but not at a path meant to be read.
 */
let cached: Promise<ArrayBuffer | null> | undefined;

export function serif(): Promise<ArrayBuffer | null> {
  // Memoised per process. There is one card per paper and the library is 57 strong,
  // so without this a build makes 57 identical requests to Google Fonts — slow, rude,
  // and a good way to get rate-limited into an unstyled card halfway through.
  cached ??= fetchSerif();
  return cached;
}

async function fetchSerif(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Newsreader:wght@400;500&display=swap",
      { headers: { "User-Agent": "Mozilla/5.0" } },
    ).then((r) => r.text());
    const url = /src:\s*url\((https:[^)]+\.(?:woff2?|ttf))\)/.exec(css)?.[1];
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

export function fontOption(data: ArrayBuffer | null) {
  return data
    ? [{ name: "Newsreader", data, style: "normal" as const, weight: 400 as const }]
    : undefined;
}
