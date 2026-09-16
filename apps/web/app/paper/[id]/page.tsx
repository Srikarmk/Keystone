import { readdirSync } from "node:fs";
import { join } from "node:path";

import { Reader } from "@/components/Reader";

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
