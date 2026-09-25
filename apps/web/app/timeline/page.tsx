"use client";

import { useEffect, useMemo, useState } from "react";

import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { Timeline } from "@/components/Timeline";
import type { IndexEntry, LibraryGraph as GraphData } from "@/lib/dossier";

export default function TimelinePage() {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);

  useEffect(() => {
    fetch("/dossiers/index.json").then((r) => r.json()).then(setIndex).catch(() => {});
    fetch("/dossiers/lineage.json").then((r) => r.json()).then(setGraph).catch(() => {});
  }, []);

  // Which years the library actually covers, and how thickly. Stated rather than
  // left to be read off the chart, because a gap in a timeline is ambiguous between
  // "nothing happened" and "nothing here".
  const spread = useMemo(() => {
    const by = new Map<string, number>();
    for (const paper of index) {
      const year = (paper.arxiv?.published ?? "").slice(0, 4);
      if (year) by.set(year, (by.get(year) ?? 0) + 1);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [index]);

  const busiest = spread.reduce((best, row) => (row[1] > best[1] ? row : best), ["", 0]);

  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <SiteHeader />

      <section className="pt-10">
        <h1 className="pressed max-w-3xl text-[2.5rem] leading-[1.1] tracking-[-0.02em]">
          The library, in the order it happened
        </h1>
        <p className="mt-5 max-w-2xl text-[1.02rem] leading-relaxed text-ink-soft">
          The same papers and the same relationships as the map on the front page, laid
          out on a time axis. What it shows that the map cannot is the lag: a method
          appears, and you can see how long it took the next paper to pick it up.
        </p>
        {spread.length > 0 ? (
          <p className="numeral mt-4 text-[0.82rem] text-ink-faint">
            {index.length} papers, {spread[0][0]}&ndash;{spread[spread.length - 1][0]}
            {busiest[1] > 0 ? ` · busiest year ${busiest[0]}, ${busiest[1]} papers` : ""}
          </p>
        ) : null}
      </section>

      <section className="mt-9 border-t border-paper-edge pt-8">
        {graph && index.length > 0 ? (
          <Timeline index={index} graph={graph} />
        ) : (
          <p className="text-[0.95rem] italic text-ink-faint">Reading the library&hellip;</p>
        )}
      </section>

      <section className="mt-14 border-t border-paper-edge pt-8">
        <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint">
          Papers per year
        </h2>
        <ul className="mt-4 space-y-2">
          {spread.map(([year, n]) => (
            <li key={year} className="flex items-center gap-3">
              <span className="numeral w-12 shrink-0 text-[0.84rem] text-ink-soft">
                {year}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block h-2 rounded-[1px] bg-brass/60"
                  style={{ width: `${(n / busiest[1]) * 100}%` }}
                />
              </span>
              <span className="numeral w-6 shrink-0 text-right text-[0.78rem] text-ink-faint">
                {n}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-xl text-[0.8rem] leading-relaxed text-ink-faint">
          A thin year here means the library is thin there, not that the field was
          quiet. The corpus grew outward from a handful of papers along their own
          citations, so it is densest where those papers were looking.
        </p>
      </section>

      <Footer papers={index.length || undefined} />
    </main>
  );
}
