"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { STANCE_VERB, type IndexEntry, type LibraryGraph, type Stance } from "@/lib/dossier";
import { connect, reachable, type Step } from "@/lib/paths";

/*
 * How one paper reaches another.
 *
 * Borrowed from Inciteful's literature connector, which finds a citation path between
 * two papers. There the edges are untyped, so a path only proves the two are
 * connected. Here each edge carries a stance read out of the citing sentence, so the
 * path reads as a chain of claims — "the Transformer adopts ResNet, which builds on
 * VGG" — and the chain itself is the answer.
 *
 * Every hop shows the cue phrase that placed it, for the same reason every other
 * reading on the site does: a chain the reader cannot check is a diagram, not a fact.
 */

const TONE: Record<Stance, string> = {
  inherits: "var(--color-brass)",
  extends: "var(--color-brass)",
  contests: "var(--color-missing)",
  compares: "var(--color-ink-soft)",
  background: "var(--color-ink-faint)",
};

export function Connector({
  graph,
  index,
}: {
  graph: LibraryGraph;
  index: IndexEntry[];
}) {
  const titles = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n.title])),
    [graph],
  );
  // Only papers the graph actually knows about — offering one with no edges would be
  // offering a question with no answer.
  const options = useMemo(
    () =>
      index
        .filter((p) => titles.has(p.id))
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })),
    [index, titles],
  );

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const ends = useMemo(
    () => (from ? reachable(graph, from) : null),
    [graph, from],
  );
  const path = useMemo(
    () => (from && to ? connect(graph, from, to) : null),
    [graph, from, to],
  );

  if (options.length < 4) return null;

  return (
    <section className="mt-16 border-t border-paper-edge pt-10">
      <h2 className="text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint">
        How two papers relate
      </h2>
      <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft">
        Every arrow in this library came out of a sentence, so a chain of them is a
        chain of things papers said about each other. Pick two and the shortest one is
        below, with the words that placed each link.
      </p>

      <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-3 text-[0.95rem]">
        <Picker
          label="from"
          value={from}
          options={options}
          onChange={(next) => {
            setFrom(next);
            if (next === to) setTo("");
          }}
        />
        <span className="text-ink-faint">to</span>
        <Picker
          label="to"
          value={to}
          options={options.filter((p) => p.id !== from && (!ends || ends.has(p.id)))}
          onChange={setTo}
          disabled={!from}
          note={
            ends && from
              ? `${ends.size} reachable within four hops`
              : undefined
          }
        />
      </div>

      {from && to ? (
        path ? (
          <ol className="mt-7 space-y-3">
            {path.map((step, i) => (
              <Hop key={i} step={step} titles={titles} />
            ))}
          </ol>
        ) : (
          <p className="mt-7 text-[0.92rem] italic text-ink-faint">
            No chain within four hops. Beyond that a path through a library this size
            connects almost anything to anything and stops explaining much, so none is
            offered.
          </p>
        )
      ) : null}
    </section>
  );
}

function Picker({
  label,
  value,
  options,
  onChange,
  disabled,
  note,
}: {
  label: string;
  value: string;
  options: IndexEntry[];
  onChange: (id: string) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[22rem] truncate border-b border-ink/25 bg-transparent pb-0.5 text-[0.95rem] text-ink outline-none transition-colors hover:border-brass focus:border-brass disabled:border-paper-edge disabled:text-ink-faint"
      >
        <option value="">{disabled ? "pick a paper first" : `a paper…`}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      {note ? (
        <span className="numeral text-[0.72rem] text-ink-faint">{note}</span>
      ) : null}
    </span>
  );
}

/** One link in the chain, in the direction the reader is travelling. */
function Hop({ step, titles }: { step: Step; titles: Map<string, string> }) {
  // The path may cross an edge against the direction of citation, and "A adopts B" and
  // "B is adopted by A" are different sentences — so the arrow has to say which.
  const [subject, object] = step.forward
    ? [step.from, step.to]
    : [step.to, step.from];
  const verb = step.forward
    ? STANCE_VERB[step.stance]
    : `is ${STANCE_VERB[step.stance]} by`;

  return (
    <li className="border-l-2 pl-3.5" style={{ borderLeftColor: TONE[step.stance] }}>
      <p className="text-[0.95rem] leading-snug">
        <Link
          href={`/paper/${subject}`}
          className="transition-colors hover:text-brass"
        >
          {titles.get(subject) ?? subject}
        </Link>{" "}
        <span style={{ color: TONE[step.stance] }}>{verb}</span>{" "}
        <Link
          href={`/paper/${object}`}
          className="transition-colors hover:text-brass"
        >
          {titles.get(object) ?? object}
        </Link>
      </p>
      {/* Clamped, not truncated. Some of these sentences run to a paragraph — BERT's
          runs to three hundred words — and four of them stacked is a wall rather than
          a chain. The whole quote stays in the document, so it still selects and
          copies whole, and the paper's own page shows it in full. */}
      <p className="mt-1 line-clamp-3 text-[0.84rem] leading-relaxed text-ink-soft">
        &ldquo;{step.sentence}&rdquo;
      </p>
      <p className="mt-0.5 text-[0.76rem] text-ink-faint">
        {step.section}
        {step.cue ? (
          <>
            {" · placed by "}
            <span style={{ color: TONE[step.stance] }}>{step.cue}</span>
          </>
        ) : null}
      </p>
    </li>
  );
}
