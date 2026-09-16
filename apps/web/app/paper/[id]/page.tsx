import { readdirSync } from "node:fs";
import { join } from "node:path";

import { Reader } from "@/components/Reader";

/** One static page per analysed paper, so the reader deep-links and shares. */
export function generateStaticParams() {
  const dir = join(process.cwd(), "public", "dossiers");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name !== "index.json")
    .map((name) => ({ id: name.replace(/\.json$/, "") }));
}

export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Reader id={id} />;
}
