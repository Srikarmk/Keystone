"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { compare, type Shared } from "@/lib/compare";
import { STANCE_VERB, type Dossier, type IndexEntry, type LineageEdge } from "@/lib/dossier";
import { edgeId } from "@/lib/rows";

/*
 * Two papers, side by side.
 *
 * The question a reader brings to two papers is rarely "what does each say" — the
 * reader answers that — but "do they rest on the same things, and where do they
 * part". Both answers are already in the two bibliographies and their citing
 * sentences; this lays them next to each other, each sentence quoted with the words
 * that placed it and a link to where it sits on its page.
 *
 * The pair lives in the URL (?a=…&b=…) so a comparison can be sent to someone.
 */

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <Compare />
    </Suspense>
  );
}

function Compare() {
  const router = useRouter();
  const params = useSearchParams();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";

  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [papers, setPapers] = useState<Record<string, Dossier | "failed">>({});

  useEffect(() => {
    fetch("/dossiers/index.json")
      .then((r) => r.json())
      .then((entries: IndexEntry[]) =>
        setIndex(
          [...entries].sort((x, y) =>
            x.title.localeCompare(y.title, undefined, { sensitivity: "base" }),
          ),
        ),
      )
      .catch(() => {});
  }, []);

  // Requested once each: the effect reruns as the first answer lands, before the
  // second has, and checking `papers` alone fetched that one twice.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const id of [a, b]) {
      if (!id || asked.current.has(id)) continue;
      asked.current.add(id);
      fetch(`/dossiers/${id}.json`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: Dossier) => setPapers((p) => ({ ...p, [id]: d })))
        .catch(() => setPapers((p) => ({ ...p, [id]: "failed" })));
    }
  }, [a, b]);

  const pick = (which: "a" | "b", id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set(which, id);
    else next.delete(which);
    router.replace(`/compare${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const left = papers[a];
  const right = papers[b];
  const ready = a && b && a !== b && left && right && left !== "failed" && right !== "failed";
  const result = useMemo(
    () => (ready ? compare(left as Dossier, right as Dossier) : null),
    [ready, left, right],
  );
  const title = (id: string) => index.find((p) => p.id === id)?.title ?? id;

  return (
    <main id="main" className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <SiteHeader />

      <section className="pt-14">
        <h1 className="pressed display max-w-4xl">Two papers, side by side</h1>
        <p className="lead mt-6 max-w-[38rem] text-ink">
          What two papers rest on together, and where they part: the works both
          adopt, the ones one adopts and the other disputes, and what each says about
          the other &mdash; every line quoted from its own paper.
        </p>

        <div className="mt-10 grid gap-x-12 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Picker label="First paper" value={a} other={b} options={index} onChange={(id) => pick("a", id)} />
          <Picker label="Second paper" value={b} other={a} options={index} onChange={(id) => pick("b", id)} />
        </div>
      </section>

      {!a || !b ? (
        <p className="mt-14 text-[1rem] italic text-ink-soft">
          Pick two papers from the library to set them side by side.
        </p>
      ) : a === b ? (
        <p className="mt-14 text-[1rem] italic text-ink-soft">That is the same paper twice.</p>
      ) : left === "failed" || right === "failed" ? (
        <p className="mt-14 text-[1rem] italic text-ink-soft">
          One of these is not in the library, so there is no bibliography to set beside
          the other. Comparison works for the library&rsquo;s papers.
        </p>
      ) : !result ? (
        <p className="mt-14 text-[1rem] italic text-ink-soft">Reading both papers&hellip;</p>
      ) : (
        <Result a={a} b={b} title={title} result={result} />
      )}

      <Footer papers={index.length || undefined} />
    </main>
  );
}

function Result({
  a,
  b,
  title,
  result,
}: {
  a: string;
  b: string;
  title: (id: string) => string;
  result: ReturnType<typeof compare>;
}) {
  const direct = result.aOnB.length + result.bOnA.length;
  return (
    <>
      {/* The pair, named once at the top so every two-column section below can be
          read against it: left is always the first paper, right the second. */}
      <div className="mt-16 grid gap-x-12 gap-y-3 border-b border-paper-edge pb-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PaperName id={a} title={title(a)} />
        <PaperName id={b} title={title(b)} />
      </div>

      <Block
        heading="What they say about each other"
        count={direct}
        empty="Neither paper cites the other with a stance it states."
      >
        {direct > 0 ? (
          <div className="grid gap-x-12 gap-y-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Column paper={a} name={title(a)} edges={result.aOnB} none="Says nothing about it." />
            <Column paper={b} name={title(b)} edges={result.bOnA} none="Says nothing about it." />
          </div>
        ) : null}
      </Block>

      <Pairs
        heading="Where they part ways"
        hint="One adopts or extends the work; the other disputes it or measures itself against it."
        items={result.partWays}
        a={a}
        b={b}
        title={title}
        empty="No work that one adopts and the other argues with."
      />
      <Pairs
        heading="What both stand on"
        hint="Works both papers adopt or extend, in each paper's own words."
        items={result.bothStandOn}
        a={a}
        b={b}
        title={title}
        empty="No work that both adopt or extend."
      />
      <Pairs
        heading="What both argue with"
        hint="Works both dispute or measure themselves against."
        items={result.bothPush}
        a={a}
        b={b}
        title={title}
        empty="No work that both argue with."
      />

      <Block
        heading="Also cited by both"
        count={result.alsoBothCite.length}
        hint="In both bibliographies, with no stance either paper states that sets them apart."
        empty="Nothing else in common."
      >
        {result.alsoBothCite.length > 0 ? (
          <ul className="grid gap-x-12 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {result.alsoBothCite.map((item) => (
              <li
                key={item.title}
                className="border-b border-paper-edge/60 py-2.5 text-[0.98rem] leading-snug"
              >
                {item.title}
              </li>
            ))}
          </ul>
        ) : null}
      </Block>

      <p className="mt-16 max-w-[38rem] text-[0.9rem] leading-relaxed text-ink-faint">
        Two references count as one work when their arXiv identifiers agree or their
        titles do once case and punctuation are set aside &mdash; the same rule the
        library links papers by. Shared assumptions are not compared: two papers
        assuming the same thing in different words is a judgement of similarity, and
        nothing on this page is a judgement.
      </p>
    </>
  );
}

function PaperName({ id, title }: { id: string; title: string }) {
  return (
    <Link href={`/paper/${id}`} className="group block min-w-0">
      <span className="block text-[1.35rem] leading-snug tracking-[-0.01em] transition-colors group-hover:text-brass">
        {title}
      </span>
      <span className="numeral mt-1 block text-[0.8rem] text-ink-faint">{id}</span>
    </Link>
  );
}

function Block({
  heading,
  count,
  hint,
  empty,
  children,
}: {
  heading: string;
  count: number;
  hint?: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20">
      <h2 className="heading">
        {heading}{" "}
        <span className="figures text-ink-faint">{count}</span>
      </h2>
      {hint ? (
        <p className="mt-3 max-w-[38rem] text-[1rem] leading-relaxed text-ink-soft">{hint}</p>
      ) : null}
      <div className="mt-7">
        {count > 0 ? children : <p className="text-[1rem] italic text-ink-faint">{empty}</p>}
      </div>
    </section>
  );
}

function Pairs({
  heading,
  hint,
  items,
  a,
  b,
  title,
  empty,
}: {
  heading: string;
  hint: string;
  items: Shared[];
  a: string;
  b: string;
  title: (id: string) => string;
  empty: string;
}) {
  return (
    <Block heading={heading} count={items.length} hint={hint} empty={empty}>
      <ul className="space-y-10">
        {items.map((item) => (
          <li key={item.title}>
            <h3 className="text-[1.12rem] leading-snug">{item.title}</h3>
            <div className="mt-4 grid gap-x-12 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Column paper={a} name={title(a)} edges={item.a.edges} none="Cites it without a stance." />
              <Column paper={b} name={title(b)} edges={item.b.edges} none="Cites it without a stance." />
            </div>
          </li>
        ))}
      </ul>
    </Block>
  );
}

function Column({
  paper,
  name,
  edges,
  none,
}: {
  paper: string;
  name: string;
  edges: LineageEdge[];
  none: string;
}) {
  // Side by side, position says which paper is speaking. Stacked on a phone it does
  // not, so each column names its paper there.
  const who = (
    <p className="mb-2 truncate text-[0.88rem] italic text-ink-faint sm:hidden">{name}</p>
  );
  if (edges.length === 0) {
    return (
      <div>
        {who}
        <p className="text-[0.95rem] italic text-ink-faint">{none}</p>
      </div>
    );
  }
  return (
    <div>
    {who}
    <ul className="space-y-5">
      {edges.map((edge, i) => (
        <li key={`${edge.key}-${i}`} className="border-l-2 border-brass/50 pl-4">
          <p className="text-[0.88rem] text-ink-soft">
            <span className="text-ink">{STANCE_VERB[edge.stance] ?? edge.stance}</span>
            {" · "}
            {edge.section}
          </p>
          <blockquote className="mt-1.5 text-[1rem] leading-relaxed text-ink">
            &ldquo;<Cue sentence={edge.sentence} cue={edge.cue} />&rdquo;
          </blockquote>
          <Link
            href={`/paper/${paper}#${edgeId(edge)}`}
            className="mt-1.5 inline-block text-[0.88rem] text-brass underline decoration-brass/40 underline-offset-4 transition-colors hover:decoration-brass"
          >
            See it on the page &rarr;
          </Link>
        </li>
      ))}
    </ul>
    </div>
  );
}

/** The sentence with the words that placed it marked, where they can be found in it. */
function Cue({ sentence, cue }: { sentence: string; cue: string }) {
  const at = cue ? sentence.toLowerCase().indexOf(cue.toLowerCase()) : -1;
  if (at < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      <mark className="bg-brass/20 px-0.5 text-ink [box-decoration-break:clone]">
        {sentence.slice(at, at + cue.length)}
      </mark>
      {sentence.slice(at + cue.length)}
    </>
  );
}

function Picker({
  label,
  value,
  other,
  options,
  onChange,
}: {
  label: string;
  value: string;
  other: string;
  options: IndexEntry[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-[0.95rem] italic text-ink-soft">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full truncate border-b border-ink/25 bg-paper pb-1.5 text-[1.05rem] text-ink outline-none transition-colors hover:border-brass focus:border-brass"
      >
        <option value="">Choose a paper&hellip;</option>
        {options.map((p) => (
          <option key={p.id} value={p.id} disabled={p.id === other}>
            {p.title}
          </option>
        ))}
      </select>
    </label>
  );
}
