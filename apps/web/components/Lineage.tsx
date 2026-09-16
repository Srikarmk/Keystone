"use client";

/*
 * What a paper stands on, and what it argues with.
 *
 * This replaced the numeric audit, and the reason is worth stating: an audit of a
 * paper's arithmetic can only report an absence of errors, and careful papers have
 * none, so its best case was a blank page. A paper's relationship to other papers is
 * different — it is always there, it is always specific, and it is written down in the
 * prose rather than inferred.
 *
 * Every row here carries the exact words that put it there. A stance is a reading, and
 * a reading the reader cannot check is just an assertion in a nicer font.
 */

import { motion } from "motion/react";
import Link from "next/link";

import type { AnchorJson, LineageEdge, Stance } from "@/lib/dossier";
import { isLoadBearing } from "@/lib/dossier";

const TONE: Record<Stance, string> = {
  inherits: "var(--color-brass)",
  extends: "var(--color-brass)",
  contests: "var(--color-missing)",
  compares: "var(--color-ink-faint)",
  background: "var(--color-ink-faint)",
};

const LABEL: Record<Stance, string> = {
  inherits: "adopts",
  extends: "extends",
  contests: "disputes",
  compares: "measures against",
  background: "mentions",
};

export function LineageList({
  edges,
  onJump,
}: {
  edges: LineageEdge[];
  onJump: (a: AnchorJson | null) => void;
}) {
  if (edges.length === 0) return null;
  return (
    <ul className="space-y-3">
      {edges.map((edge, i) => (
        <EdgeRow key={`${edge.key}-${i}`} edge={edge} onJump={onJump} />
      ))}
    </ul>
  );
}

function EdgeRow({
  edge,
  onJump,
}: {
  edge: LineageEdge;
  onJump: (a: AnchorJson | null) => void;
}) {
  const tone = TONE[edge.stance];
  return (
    <li className="border-l-2 pl-3.5" style={{ borderLeftColor: tone }}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[0.74rem] uppercase tracking-[0.1em]" style={{ color: tone }}>
          {LABEL[edge.stance]}
        </span>

        {edge.inCorpus && edge.arxivId ? (
          <Link
            href={`/paper/${edge.arxivId}`}
            className="min-w-0 flex-1 text-[0.95rem] leading-snug underline decoration-dotted decoration-1 underline-offset-2 transition-colors hover:text-brass"
          >
            {edge.title}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 text-[0.95rem] leading-snug">
            {edge.title || edge.key}
          </span>
        )}

        {edge.year ? (
          <span className="numeral shrink-0 text-[0.76rem] text-ink-faint">
            {edge.year}
          </span>
        ) : null}
      </div>

      {/* The paper's own words, with the cue that decided the reading picked out.
          Without this the stance is an assertion the reader cannot argue with. */}
      <p className="mt-1 text-[0.84rem] leading-relaxed text-ink-soft">
        <Cue sentence={edge.sentence} cue={edge.cue} tone={tone} />
      </p>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[0.76rem] text-ink-faint">
        <span className="truncate">{edge.section}</span>
        {edge.anchor ? (
          <button
            type="button"
            onClick={() => onJump(edge.anchor)}
            className="italic text-brass transition-colors hover:text-ink"
          >
            show on p{edge.anchor.page + 1}
          </button>
        ) : null}
        {edge.arxivId ? (
          <a
            href={`https://arxiv.org/abs/${edge.arxivId}`}
            target="_blank"
            rel="noreferrer"
            className="numeral transition-colors hover:text-brass"
          >
            arXiv:{edge.arxivId}
          </a>
        ) : null}
        {edge.inCorpus ? (
          <span className="text-brass">in this library</span>
        ) : null}
      </div>
    </li>
  );
}

/** The sentence, with the cue phrase marked where it occurs. */
function Cue({
  sentence,
  cue,
  tone,
}: {
  sentence: string;
  cue: string;
  tone: string;
}) {
  const at = cue ? sentence.toLowerCase().indexOf(cue.toLowerCase()) : -1;
  if (at < 0) return <>&ldquo;{sentence}&rdquo;</>;
  return (
    <>
      &ldquo;{sentence.slice(0, at)}
      <span
        className="px-[2px] font-medium"
        style={{ color: tone, background: "color-mix(in srgb, currentColor 12%, transparent)" }}
      >
        {sentence.slice(at, at + cue.length)}
      </span>
      {sentence.slice(at + cue.length)}&rdquo;
    </>
  );
}

/**
 * The headline: the one work this paper would not stand without.
 *
 * This is what the name was always reaching for. A keystone is not a table of
 * numbers — it is the piece the arch collapses without, and for almost every paper
 * that piece belongs to somebody else.
 */
export function Foundation({
  edge,
  onJump,
}: {
  edge: LineageEdge | null;
  onJump: (a: AnchorJson | null) => void;
}) {
  if (!edge) {
    return (
      <p className="text-[1.15rem] italic leading-snug text-ink-soft">
        This paper claims no method it did not build itself.
      </p>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="text-[1.3rem] leading-snug">
        Stands on{" "}
        {edge.inCorpus && edge.arxivId ? (
          <Link href={`/paper/${edge.arxivId}`} className="text-brass hover:text-ink">
            {edge.title}
          </Link>
        ) : (
          <span className="text-brass">{edge.title}</span>
        )}
        .
      </p>
      <p className="mt-1.5 text-[0.86rem] leading-relaxed text-ink-faint">
        {isLoadBearing(edge.stance)
          ? "The paper says so itself, in its "
          : "Named in its "}
        {edge.section.toLowerCase()}
        {edge.anchor ? (
          <>
            {" — "}
            <button
              type="button"
              onClick={() => onJump(edge.anchor)}
              className="italic text-brass transition-colors hover:text-ink"
            >
              p{edge.anchor.page + 1}
            </button>
          </>
        ) : null}
        .
      </p>
    </motion.div>
  );
}
