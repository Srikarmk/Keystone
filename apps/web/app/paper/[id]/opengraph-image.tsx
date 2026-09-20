import { ImageResponse } from "next/og";

import index from "@/public/dossiers/index.json";
import { OG, fontOption, serif } from "@/lib/og";

/*
 * The card for one paper.
 *
 * A link to ResNet should preview as ResNet, not as the site it lives on. The three
 * numbers are the three questions the reader answers — what it stands on, what it
 * argues with, what it takes on faith — and they come from that paper's own dossier,
 * so a card cannot claim something the page does not show.
 */

export const runtime = "nodejs";
export const alt = "A paper's citations and assumptions, read from its own source";
export const size = OG.size;
export const contentType = "image/png";

interface Built {
  title: string;
  category: string;
  stands: number;
  argues: number;
  bare: number;
  quote: string;
}

/**
 * Imported, not read from disk.
 *
 * This card renders in a serverless function, where `public/` is not on the
 * filesystem — the first version used `readFileSync` and shipped a card reading
 * "1810.04805 · 0 works it stands on" to anyone who pasted a link. An import the
 * bundler can see is the only data a dynamic route can rely on. The site's own card
 * gets away with `readFileSync` because it is generated once at build.
 */
interface Entry {
  id: string;
  title?: string;
  arxiv?: { primaryName?: string } | null;
  lineage?: { inherits?: number; extends?: number; contests?: number };
  assumptions?: { bare?: number };
  foundation?: string;
}

const BY_ID = new Map((index as Entry[]).map((entry) => [entry.id, entry]));

function read(id: string): Built | null {
  const entry = BY_ID.get(id);
  if (!entry) return null;
  const tally = entry.lineage ?? {};
  return {
    title: entry.title ?? id,
    category: entry.arxiv?.primaryName ?? "",
    stands: (tally.inherits ?? 0) + (tally.extends ?? 0),
    argues: tally.contests ?? 0,
    bare: entry.assumptions?.bare ?? 0,
    quote: entry.foundation ?? "",
  };
}

function Figure({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: 58, color: tone }}>{n}</span>
      <span style={{ fontSize: 25, color: OG.soft }}>{label}</span>
    </div>
  );
}

export default async function PaperCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const built = read(id);
  const font = await serif();
  const { paper, edge, ink, soft, faint, brass } = OG;

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
          padding: "60px 76px",
          fontFamily: "Newsreader, Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="38" height="38" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill={ink} />
            <path
              d="M4.4 26a11.6 11.6 0 0 1 23.2 0"
              fill="none"
              stroke="#5b554b"
              strokeWidth="5.4"
            />
            <path d="M11 7.3h10l-1.9 12.5h-6.2z" fill="#d0a45c" />
          </svg>
          <span style={{ fontSize: 27, color: soft }}>Keystone</span>
          {built?.category ? (
            <>
              <span style={{ fontSize: 22, color: edge }}>·</span>
              <span style={{ fontSize: 23, color: faint }}>{built.category}</span>
            </>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <span
            style={{
              // Long titles are common and a clipped one looks broken, so the size
              // steps down rather than the text being cut.
              fontSize: (built?.title.length ?? 0) > 62 ? 54 : 70,
              color: ink,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              maxWidth: 1040,
            }}
          >
            {built?.title ?? id}
          </span>
          {built?.quote ? (
            <span style={{ fontSize: 26, color: soft, maxWidth: 1000 }}>
              Stands on {built.quote}
            </span>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 46 }}>
          <Figure n={built?.stands ?? 0} label="works it stands on" tone={brass} />
          {built && built.argues > 0 ? (
            <Figure n={built.argues} label="it argues with" tone="#a2503c" />
          ) : null}
          {built && built.bare > 0 ? (
            <Figure n={built.bare} label="bare assumptions" tone={ink} />
          ) : null}
        </div>
      </div>
    ),
    { ...size, fonts: fontOption(font) },
  );
}
