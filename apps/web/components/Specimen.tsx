"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { LibraryGraph } from "@/lib/dossier";
import { edgeId } from "@/lib/rows";

/*
 * One reading from the library, set where the front page used to have empty paper.
 *
 * The page's claim is that every relationship is quoted, shown with the words that
 * placed it, and pinned to the page that says it. A reader is more likely to believe
 * that from one real sentence than from the paragraph describing it, so the front page
 * shows one, drawn at random from the library on each visit, and "another" draws again.
 *
 * Only readings that make the claim visibly: anchored to a page, with the deciding
 * words actually inside the sentence, short enough to read at a glance, and free of
 * the URL and maths debris some LaTeX leaves in prose. About half the library's
 * readings qualify; the filter is the rule, not a hand-picked list.
 */

const VERB: Record<string, string> = {
  inherits: "adopts",
  extends: "extends",
  contests: "disputes",
  compares: "measures itself against",
};

type Edge = LibraryGraph["edges"][number];

function presentable(edge: Edge): boolean {
  const sentence = edge.sentence;
  return Boolean(
    edge.anchor &&
      edge.key &&
      edge.cue &&
      sentence.length >= 70 &&
      sentence.length <= 230 &&
      sentence.toLowerCase().includes(edge.cue.toLowerCase()) &&
      !/[<>$\\]|https?:|\[ref\]/i.test(sentence),
  );
}

export function Specimen({
  graph,
  titleOf,
}: {
  graph: LibraryGraph;
  titleOf: Record<string, string>;
}) {
  const pool = useMemo(() => graph.edges.filter(presentable), [graph]);
  const [at, setAt] = useState<number | null>(null);

  // Drawn after mount, never during render: the server has no graph and no visit.
  useEffect(() => {
    if (pool.length) setAt(Math.floor(Math.random() * pool.length));
  }, [pool]);

  if (at === null || !pool[at]) return <div className="min-h-[19rem]" aria-hidden />;
  const edge = pool[at];

  const another = () => {
    if (pool.length < 2) return;
    let next = at;
    while (next === at) next = Math.floor(Math.random() * pool.length);
    setAt(next);
  };

  const start = edge.sentence.toLowerCase().indexOf(edge.cue.toLowerCase());
  const before = edge.sentence.slice(0, start);
  const cue = edge.sentence.slice(start, start + edge.cue.length);
  const after = edge.sentence.slice(start + edge.cue.length);

  return (
    <figure className="flex min-h-[19rem] flex-col justify-between bg-paper-deep/70 px-7 py-7 sm:px-9 sm:py-8">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={at}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[0.95rem] leading-snug text-ink-soft">
            <span className="text-ink">{titleOf[edge.from] ?? edge.from}</span>{" "}
            {VERB[edge.stance] ?? edge.stance}{" "}
            <span className="text-ink">{titleOf[edge.to] ?? edge.to}</span>
          </p>
          <blockquote className="mt-5 text-[1.32rem] leading-[1.5] text-ink sm:text-[1.42rem]">
            &ldquo;{before}
            <mark className="bg-brass/20 px-0.5 text-ink [box-decoration-break:clone]">
              {cue}
            </mark>
            {after}&rdquo;
          </blockquote>
        </motion.div>
      </AnimatePresence>

      <figcaption className="mt-7 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 text-[0.9rem] text-ink-soft">
        <span>
          {edge.section}
          {edge.anchor ? (
            <>
              {" "}&middot; page <span className="figures">{edge.anchor.page}</span>
            </>
          ) : null}
        </span>
        <span className="flex items-baseline gap-5">
          <button
            type="button"
            onClick={another}
            className="text-ink-soft underline decoration-ink-faint/50 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
          >
            Another
          </button>
          <Link
            href={`/paper/${edge.from}#${edgeId({ key: edge.key ?? "" })}`}
            className="text-brass underline decoration-brass/40 underline-offset-4 transition-colors hover:decoration-brass"
          >
            See it on the page &rarr;
          </Link>
        </span>
      </figcaption>
    </figure>
  );
}
