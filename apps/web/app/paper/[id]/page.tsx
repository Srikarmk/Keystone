import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";

import { Reader } from "@/components/Reader";

/** The dossier's own title and counts, read at build. */
function dossier(id: string): { title: string; stands: number; bare: number } | null {
  try {
    const raw = readFileSync(
      join(process.cwd(), "public", "dossiers", `${id}.json`),
      "utf8",
    );
    const built = JSON.parse(raw) as {
      title?: string;
      lineage?: { tally?: { inherits?: number; extends?: number } };
      assumptionTally?: { bare?: number };
    };
    return {
      title: built.title ?? id,
      stands: (built.lineage?.tally?.inherits ?? 0) + (built.lineage?.tally?.extends ?? 0),
      bare: built.assumptionTally?.bare ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * A shared link should say which paper it is before the page loads.
 *
 * The description is built from the paper's own counts rather than a fixed blurb,
 * because the interesting thing about a link to ResNet is that it rests on six works
 * and states five assumptions with nothing behind them — not that Keystone exists.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const built = dossier(id);
  if (!built) return { title: id };
  const parts = [
    built.stands > 0 ? `Rests on ${built.stands} works` : null,
    built.bare > 0 ? `${built.bare} assumptions stated with nothing behind them` : null,
  ].filter(Boolean);
  const description = parts.length
    ? `${parts.join(", ")} — each quoted from the paper's own source and pinned to the page.`
    : "Citations and assumptions read out of the paper's own source.";
  // No `images` here on purpose: `opengraph-image.tsx` in this segment supplies it.
  // Naming one would override the generated card with a static path.
  return {
    title: built.title,
    description,
    openGraph: { title: `${built.title} — Keystone`, description },
  };
}

/** One static page per analysed paper, so the reader deep-links and shares. */
export function generateStaticParams() {
  const dir = join(process.cwd(), "public", "dossiers");
  // Library-level files and the server-only prose files sit in the same directory.
  // Name-based exclusion let lineage.json through and built a junk /paper/lineage
  // route, so match the shape of an arXiv identifier instead: nothing but a paper
  // is ever a paper.
  const ARXIV_ID = /^\d{4}\.\d{4,5}(v\d+)?\.json$/;
  return readdirSync(dir)
    .filter((name) => ARXIV_ID.test(name))
    .map((name) => ({ id: name.replace(/\.json$/, "") }));
}

export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Reader id={id} />;
}
