"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type {
  Accuracy,
  External as ExternalScore,
  IndexEntry,
  LibraryGraph as GraphData,
} from "@/lib/dossier";
import { categoryLabel, categoryOf } from "@/lib/dossier";
import { AddPaper } from "@/components/AddPaper";
import { Connector } from "@/components/Connector";
import { Footer } from "@/components/Footer";
import { LibraryGraph } from "@/components/LibraryGraph";
import { SiteHeader } from "@/components/SiteHeader";
import { Specimen } from "@/components/Specimen";

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Home() {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

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

  // The broadest public corpus the rules were scored against, preferred over the
  // hand-labelled sample because that sample came from these same papers.
  const external = useMemo(
    () =>
      (accuracy?.external ?? []).reduce<ExternalScore | null>(
        (best, item) => (best && best.instances >= item.instances ? best : item),
        null,
      ),
    [accuracy],
  );

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

  // Grouped by arXiv's own primary category, biggest group first. Not a taxonomy I
  // invented: the library's whole claim is that what it shows came from the paper, and
  // a heading reading "Computer Vision" over a paper arXiv files under cs.CL would be
  // the first thing on the page that did not.
  const groups = useMemo(() => {
    const by = new Map<string, { code: string; label: string; papers: IndexEntry[] }>();
    for (const paper of filtered) {
      const code = categoryOf(paper);
      const group = by.get(code) ?? { code, label: categoryLabel(paper), papers: [] };
      group.papers.push(paper);
      by.set(code, group);
    }
    return [...by.values()].sort(
      (a, b) => b.papers.length - a.papers.length || a.label.localeCompare(b.label),
    );
  }, [filtered]);

  const shown = useMemo(
    () => (category ? groups.filter((g) => g.code === category) : groups),
    [groups, category],
  );

  const titleOf = useMemo(
    () => Object.fromEntries((graph?.nodes ?? []).map((n) => [n.id, n.title])),
    [graph],
  );

  /*
   * The works the rest of the library is built on top of, by how many papers here
   * take something from them.
   *
   * In-degree over adopt-and-extend edges only. Counting every edge would put the
   * most *argued with* paper at the top of a list headed "what the library rests
   * on", which is the opposite of what it says — and a citation this library
   * merely mentions is not something it stands on either.
   */
  const foundations = useMemo(() => {
    if (!graph) return [];
    const by = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
      if (edge.stance !== "inherits" && edge.stance !== "extends") continue;
      if (edge.from === edge.to) continue;
      const leaning = by.get(edge.to) ?? new Set<string>();
      leaning.add(edge.from);
      by.set(edge.to, leaning);
    }
    return [...by.entries()]
      .map(([id, on]) => ({ id, n: on.size }))
      .filter((row) => row.n > 1)
      .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
      .slice(0, 8);
  }, [graph]);

  return (
    <main id="main" className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <SiteHeader />

      <section className="pt-14 sm:pt-20">
        {/* The hero enters on the CSS `settle` animation rather than motion/react: it
            runs on the clock, not on script, so the first screen is never left at
            opacity 0 waiting for hydration, and it already honours reduced motion. */}
        <h1 className="settle pressed display-hero max-w-[15ch] lg:max-w-none">
          What is this paper standing on?
        </h1>

        <div className="mt-10 grid items-start gap-12 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div className="settle" style={{ animationDelay: "80ms" }}>
            <p className="lead max-w-[36rem] text-ink">
              No paper stands by itself. Each one adopts a method from somebody, argues
              with somebody else, and takes a handful of things on faith without saying
              so. Keystone reads all three out of the paper&rsquo;s own sentences.
            </p>

            <p className="mt-4 max-w-[36rem] text-[1.02rem] leading-relaxed text-ink-soft">
              Not a summary and not a guess. Every relationship below is quoted from the
              LaTeX, shown with the words that placed it, and pinned to the pixels on the
              page where the paper admits it.
            </p>

            {/* The error rate stays above the fold, but as one sentence with a way in
                rather than the five-line statistical paragraph that used to sit here.
                A reader deciding whether to trust the page needs the headline figure
                and a door; a reader who wants the Wilson interval will walk through it. */}
            {external ? (
              <p className="mt-4 max-w-[36rem] text-[1.02rem] leading-relaxed text-ink-soft">
                It is also often silent, and sometimes wrong: on{" "}
                <span className="figures">{external.instances.toLocaleString()}</span>{" "}
                citations labelled by other people it reported a stance for{" "}
                <span className="figures text-ink">
                  {Math.round(external.coverage * 100)}%
                </span>{" "}
                of them and got{" "}
                <span className="figures text-ink">
                  {Math.round(external.spokenPrecision * 100)}%
                </span>{" "}
                of those right.{" "}
                <Link
                  href="/method"
                  className="text-brass underline decoration-brass/40 underline-offset-4 transition-colors hover:decoration-brass"
                >
                  How it reads, and how often it is wrong &rarr;
                </Link>
              </p>
            ) : null}

            <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
              <Link
                href={`/paper/${index[0]?.id ?? "1706.03762"}`}
                className="inline-flex min-h-12 items-center bg-ink px-6 text-[1rem] text-paper transition-colors hover:bg-brass active:translate-y-px"
              >
                Open a paper &rarr;
              </Link>
              {totals.papers > 0 ? (
                <p className="figures text-[0.95rem] text-ink-soft">
                  {totals.stands.toLocaleString()} dependencies and{" "}
                  {totals.bare.toLocaleString()} bare assumptions across {totals.papers}{" "}
                  papers
                </p>
              ) : null}
            </div>
          </div>

          {/* The claim above, demonstrated with one real sentence from the library. */}
          <div className="settle" style={{ animationDelay: "160ms" }}>
            {graph ? <Specimen graph={graph} titleOf={titleOf} /> : <div className="min-h-[19rem]" />}

            {/* The library is a demonstration; this is the tool. Put where the reader
                is already deciding what to open, rather than on a page of its own that
                nobody would think to look for. */}
            <div className="mt-12">
              <h2 className="text-[1.25rem] leading-snug">Or read your own</h2>
              <div className="mt-4">
                <AddPaper />
              </div>
            </div>
          </div>
        </div>

        {/* The library, drawn as what it is: a chain of papers leaning on each other.
            Every edge came out of a sentence, and hovering one shows the sentence. */}
        <div className="mt-20">
          {graph ? <LibraryGraph data={graph} /> : <div className="h-[22rem]" />}
        </div>
      </section>

      {/* The graph shows every relationship at once; this answers one question about
          two papers. Placed after it because the graph is what makes the question
          occur to a reader in the first place. */}
      {graph && index.length > 0 ? (
        <Connector graph={graph} index={index} />
      ) : null}

      <section aria-label="What Keystone reads" className="mt-28 grid gap-x-12 gap-y-10 sm:grid-cols-3">
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
            <h2 className="text-[1.3rem] leading-snug tracking-[-0.01em]">{step.title}</h2>
            <p className="mt-3 text-[1rem] leading-relaxed text-ink-soft">{step.body}</p>
          </motion.div>
        ))}
      </section>

      {foundations.length > 0 ? (
        <section className="mt-28">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="heading">What the library rests on</h2>
            <Link
              href="/contested"
              className="text-[0.95rem] text-ink-soft transition-colors hover:text-brass"
            >
              and where it argues with itself &rarr;
            </Link>
          </div>
          <p className="mt-4 max-w-[38rem] text-[1rem] leading-relaxed text-ink-soft">
            The works other papers here take a method or a setup from, counted by how
            many of them do it. Adoption only &mdash; a paper that is argued with a
            great deal is not one the library is standing on.
          </p>

          <ul className="mt-8">
            {foundations.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/paper/${row.id}`}
                  className="group flex items-center gap-4 border-b border-paper-edge/60 py-3.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[1.05rem] transition-colors group-hover:text-brass">
                    {titleOf[row.id] ?? row.id}
                  </span>
                  <span className="hidden w-32 shrink-0 sm:block">
                    <span
                      className="block h-1.5 rounded-[1px] bg-brass/50"
                      style={{ width: `${(row.n / foundations[0].n) * 100}%` }}
                    />
                  </span>
                  <span className="figures w-20 shrink-0 text-right text-[0.92rem] text-ink-soft">
                    {row.n} papers
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-28">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <h2 className="heading">
            Analysed papers{" "}
            {index.length > 0 ? (
              <span className="figures text-ink-faint">{index.length}</span>
            ) : null}
          </h2>
          <input
            type="search"
            name="q"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search titles and quoted sentences"
            placeholder="Search titles and quoted sentences…"
            className="w-full border-b border-ink/25 bg-transparent pb-1.5 text-[1rem] text-ink outline-none transition-colors placeholder:text-ink-faint sm:w-80 focus:border-brass"
          />
        </div>

        {/* Filters rather than tabs: the default is the whole library, because a
            reader who does not already know the field cannot pick a category first. */}
        {groups.length > 1 ? (
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2.5">
            <button
              type="button"
              onClick={() => setCategory(null)}
              aria-pressed={category === null}
              className={`py-1 text-[0.9rem] underline-offset-[6px] transition-colors ${
                category === null
                  ? "text-ink underline decoration-brass"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              everything{" "}
              <span className="figures text-ink-faint">{filtered.length}</span>
            </button>
            {groups.map((group) => (
              <button
                key={group.code}
                type="button"
                onClick={() =>
                  setCategory(category === group.code ? null : group.code)
                }
                title={group.code}
                aria-pressed={category === group.code}
                className={`py-1 text-[0.9rem] underline-offset-[6px] transition-colors ${
                  category === group.code
                    ? "text-ink underline decoration-brass"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {group.label}{" "}
                <span className="figures text-ink-faint">{group.papers.length}</span>
              </button>
            ))}
          </div>
        ) : null}

        {shown.map((group) => (
          <div key={group.code} className="mt-12">
            {/* The code is shown next to the name so the grouping is checkable: a
                reader can put cs.CL into arxiv.org and see the same paper there. */}
            <h3 className="flex items-baseline gap-3 border-b border-paper-edge pb-2">
              <span className="text-[1.15rem]">{group.label}</span>
              <span className="numeral text-[0.78rem] text-ink-faint">
                {group.code} · {group.papers.length}
              </span>
            </h3>
            {/* minmax(0, 1fr), not the default auto: a grid column sized by content
                grows to fit its longest truncated title, and on a phone that pushed the
                list past the right edge of the screen and the counts out of sight. */}
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-x-10 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
              {group.papers.map((paper, i) => (
                <motion.li
                  key={paper.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: Math.min(i, 8) * 0.04,
                    duration: 0.4,
                    ease: EASE,
                  }}
                >
                  <Link
                    href={`/paper/${paper.id}`}
                    className="group flex items-baseline gap-4 border-b border-paper-edge/60 py-3.5 transition-colors hover:bg-paper-deep/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[1.03rem] leading-snug transition-colors group-hover:text-brass">
                        {paper.title}
                      </span>
                      <span className="mt-1 block text-[0.86rem] text-ink-soft">
                        {describe(paper)}
                      </span>
                    </span>

                    <LineagePips paper={paper} />
                  </Link>
                </motion.li>
              ))}
            </ul>
          </div>
        ))}

        {matchedEdges.length > 0 ? (
          <div className="mt-7 border-t border-paper-edge pt-5">
            <h3 className="text-[1.15rem]">
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

      <Footer papers={totals.papers} />

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
