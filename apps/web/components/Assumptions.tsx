"use client";

/*
 * What a paper takes as given.
 *
 * Authors announce their assumptions, because the conventions of the genre require it
 * — "we assume", "for simplicity", "it is well known that", "we conjecture". So these
 * are quotations, not readings, and the only judgement being made is which of three
 * things the paper offers in the same sentence: a citation, a pointer to its own
 * evidence, or nothing.
 *
 * "Nothing" is the interesting case and it is common in excellent work. ResNet's
 * central hypothesis — that residual mappings are easier to optimise than
 * unreferenced ones — is stated once and never established. That is not an accusation;
 * it is the most useful thing you can know before reading the rest.
 */

import { RowLink } from "@/components/RowLink";
import { assumptionId } from "@/lib/rows";
import type { AnchorJson, Assumption, AssumptionKind, AssumptionSupport } from "@/lib/dossier";

const SUPPORT_TONE: Record<AssumptionSupport, string> = {
  bare: "var(--color-missing)",
  cited: "var(--color-ink-faint)",
  shown: "var(--color-supported)",
};

const SUPPORT_LABEL: Record<AssumptionSupport, string> = {
  bare: "nothing offered",
  cited: "cites a source",
  shown: "shows its own evidence",
};

const KIND_LABEL: Record<AssumptionKind, string> = {
  stated: "assumes",
  simplifying: "simplifies",
  conventional: "defers to the field",
  conjectural: "conjectures",
  conditional: "requires",
};

export function AssumptionList({
  assumptions,
  onJump,
}: {
  assumptions: Assumption[];
  onJump: (a: AnchorJson | null) => void;
}) {
  // Bare first. The ones the paper backs up are the ones you do not need to think
  // about, so leading with them buries the finding under its own caveats.
  const order: AssumptionSupport[] = ["bare", "cited", "shown"];
  const sorted = [...assumptions].sort(
    (a, b) => order.indexOf(a.support) - order.indexOf(b.support),
  );

  if (sorted.length === 0) {
    return (
      <p className="text-[0.88rem] leading-relaxed text-ink-faint">
        This paper announces no assumptions in the usual phrases. That is not the same
        as having none &mdash; it means none are written down where they can be quoted.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {sorted.map((assumption, i) => (
        <Row key={i} assumption={assumption} onJump={onJump} />
      ))}
    </ul>
  );
}

function Row({
  assumption,
  onJump,
}: {
  assumption: Assumption;
  onJump: (a: AnchorJson | null) => void;
}) {
  const tone = SUPPORT_TONE[assumption.support];
  const id = assumptionId(assumption);
  return (
    <li
      id={id}
      className="group/row scroll-mt-6 border-l-2 pl-3.5"
      style={{ borderLeftColor: tone }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-[0.74rem] uppercase tracking-[0.1em]" style={{ color: tone }}>
          {KIND_LABEL[assumption.kind]}
        </span>
        <span className="text-[0.76rem] italic text-ink-faint">
          {SUPPORT_LABEL[assumption.support]}
        </span>
      </div>

      <p className="mt-1.5 text-[0.92rem] leading-relaxed text-ink-soft">
        &ldquo;{assumption.sentence}&rdquo;
      </p>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[0.76rem] text-ink-faint">
        <span className="truncate">{assumption.section}</span>
        {assumption.anchor ? (
          <button
            type="button"
            onClick={() => onJump(assumption.anchor)}
            className="italic text-brass transition-colors hover:text-ink"
          >
            show on p{assumption.anchor.page + 1}
          </button>
        ) : null}
        <RowLink id={id} what="assumption" />
      </div>
    </li>
  );
}

/** The count, said in a way that means something. */
export function AssumptionSummary({
  tally,
}: {
  tally: { total: number; cited: number; shown: number; bare: number };
}) {
  if (tally.total === 0) return null;
  return (
    <span className="numeral text-[0.84rem]">
      <span style={{ color: "var(--color-missing)" }}>{tally.bare} bare</span>
      {tally.cited > 0 ? (
        <span className="text-ink-faint"> &middot; {tally.cited} cited</span>
      ) : null}
      {tally.shown > 0 ? (
        <span className="text-supported"> &middot; {tally.shown} shown</span>
      ) : null}
    </span>
  );
}
