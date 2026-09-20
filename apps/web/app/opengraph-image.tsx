import fs from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

/*
 * The card people see before they see the site.
 *
 * A pitch link gets pasted into Slack and email far more often than it gets typed,
 * and without this it arrives as a bare URL. Rendered by Next's own image generator,
 * so no external service and nothing to keep running.
 *
 * The counts are read from the built library rather than typed in, for the same
 * reason every other number on the site is: one that has to be remembered when the
 * corpus grows is one that will be wrong.
 */

export const runtime = "nodejs";
export const alt = "Keystone — what is this paper standing on?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The site's own serif, so the card and the page are set in the same voice.
 *
 * Fetched at build rather than vendored, and wrapped because a card in the wrong
 * typeface is a much smaller problem than a build that fails when Google is slow.
 * `next/font` already has this file locally, but not at a path meant to be read.
 */
async function serif(): Promise<ArrayBuffer | null> {
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

function library(): { papers: number; edges: number } {
  try {
    const root = path.join(process.cwd(), "public", "dossiers");
    const index = JSON.parse(
      fs.readFileSync(path.join(root, "index.json"), "utf8"),
    ) as { id: string }[];
    const graph = JSON.parse(
      fs.readFileSync(path.join(root, "lineage.json"), "utf8"),
    ) as { edges: unknown[] };
    return { papers: index.length, edges: graph.edges.length };
  } catch {
    // A card without numbers is better than a build that fails over a card.
    return { papers: 0, edges: 0 };
  }
}

export default async function OpengraphImage() {
  const { papers, edges } = library();
  const font = await serif();
  const paper = "#f4f1ea";
  const ink = "#1c1a17";
  const soft = "#5b554b";
  const brass = "#a97f3d";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: paper,
          padding: "68px 76px",
          fontFamily: "Newsreader, Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="52" height="52" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill={ink} />
            <path
              d="M4.4 26a11.6 11.6 0 0 1 23.2 0"
              fill="none"
              stroke="#5b554b"
              strokeWidth="5.4"
            />
            <path d="M11 7.3h10l-1.9 12.5h-6.2z" fill="#d0a45c" />
          </svg>
          <span style={{ fontSize: 40, color: ink, letterSpacing: "-0.01em" }}>
            Keystone
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <span style={{ fontSize: 82, color: ink, letterSpacing: "-0.025em", lineHeight: 1.05 }}>
            What is this paper standing on?
          </span>
          <span style={{ fontSize: 31, color: soft, lineHeight: 1.4, maxWidth: 960 }}>
            What a paper adopts, what it argues with, and what it takes on faith —
            read out of its own sentences and pinned to the page that says it.
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 25 }}>
          <span style={{ color: brass }}>{papers} papers</span>
          <span style={{ color: "#ddd6c6" }}>·</span>
          <span style={{ color: soft }}>{edges} relationships between them</span>
          <span style={{ color: "#ddd6c6" }}>·</span>
          <span style={{ color: soft }}>every line quoted, never summarised</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: "Newsreader", data: font, style: "normal" as const, weight: 400 as const }]
        : undefined,
    },
  );
}
