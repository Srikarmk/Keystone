"use client";

import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Claim, Dossier, IndexEntry } from "@/lib/dossier";
import { isSupported } from "@/lib/dossier";
import type { StoneDatum } from "@/components/Arch";
import { PaperView } from "@/components/PaperView";

const Arch = dynamic(() => import("@/components/Arch").then((m) => m.Arch), {
  ssr: false,
});

const EASE = [0.16, 1, 0.3, 1] as const;

function arrangeStones(dossier: Dossier): StoneDatum[] {
  const keystoneTable = dossier.keystone?.table ?? null;

  const described: StoneDatum[] = dossier.claims.map((claim, index) => ({
    kind: !isSupported(claim.status)
      ? "missing"
      : claim.table && claim.table === keystoneTable
        ? "keystone"
        : "supported",
    label: claim.value,
    detail:
      claim.table && isSupported(claim.status)
        ? `${claim.table} · ${claim.row ?? ""} ${claim.column ?? ""}`.trim()
        : "no evidence found in any table",
    claimIndex: index,
  }));

  // Apex outward: keystone claims at the crown, gaps at the springing points.
  const centre = described.filter((s) => s.kind !== "missing");
  const outer = described.filter((s) => s.kind === "missing");
  const ordered: StoneDatum[] = [];
  centre.forEach((s, i) => (i % 2 === 0 ? ordered.push(s) : ordered.unshift(s)));
  outer.forEach((s, i) => (i % 2 === 0 ? ordered.push(s) : ordered.unshift(s)));
  return ordered;
}

export default function Page() {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [current, setCurrent] = useState("1706.03762");
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

  const stones = useMemo(() => (dossier ? arrangeStones(dossier) : []), [dossier]);
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
              stones={stones}
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
        <h1 className="pressed text-[1.75rem] leading-none tracking-[-0.02em]">Keystone</h1>
        <p className="text-[0.85rem] italic text-ink-soft">
          Which claim is holding this paper up — and how much of it we could check.
        </p>
      </div>

      <label className="flex items-center gap-3 text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">
        Paper
        <select
          value={current}
          onChange={(e) => onSelect(e.target.value)}
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
  stones,
  selected,
  claim,
  showEvidence,
  onSelect,
  onToggleEvidence,
}: {
  dossier: Dossier;
  stones: StoneDatum[];
  selected: number | null;
  claim: Claim | null;
  showEvidence: boolean;
  onSelect: (i: number) => void;
  onToggleEvidence: () => void;
}) {
  const { coverage, keystone } = dossier;

  return (
    <div className="flex min-h-0 flex-col">
      {stones.length > 0 ? (
        <div className="h-40 shrink-0">
          <Arch
            stones={stones}
            collapsed={false}
            selected={selected}
            onHover={() => {}}
            onSelectStone={onSelect}
          />
        </div>
      ) : null}

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
            {Array.from({ length: coverage.claims }, (_, i) => (
              <motion.span
                key={i}
                initial={{ scaleY: 0.3, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.03, duration: 0.4, ease: EASE }}
                className="h-4 flex-1 origin-bottom rounded-[1px]"
                style={{
                  background: i < coverage.supported ? "var(--color-supported)" : "transparent",
                  border:
                    i < coverage.supported
                      ? "1px solid transparent"
                      : "1px dashed var(--color-missing)",
                }}
              />
            ))}
          </div>
          <span className="numeral shrink-0 text-[0.78rem] text-ink-soft">
            {coverage.supported}/{coverage.claims} traced
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
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-baseline gap-3 rounded-[2px] border-l-2 px-2 py-1.5 text-left transition-colors ${
          active ? "bg-paper-deep/70" : "hover:bg-paper-deep/40"
        }`}
        style={{ borderLeftColor: supported ? "var(--color-supported)" : "var(--color-missing)" }}
      >
        <span
          className="numeral shrink-0 text-[0.95rem]"
          style={{ color: supported ? "var(--color-ink)" : "var(--color-missing)" }}
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
          ) : (
            <span className="italic text-missing">Not found in any table in this paper</span>
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
