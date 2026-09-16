"use client";

import { motion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { IndexEntry } from "@/lib/dossier";
import type { StoneDatum } from "@/components/Arch";

const Arch = dynamic(() => import("@/components/Arch").then((m) => m.Arch), {
  ssr: false,
});

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Home() {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/dossiers/index.json").then((r) => r.json()).then(setIndex).catch(() => {});
  }, []);

  const totals = useMemo(() => {
    const claims = index.reduce((n, p) => n + p.coverage.claims, 0);
    const supported = index.reduce((n, p) => n + p.coverage.supported, 0);
    return { claims, supported, papers: index.length };
  }, [index]);

  // The hero arch is built from the library's real coverage, not from decoration:
  // one stone per traced claim, one gap per claim nothing could be found for.
  const stones = useMemo<StoneDatum[]>(() => {
    if (!totals.claims) return [];
    const scale = Math.min(1, 15 / totals.claims);
    const solid = Math.max(1, Math.round(totals.supported * scale));
    const hollow = Math.max(0, Math.round((totals.claims - totals.supported) * scale));
    const ordered: StoneDatum[] = [];
    const push = (kind: StoneDatum["kind"], n: number) => {
      for (let i = 0; i < n; i += 1) {
        const stone = { kind, label: "", detail: "", claimIndex: -1 };
        ordered.length % 2 === 0 ? ordered.push(stone) : ordered.unshift(stone);
      }
    };
    push("keystone", Math.max(1, Math.round(solid / 3)));
    push("supported", solid - Math.max(1, Math.round(solid / 3)));
    push("missing", hollow);
    return ordered;
  }, [totals]);

  const filtered = index.filter((p) =>
    `${p.title} ${p.id}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <header className="flex items-center justify-between border-b border-paper-edge py-5">
        <span className="pressed text-[1.4rem] leading-none">Keystone</span>
        <a
          href="https://github.com/Srikarmk/Keystone"
          className="text-[0.8rem] italic text-ink-soft transition-colors hover:text-brass"
        >
          source
        </a>
      </header>

      <section className="grid items-center gap-8 pt-10 lg:grid-cols-[1fr_minmax(0,26rem)]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <h1 className="pressed max-w-xl text-[2.9rem] leading-[1.08] tracking-[-0.02em]">
            Which claim is holding this paper up?
          </h1>

          <p className="mt-5 max-w-lg text-[1.05rem] leading-relaxed text-ink-soft">
            Every paper makes a handful of numbers do the heavy lifting. Keystone finds
            them, traces each one back to the table it rests on, and tells you plainly
            which ones it could not find evidence for.
          </p>

          <p className="mt-4 max-w-lg text-[0.95rem] leading-relaxed text-ink-faint">
            No summaries, no paraphrase. Every trace is arithmetic over the paper&rsquo;s own
            LaTeX source, and every one of them lands on the pixels in the PDF so you can
            check it yourself in a second.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-6">
            <Link
              href={`/paper/${index[0]?.id ?? "1706.03762"}`}
              className="border-b border-brass pb-1 text-[1rem] text-brass transition-colors hover:text-ink"
            >
              Open a paper &rarr;
            </Link>
            {totals.claims > 0 ? (
              <p className="numeral text-[0.82rem] text-ink-faint">
                {totals.supported}/{totals.claims} headline numbers traced across{" "}
                {totals.papers} papers
              </p>
            ) : null}
          </div>
        </motion.div>

        <div className="h-[19rem] lg:h-[23rem]">
          {stones.length > 0 ? (
            <Arch
              stones={stones}
              collapsed={false}
              selected={null}
              onHover={() => {}}
              onSelectStone={() => {}}
            />
          ) : null}
        </div>
      </section>

      <section className="mt-16 grid gap-8 border-t border-paper-edge pt-10 sm:grid-cols-3">
        {[
          {
            n: "i",
            title: "Read the source, not the picture",
            body: "Tables, equations and citation keys come from the paper's LaTeX, so a number is what the author wrote rather than a guess at a rendered glyph.",
          },
          {
            n: "ii",
            title: "Trace every headline number",
            body: "Each figure in the abstract, introduction and conclusion is matched against every table cell — at the precision it was written to, so a rounded report is not a wrong one.",
          },
          {
            n: "iii",
            title: "Say what could not be checked",
            body: "Coverage is stated out loud. Silence is not a clean bill of health, and a tool that never admits a gap is not worth trusting about the rest.",
          },
        ].map((step, i) => (
          <motion.div
            key={step.n}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: i * 0.08, duration: 0.5, ease: EASE }}
          >
            <span className="numeral text-[0.72rem] uppercase tracking-[0.2em] text-brass">
              {step.n}
            </span>
            <h2 className="mt-2 text-[1.12rem] leading-snug">{step.title}</h2>
            <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-soft">{step.body}</p>
          </motion.div>
        ))}
      </section>

      <section className="mt-16 border-t border-paper-edge pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint">
            Analysed papers
          </h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter…"
            className="w-48 border-b border-ink/20 bg-transparent pb-1 text-[0.9rem] text-ink outline-none transition-colors placeholder:text-ink-faint/70 focus:border-brass"
          />
        </div>

        <ul className="mt-6 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {filtered.map((paper, i) => (
            <motion.li
              key={paper.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.4, ease: EASE }}
            >
              <Link
                href={`/paper/${paper.id}`}
                className="group flex items-baseline gap-4 border-b border-paper-edge/60 py-3 transition-colors hover:bg-paper-deep/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[1rem] leading-snug transition-colors group-hover:text-brass">
                    {paper.title}
                  </span>
                  <span className="mt-0.5 block text-[0.8rem] text-ink-faint">
                    {paper.keystone
                      ? `rests on ${paper.keystone.table}`
                      : paper.coverage.claims === 0
                        ? "no numeric claims up front"
                        : "no single load-bearing table"}
                  </span>
                </span>

                <CoveragePips coverage={paper.coverage} />
              </Link>
            </motion.li>
          ))}
        </ul>

        {filtered.length === 0 && index.length > 0 ? (
          <p className="mt-6 text-[0.92rem] italic text-ink-faint">
            Nothing matches &ldquo;{query}&rdquo;.
          </p>
        ) : null}
      </section>

      <footer className="mt-20 border-t border-paper-edge pt-6 text-[0.82rem] leading-relaxed text-ink-faint">
        <p className="max-w-2xl">
          Keystone checks what a paper says against itself. It does not judge whether the
          idea is good, and finding nothing is not a clean bill of health — the coverage
          figure on each paper says how much could be checked at all. Analysis currently
          covers arXiv papers that ship LaTeX source; roughly one in ten does not.
        </p>
      </footer>
    </main>
  );
}

function CoveragePips({ coverage }: { coverage: IndexEntry["coverage"] }) {
  if (coverage.claims === 0) {
    return <span className="numeral shrink-0 text-[0.78rem] text-ink-faint">—</span>;
  }
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="flex gap-[2px]">
        {Array.from({ length: Math.min(coverage.claims, 12) }, (_, i) => {
          const verified = i < coverage.supported;
          const declared =
            !verified && i < coverage.supported + (coverage.declared ?? 0);
          return (
            <span
              key={i}
              className="h-3 w-[5px] rounded-[1px]"
              style={{
                background: verified
                  ? "var(--color-supported)"
                  : declared
                    ? "var(--color-ink-faint)"
                    : "transparent",
                border: verified || declared
                  ? "1px solid transparent"
                  : "1px dashed var(--color-missing)",
                opacity: declared ? 0.5 : 1,
              }}
            />
          );
        })}
      </span>
      <span className="numeral text-[0.78rem] text-ink-soft">
        {coverage.supported}/{coverage.claims}
      </span>
    </span>
  );
}
