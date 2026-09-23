"use client";

/*
 * What the reader marked, beside what Keystone read.
 *
 * The second half of that is the part worth having. Every other tool that lets you
 * highlight a PDF gives you back a list of your own highlights; this one can also say
 * "the sentence you just underlined is the one the stance layer read as disputing
 * Bahdanau" — because a mark and an anchor are rectangles on the same page in the same
 * units, so the link is `overlaps()` and not a model call. No tokens, no key, no
 * guessing: either the rectangles intersect or they do not.
 *
 * It cuts both ways, which is the point. A reader who marks something Keystone missed
 * sees it named as missed, and that is a more useful thing for them to know than a
 * coverage percentage.
 */

import type { Assumption, Claim, LineageEdge, Stance } from "@/lib/dossier";
import type { AnchorJson } from "@/lib/dossier";
import { readingsFor, type Mark, type MarkColour } from "@/lib/marks";
import { assumptionId, edgeId } from "@/lib/rows";

const SWATCH: Record<MarkColour, string> = {
  brass: "#d0a45c",
  moss: "#7d9c79",
  rose: "#c4796c",
  slate: "#7e9ab8",
};

const STANCE: Record<Stance, string> = {
  inherits: "adopts",
  extends: "extends",
  contests: "disputes",
  compares: "measures against",
  background: "mentions",
};

export interface Reading {
  id: string;
  anchor: AnchorJson | null;
  /** What Keystone made of these words, in a phrase. */
  says: string;
  /** The section it sits in, to place it. */
  where: string;
}

/**
 * Everything Keystone anchored in this paper, flattened into one comparable list.
 *
 * Claims are included last on purpose: a claim's anchor is a sentence in the abstract
 * that usually also carries a citation, and where both match the citation is the more
 * specific reading of the two.
 */
export function readingsOf(dossier: {
  lineage: { edges: LineageEdge[] };
  assumptions: Assumption[];
  claims: Claim[];
}): Reading[] {
  return [
    ...dossier.lineage.edges.map((edge) => ({
      id: edgeId(edge),
      anchor: edge.anchor,
      says: `${STANCE[edge.stance]} ${edge.authors || edge.title || edge.key}`,
      where: edge.section,
    })),
    ...dossier.assumptions.map((assumption) => ({
      id: assumptionId(assumption),
      anchor: assumption.anchor,
      says:
        assumption.support === "bare"
          ? "an assumption stated with nothing offered for it"
          : `an assumption, ${assumption.support === "cited" ? "cited" : "shown"}`,
      where: assumption.section,
    })),
    ...dossier.claims.map((claim, i) => ({
      id: `claim-${i}`,
      anchor: claim.anchor,
      says: "a headline claim, traced to its table",
      where: "abstract",
    })),
  ];
}

export function NoteList({
  marks,
  readings,
  active,
  onPick,
  onDelete,
}: {
  marks: Mark[];
  readings: Reading[];
  active: string | null;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <ul className="space-y-3.5">
      {marks.map((mark) => {
        const found = readingsFor(mark, readings);
        return (
          <li
            key={mark.id}
            className={`group/row rounded-[2px] border-l-2 pl-3 transition-colors ${
              active === mark.id ? "bg-paper-deep/50" : ""
            }`}
            style={{ borderColor: SWATCH[mark.colour] }}
          >
            <button
              type="button"
              onClick={() => onPick(mark.id)}
              className="block w-full text-left"
            >
              <p className="text-[0.88rem] leading-relaxed text-ink">
                &ldquo;{mark.quote.length > 320 ? `${mark.quote.slice(0, 320)}…` : mark.quote}&rdquo;
              </p>
            </button>

            {mark.note ? (
              <p className="mt-1.5 whitespace-pre-wrap text-[0.86rem] leading-relaxed text-ink-soft">
                {mark.note}
              </p>
            ) : null}

            <div className="mt-1 flex items-baseline gap-3 text-[0.75rem] text-ink-faint">
              <span className="numeral">p{mark.page + 1}</span>
              {/* What the parser made of the same words, if it made anything. Named
                  as absence when it did not: a reader who marks a sentence Keystone
                  passed over has found a gap, and hiding that would be flattering
                  the tool at their expense. */}
              {found.length > 0 ? (
                <a
                  href={`#${found[0].id}`}
                  className="truncate text-brass decoration-brass/40 underline-offset-2 hover:underline"
                  title="Open what Keystone read here"
                >
                  Keystone read this as {found[0].says}
                  {found.length > 1 ? ` (+${found.length - 1} more)` : ""}
                </a>
              ) : (
                <span className="italic">Keystone read nothing here</span>
              )}
              <button
                type="button"
                onClick={() => onDelete(mark.id)}
                className="ml-auto shrink-0 opacity-0 transition-[color,opacity] hover:text-missing focus-visible:opacity-100 group-hover/row:opacity-100"
              >
                remove
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The state of marking itself, said plainly rather than left to an empty list. */
export function NoteState({
  signedIn,
  storing,
  loading,
  count,
}: {
  signedIn: boolean;
  storing: boolean;
  loading: boolean;
  count: number;
}) {
  if (loading) {
    return <p className="text-[0.86rem] italic text-ink-faint">Fetching your marks&hellip;</p>;
  }
  if (!signedIn) {
    return (
      <p className="max-w-prose text-[0.88rem] leading-relaxed text-ink-soft">
        Everything else here is open to a guest, because everything else here is a
        public paper quoted from a public source. Your own highlights are not that:
        they are yours, and keeping them needs somewhere to keep them.{" "}
        <a
          href="/signin"
          className="text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
        >
          Sign in
        </a>{" "}
        and they follow you between machines.
      </p>
    );
  }
  if (!storing) {
    return (
      <p className="max-w-prose text-[0.88rem] leading-relaxed text-ink-soft">
        You are signed in, but this deployment has no store configured, so a mark could
        not be kept. Marking is switched off rather than offered and then lost.
      </p>
    );
  }
  if (count === 0) {
    return (
      <p className="max-w-prose text-[0.88rem] leading-relaxed text-ink-soft">
        Select any words in the paper to highlight them, and add a note if you want
        one. Where a mark lands on something Keystone read, the reading is named
        beside it &mdash; and where it does not, that is said too.
      </p>
    );
  }
  return null;
}
