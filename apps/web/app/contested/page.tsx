"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { rowHref, useLibrary, type LibraryRow } from "@/lib/library";

/** One sentence, and every work it takes aim at. */
interface Folded {
  row: LibraryRow;
  targets: string[];
}

/*
 * Every place a paper in this library says prior work is wrong.
 *
 * This is the view the front page cannot give you. A list of papers answers "what is
 * here"; it takes the whole corpus at once to answer "where does the field argue with
 * itself", and the answer is forty sentences long — which is small enough to read all
 * of, and that is the interesting part. Disagreement in a literature is rarer and
 * more concentrated than a reader expects, and seeing all of it on one page is a
 * different experience from finding one instance at a time.
 *
 * Nothing here is inferred. Each row is a sentence a paper wrote, the cue phrase that
 * made it a disagreement, and the work it is aimed at.
 */

export default function Contested() {
  const { library, failed } = useLibrary();
  const [only, setOnly] = useState<"contests" | "compares">("contests");

  const rows = useMemo(
    () =>
      (library?.rows ?? []).filter(
        (row) => row.kind === "edge" && row.stance === only,
      ),
    [library, only],
  );

  /*
   * Grouped by the paper doing the arguing, noisiest first. The alternative —
   * grouping by the work being argued with — reads better in theory and is worse in
   * practice: most targets are argued with exactly once, so it produces forty
   * headings with one line under each.
   *
   * Within a paper, rows are then folded by sentence. One sentence can dispute three
   * works at once — "our problem differs from [Graves et al.; Kaiser et al.;
   * Neelakantan et al.]" is three citation readings and is correctly stored as three
   * rows — but printing it three times makes a correct page look broken. Folded, the
   * sentence appears once and names everything it is aimed at.
   */
  const byPaper = useMemo(() => {
    const by = new Map<string, Map<string, Folded>>();
    for (const row of rows) {
      const sentences = by.get(row.paper) ?? new Map<string, Folded>();
      const found = sentences.get(row.text) ?? { row, targets: [] };
      if (row.about && !found.targets.includes(row.about)) found.targets.push(row.about);
      sentences.set(row.text, found);
      by.set(row.paper, sentences);
    }
    return [...by.entries()]
      .map(([paper, sentences]) => [paper, [...sentences.values()]] as const)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [rows]);

  const counts = useMemo(() => {
    const edges = (library?.rows ?? []).filter((r) => r.kind === "edge");
    return {
      contests: edges.filter((r) => r.stance === "contests").length,
      compares: edges.filter((r) => r.stance === "compares").length,
      total: edges.length,
    };
  }, [library]);

  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <SiteHeader />

      <section className="pt-10">
        <h1 className="pressed max-w-3xl text-[2.5rem] leading-[1.1] tracking-[-0.02em]">
          Where the library argues with itself
        </h1>
        <p className="mt-5 max-w-2xl text-[1.02rem] leading-relaxed text-ink-soft">
          Most citations are agreement, or nothing at all. These are the sentences
          where a paper says another one is wrong, or puts itself beside it to win.
          Each is quoted as written, with the words that decided it.
        </p>
        {counts.total > 0 ? (
          <p className="numeral mt-4 text-[0.82rem] text-ink-faint">
            {counts.contests} disputes and {counts.compares} comparisons out of{" "}
            {counts.total} citation readings &mdash;{" "}
            {Math.round((100 * (counts.contests + counts.compares)) / counts.total)}% of
            the library
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center gap-6">
          <Toggle on={only === "contests"} onClick={() => setOnly("contests")}>
            says prior work is wrong{" "}
            <span className="numeral">{counts.contests}</span>
          </Toggle>
          <Toggle on={only === "compares"} onClick={() => setOnly("compares")}>
            measures itself against it{" "}
            <span className="numeral">{counts.compares}</span>
          </Toggle>
        </div>
      </section>

      <section className="mt-10 border-t border-paper-edge pt-8">
        {failed ? (
          <p className="text-[0.95rem] italic text-ink-faint">
            The library index could not be loaded.
          </p>
        ) : !library ? (
          <p className="text-[0.95rem] italic text-ink-faint">Reading the library&hellip;</p>
        ) : byPaper.length === 0 ? (
          <p className="text-[0.95rem] italic text-ink-faint">Nothing of this kind.</p>
        ) : (
          <ul className="space-y-9">
            {byPaper.map(([paper, items]) => (
              <li key={paper}>
                <h2 className="flex flex-wrap items-baseline gap-2.5 border-b border-paper-edge pb-1.5">
                  <Link
                    href={`/paper/${paper}`}
                    className="text-[1.05rem] leading-snug transition-colors hover:text-brass"
                  >
                    {library.titles[paper] ?? paper}
                  </Link>
                  <span className="numeral text-[0.72rem] text-ink-faint">
                    {paper} &middot; {items.length} sentence
                    {items.length === 1 ? "" : "s"}
                  </span>
                </h2>

                <ul className="mt-3 space-y-4">
                  {items.map(({ row, targets }) => (
                    <li
                      key={row.row + row.text.slice(0, 24)}
                      className="border-l-2 pl-4"
                      style={{
                        borderColor:
                          only === "contests"
                            ? "var(--color-missing)"
                            : "var(--color-ink-faint)",
                      }}
                    >
                      <p className="text-[0.92rem] leading-relaxed text-ink">
                        &ldquo;{row.text}&rdquo;
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[0.78rem] text-ink-faint">
                        <span>
                          placed by{" "}
                          <span className="text-brass">&ldquo;{row.cue}&rdquo;</span>
                        </span>
                        <span>{row.section}</span>
                        <Link
                          href={rowHref(row)}
                          className="text-ink-soft transition-colors hover:text-brass"
                        >
                          see it on the page &rarr;
                        </Link>
                      </p>
                      {targets.length > 0 ? (
                        <ul className="mt-1.5 space-y-0.5">
                          {targets.map((target) => (
                            <li
                              key={target}
                              className="truncate text-[0.78rem] text-ink-soft"
                              title={target}
                            >
                              &rarr; {target}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Footer papers={library ? Object.keys(library.titles).length : undefined} />
    </main>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[0.9rem] transition-colors ${
        on ? "border-b border-brass pb-0.5 text-brass" : "text-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
