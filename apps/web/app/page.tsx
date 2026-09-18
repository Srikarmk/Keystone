"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type {
  Accuracy,
  IndexEntry,
  LibraryGraph as GraphData,
} from "@/lib/dossier";
import { LibraryGraph } from "@/components/LibraryGraph";
import { ThemeToggle } from "@/components/ThemeToggle";

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Home() {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/dossiers/index.json")
      .then((r) => r.json())
      .then((entries: IndexEntry[]) =>
        setIndex(
          [...entries].sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
          ),
        ),
      )
      .catch(() => {});
    fetch("/dossiers/lineage.json").then((r) => r.json()).then(setGraph).catch(() => {});
    fetch("/dossiers/accuracy.json").then((r) => r.json()).then(setAccuracy).catch(() => {});
  }, []);

  const totals = useMemo(() => {
    const stands = index.reduce(
      (n, p) => n + (p.lineage?.inherits ?? 0) + (p.lineage?.extends ?? 0),
      0,
    );
    const bare = index.reduce((n, p) => n + (p.assumptions?.bare ?? 0), 0);
    return { stands, bare, papers: index.length };
  }, [index]);

  // Search reaches into the analysis, not just the titles. With forty-odd papers the
  // useful question is "which paper says something about layer normalisation", and the
  // answer is in the sentences the lineage layer already extracted — so a match on an
  // edge's quote counts as a match on the paper that wrote it.
  const needle = query.trim().toLowerCase();
  const matchedEdges = useMemo(() => {
    if (needle.length < 3 || !graph) return [];
    return graph.edges.filter((edge) =>
      `${edge.sentence} ${edge.cue} ${edge.section}`.toLowerCase().includes(needle),
    );
  }, [needle, graph]);

  const filtered = useMemo(() => {
    if (!needle) return index;
    const viaEdge = new Set(matchedEdges.flatMap((e) => [e.from, e.to]));
    return index.filter(
      (p) =>
        `${p.title} ${p.id}`.toLowerCase().includes(needle) || viaEdge.has(p.id),
    );
  }, [index, needle, matchedEdges]);

  const titleOf = useMemo(
    () => Object.fromEntries((graph?.nodes ?? []).map((n) => [n.id, n.title])),
    [graph],
  );

  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <header className="flex items-center justify-between border-b border-paper-edge py-5">
        <span className="pressed text-[1.4rem] leading-none">Keystone</span>
        <span className="flex items-center gap-5">
          <ThemeToggle />
          <a
            href="https://github.com/Srikarmk/Keystone"
            className="text-[0.8rem] italic text-ink-soft transition-colors hover:text-brass"
          >
            source
          </a>
        </span>
      </header>

      <section className="pt-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="max-w-3xl"
        >
          <h1 className="pressed text-[2.9rem] leading-[1.08] tracking-[-0.02em]">
            What is this paper standing on?
          </h1>

          <p className="mt-5 max-w-2xl text-[1.05rem] leading-relaxed text-ink-soft">
            No paper stands by itself. Each one adopts a method from somebody, argues
            with somebody else, and takes a handful of things on faith without saying
            so. Keystone reads all three out of the paper&rsquo;s own sentences.
          </p>

          <p className="mt-4 max-w-2xl text-[0.95rem] leading-relaxed text-ink-faint">
            Not a summary and not a guess. Every relationship below is quoted from the
            LaTeX, shown with the words that placed it, and pinned to the pixels on the
            page where the paper admits it.
          </p>

          {/* The error rate, up front. Reading a cue out of position produces a
              confident opposite rather than a vague answer, so the rate at which that
              happens is the first thing a reader is owed. */}
          {accuracy && accuracy.heldOutAccuracy !== null ? (
            <p className="mt-4 max-w-2xl text-[0.95rem] leading-relaxed text-ink-faint">
              And it is wrong sometimes:{" "}
              <span className="numeral text-ink-soft">
                {Math.round(accuracy.heldOutAccuracy * 100)}%
              </span>{" "}
              of readings were correct on{" "}
              <span className="numeral">{accuracy.heldOut}</span> citations labelled by
              hand after the rules were last changed, against{" "}
              <span className="numeral">
                {Math.round(accuracy.baselineAccuracy * 100)}%
              </span>{" "}
              for a bag-of-words classifier over the same sentences. Every row shows
              its sentence so you can see which kind you are looking at.
            </p>
          ) : null}

          <div className="mt-7 flex flex-wrap items-center gap-6">
            <Link
              href={`/paper/${index[0]?.id ?? "1706.03762"}`}
              className="border-b border-brass pb-1 text-[1rem] text-brass transition-colors hover:text-ink"
            >
              Open a paper &rarr;
            </Link>
            {totals.papers > 0 ? (
              <p className="numeral text-[0.82rem] text-ink-faint">
                {totals.stands} dependencies and {totals.bare} bare assumptions across{" "}
                {totals.papers} papers
              </p>
            ) : null}
          </div>
        </motion.div>

        {/* The library, drawn as what it is: a chain of papers leaning on each other.
            Every edge came out of a sentence, and hovering one shows the sentence. */}
        <div className="mt-9">
          {graph ? <LibraryGraph data={graph} /> : <div className="h-[22rem]" />}
        </div>
      </section>

      <section className="mt-16 grid gap-8 border-t border-paper-edge pt-10 sm:grid-cols-3">
        {[
          {
            n: "i",
            title: "A citation is not a neutral pointer",
            body: "\u201cFollowing Ba et al. we normalise each layer\u201d and \u201cunlike Ba et al., we normalise across the batch\u201d are opposite statements about the same paper. The difference is written down, so it does not have to be inferred.",
          },
          {
            n: "ii",
            title: "Assumptions are announced, then forgotten",
            body: "\u201cWe hypothesize\u201d, \u201cfor simplicity\u201d, \u201cit is well known that\u201d. Each one is quoted verbatim next to what the paper offers for it in the same sentence \u2014 a citation, its own evidence, or nothing at all.",
          },
          {
            n: "iii",
            title: "Every line is checkable in a second",
            body: "The words that placed a reading are shown beside it, and a click puts you on the page where the paper says it. A reading you cannot argue with is just an assertion in a nicer font.",
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
            placeholder="search titles and quoted sentences…"
            className="w-72 border-b border-ink/20 bg-transparent pb-1 text-[0.9rem] text-ink outline-none transition-colors placeholder:text-ink-faint/70 focus:border-brass"
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
                    {describe(paper)}
                  </span>
                </span>

                <LineagePips paper={paper} />
              </Link>
            </motion.li>
          ))}
        </ul>

        {matchedEdges.length > 0 ? (
          <div className="mt-7 border-t border-paper-edge pt-5">
            <h3 className="text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint">
              {matchedEdges.length} quoted sentence
              {matchedEdges.length === 1 ? "" : "s"} mention this
            </h3>
            <ul className="mt-3 space-y-3">
              {matchedEdges.slice(0, 12).map((edge, i) => (
                <li key={i} className="border-l-2 border-brass/60 pl-3.5">
                  <p className="text-[0.84rem] text-ink-soft">
                    <Link
                      href={`/paper/${edge.from}`}
                      className="text-ink transition-colors hover:text-brass"
                    >
                      {titleOf[edge.from] ?? edge.from}
                    </Link>
                    <span className="text-ink-faint"> &middot; {edge.section}</span>
                  </p>
                  <p className="mt-0.5 text-[0.86rem] italic leading-relaxed text-ink-soft">
                    &ldquo;{edge.sentence}&rdquo;
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {filtered.length === 0 && index.length > 0 ? (
          <p className="mt-6 text-[0.92rem] italic text-ink-faint">
            Nothing matches &ldquo;{query}&rdquo;.
          </p>
        ) : null}
      </section>

      <footer className="mt-20 border-t border-paper-edge pt-6 text-[0.82rem] leading-relaxed text-ink-faint">
        <p className="max-w-2xl">
          Keystone reports what a paper says about other papers and about its own
          assumptions, in the paper&rsquo;s own words. It does not judge whether the
          idea is good, and a citation it says nothing about is one where the prose
          made nothing checkable &mdash; not one that does not matter. Analysis covers
          arXiv papers that ship LaTeX source; roughly one in ten does not.
        </p>
      </footer>
    </main>
  );
}

/** A one-line account of what the paper leans on, for the library row. */
function describe(paper: IndexEntry): string {
  const stands = (paper.lineage?.inherits ?? 0) + (paper.lineage?.extends ?? 0);
  const parts = [
    stands > 0 ? `stands on ${stands}` : null,
    paper.lineage?.contests ? `argues with ${paper.lineage.contests}` : null,
    paper.assumptions?.bare ? `${paper.assumptions.bare} bare assumptions` : null,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(" \u00b7 ");
  const density = paper.density;
  if (!density) return "argues in prose";
  return `${density.tables} tables \u00b7 ${density.references} references indexed`;
}

/**
 * Three marks per paper: what it takes, what it disputes, what it assumes without
 * support. The coverage pips this replaced counted numbers, and four of nine papers
 * state none, so a third of the library rendered as an em dash.
 */
function LineagePips({ paper }: { paper: IndexEntry }) {
  const stands = (paper.lineage?.inherits ?? 0) + (paper.lineage?.extends ?? 0);
  const marks: { n: number; tone: string; title: string }[] = [
    { n: stands, tone: "var(--color-brass)", title: `stands on ${stands} works` },
    {
      n: paper.lineage?.contests ?? 0,
      tone: "var(--color-missing)",
      title: `argues with ${paper.lineage?.contests ?? 0} works`,
    },
    {
      n: paper.assumptions?.bare ?? 0,
      tone: "var(--color-ink-faint)",
      title: `${paper.assumptions?.bare ?? 0} assumptions with nothing offered`,
    },
  ];

  return (
    <span className="flex shrink-0 items-center gap-2.5">
      {marks.map((mark, i) => (
        <span key={i} className="flex items-center gap-1" title={mark.title}>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: mark.tone, opacity: mark.n > 0 ? 1 : 0.25 }}
          />
          <span
            className="numeral text-[0.78rem]"
            style={{ color: mark.n > 0 ? "var(--color-ink-soft)" : "var(--color-ink-faint)" }}
          >
            {mark.n}
          </span>
        </span>
      ))}
    </span>
  );
}
