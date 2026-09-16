"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import Link from "next/link";

import type { Claim, Dossier, IndexEntry } from "@/lib/dossier";
import { declaredAs, isDeclared, isSupported } from "@/lib/dossier";
import { EvidenceMap } from "@/components/EvidenceMap";
import { PaperView } from "@/components/PaperView";

const EASE = [0.16, 1, 0.3, 1] as const;

export function Reader({ id }: { id: string }) {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [current, setCurrent] = useState(id);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);

  useEffect(() => {
    fetch("/dossiers/index.json").then((r) => r.json()).then(setIndex).catch(() => {});
  }, []);

  useEffect(() => {
    setDossier(null);
    setSelected(null);
    setShowEvidence(false);
    fetch(`/dossiers/${current}.json`)
      .then((r) => r.json())
      .then(setDossier)
      .catch(() => setDossier(null));
  }, [current]);

  const claim = dossier && selected !== null ? dossier.claims[selected] : null;

  // Selecting a claim shows where it is stated. The evidence sits on another page, so
  // it is a second, deliberate step rather than a jump the reader did not ask for.
  const highlight = claim
    ? showEvidence
      ? (claim.evidenceAnchor ?? claim.anchor)
      : (claim.anchor ?? claim.evidenceAnchor)
    : null;
  const select = useCallback((i: number) => {
    setSelected(i);
    setShowEvidence(false);
  }, []);

  return (
    <main className="mx-auto flex h-screen max-w-[1700px] flex-col px-5 pb-5 pt-5 lg:px-8">
      <Masthead index={index} current={current} onSelect={setCurrent} />

      <div className="mt-4 grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_27rem]">
        <section className="min-h-0">
          {dossier ? (
            <PaperView url={dossier.pdfUrl} highlight={highlight} />
          ) : (
            <div className="flex h-full items-center justify-center text-[0.9rem] italic text-ink-faint">
              Fetching the paper…
            </div>
          )}
        </section>

        <aside className="rule-left flex min-h-0 flex-col lg:pl-7">
          {dossier ? (
            <Panel
              dossier={dossier}
              selected={selected}
              claim={claim}
              showEvidence={showEvidence}
              onSelect={select}
              onToggleEvidence={() => setShowEvidence((v) => !v)}
            />
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function Masthead({
  index,
  current,
  onSelect,
}: {
  index: IndexEntry[];
  current: string;
  onSelect: (id: string) => void;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-5 border-b border-paper-edge pb-4">
      <div className="flex items-baseline gap-4">
        <Link href="/" className="pressed text-[1.75rem] leading-none tracking-[-0.02em] transition-colors hover:text-brass">
          Keystone
        </Link>
        <p className="text-[0.85rem] italic text-ink-soft">
          Which claim is holding this paper up — and how much of it we could check.
        </p>
      </div>

      <label className="flex items-center gap-3 text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">
        Paper
        <select
          value={current}
          onChange={(e) => {
            onSelect(e.target.value);
            window.history.replaceState(null, "", `/paper/${e.target.value}`);
          }}
          className="max-w-[22rem] truncate border-b border-ink/25 bg-transparent pb-0.5 font-[family-name:var(--font-display)] text-[0.95rem] normal-case tracking-normal text-ink outline-none transition-colors hover:border-brass focus:border-brass"
        >
          {index.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}

function Panel({
  dossier,
  selected,
  claim,
  showEvidence,
  onSelect,
  onToggleEvidence,
}: {
  dossier: Dossier;
  selected: number | null;
  claim: Claim | null;
  showEvidence: boolean;
  onSelect: (i: number) => void;
  onToggleEvidence: () => void;
}) {
  const { coverage, keystone } = dossier;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 pb-1">
        <EvidenceMap
          claims={dossier.claims}
          keystoneTable={keystone?.table ?? null}
          selected={selected}
          onSelect={onSelect}
        />
      </div>

      <div className="shrink-0">
        {keystone ? (
          <p className="text-[1.05rem] leading-snug">
            <span className="text-brass">{keystone.table}</span> carries{" "}
            <span className="numeral">{keystone.supported}</span> of{" "}
            <span className="numeral">{coverage.claims}</span> headline numbers.
          </p>
        ) : (
          <p className="text-[0.95rem] italic text-ink-soft">
            {coverage.claims === 0
              ? "This paper states no numeric claims up front."
              : "No single table carries this paper's headline numbers."}
          </p>
        )}

        <div className="mt-3 flex items-center gap-3">
          <div className="flex flex-1 gap-[2px]">
            {Array.from({ length: coverage.claims }, (_, i) => {
              // Verified, then declared, then nothing — read left to right, strongest
              // evidence first, so the bar says at a glance how much is actually known.
              const verified = i < coverage.supported;
              const declared = !verified && i < coverage.supported + coverage.declared;
              return (
                <motion.span
                  key={i}
                  initial={{ scaleY: 0.3, opacity: 0 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ delay: 0.1 + i * 0.03, duration: 0.4, ease: EASE }}
                  className="h-4 flex-1 origin-bottom rounded-[1px]"
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
          </div>
          <span className="numeral shrink-0 text-[0.78rem] text-ink-soft">
            {coverage.supported}/{coverage.claims} verified
            {coverage.declared > 0 ? ` · ${coverage.declared} declared` : ""}
          </span>
        </div>
      </div>

      <h2 className="mt-5 shrink-0 text-[0.68rem] uppercase tracking-[0.18em] text-ink-faint">
        Headline numbers — click to find it in the paper
      </h2>

      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {dossier.claims.map((c, i) => (
          <ClaimRow
            key={i}
            claim={c}
            active={selected === i}
            onSelect={() => onSelect(i)}
            showEvidence={showEvidence}
            onToggleEvidence={onToggleEvidence}
          />
        ))}
        {dossier.claims.length === 0 ? (
          <li className="text-[0.9rem] italic text-ink-faint">
            Nothing to trace — the abstract, introduction and conclusion state no numbers.
          </li>
        ) : null}
      </ul>

      {claim ? <Detail claim={claim} showEvidence={showEvidence} onToggle={onToggleEvidence} /> : null}
    </div>
  );
}

function ClaimRow({
  claim,
  active,
  onSelect,
}: {
  claim: Claim;
  active: boolean;
  onSelect: () => void;
  showEvidence: boolean;
  onToggleEvidence: () => void;
}) {
  const supported = isSupported(claim.status);
  const declared = isDeclared(claim.status);
  const tone = supported
    ? "var(--color-supported)"
    : declared
      ? "var(--color-ink-faint)"
      : "var(--color-missing)";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-baseline gap-3 rounded-[2px] border-l-2 px-2 py-1.5 text-left transition-colors ${
          active ? "bg-paper-deep/70" : "hover:bg-paper-deep/40"
        }`}
        style={{ borderLeftColor: tone }}
      >
        <span
          className="numeral shrink-0 text-[0.95rem]"
          style={{ color: supported || declared ? "var(--color-ink)" : "var(--color-missing)" }}
        >
          {claim.value}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.82rem] text-ink-soft">
          {claim.sentence}
        </span>
        <span className="shrink-0 text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
          {claim.anchor ? `p${claim.anchor.page + 1}` : "—"}
        </span>
      </button>
    </li>
  );
}

function Detail({
  claim,
  showEvidence,
  onToggle,
}: {
  claim: Claim;
  showEvidence: boolean;
  onToggle: () => void;
}) {
  const supported = isSupported(claim.status);
  const declared = isDeclared(claim.status);
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={claim.value + claim.sentence.slice(0, 20)}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="mt-4 shrink-0 border-t border-paper-edge pt-3"
      >
        <p className="quote-mark text-[0.88rem] leading-relaxed text-ink-soft">
          {claim.sentence}
        </p>

        <div className="mt-2 flex items-center justify-between gap-3 text-[0.82rem]">
          {supported ? (
            <span className="text-supported">
              Rests on {claim.table}
              {claim.row ? ` · ${claim.row}` : ""}
              {claim.cell ? ` = ${claim.cell}` : ""}
            </span>
          ) : declared ? (
            <span className="text-ink-soft">
              Rests on {declaredAs(claim.status)}
              {claim.evidenceLabel ? ` (${claim.evidenceLabel})` : ""} — stated by the
              paper, not checkable by arithmetic
            </span>
          ) : (
            <span className="italic text-missing">
              No evidence found for this number anywhere in the paper
            </span>
          )}

          {claim.evidenceAnchor ? (
            <button
              type="button"
              onClick={onToggle}
              className="shrink-0 border-b border-dotted border-brass/60 italic text-brass transition-colors hover:text-ink"
            >
              {showEvidence ? "back to the claim" : `show the evidence (p${claim.evidenceAnchor.page + 1})`}
            </button>
          ) : null}
        </div>

        {!claim.anchor ? (
          <p className="mt-2 text-[0.78rem] italic text-ink-faint">
            This sentence could not be located in the PDF, so there is nothing to
            highlight. The trace above still holds — it was made from the paper&rsquo;s
            LaTeX source.
          </p>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}
