"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AnchorJson,
  Claim,
  Dossier,
  IndexedNumber,
  IndexEntry,
  BaselineCheck,
  Reference,
} from "@/lib/dossier";
import { declaredAs, isDeclared, isSupported } from "@/lib/dossier";
import { EquationView } from "@/components/EquationView";
import { EvidenceMap } from "@/components/EvidenceMap";
import { PaperView } from "@/components/PaperView";
import { findCell, TableView } from "@/components/TableView";
import { AskTab } from "@/components/AskTab";
import { ThemeToggle } from "@/components/ThemeToggle";

const EASE = [0.16, 1, 0.3, 1] as const;

type Tab =
  | "ask"
  | "claims"
  | "numbers"
  | "tables"
  | "equations"
  | "references"
  | "checked"
  | "structure";

export function Reader({ id }: { id: string }) {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [current, setCurrent] = useState(id);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [tab, setTab] = useState<Tab>("claims");
  const [jump, setJump] = useState<AnchorJson | null>(null);

  useEffect(() => {
    fetch("/dossiers/index.json").then((r) => r.json()).then(setIndex).catch(() => {});
  }, []);

  useEffect(() => {
    setDossier(null);
    setSelected(null);
    setShowEvidence(false);
    setJump(null);
    fetch(`/dossiers/${current}.json`)
      .then((r) => r.json())
      .then(setDossier)
      .catch(() => setDossier(null));
  }, [current]);

  const claim = dossier && selected !== null ? dossier.claims[selected] : null;

  const highlight = useMemo(() => {
    if (jump) return jump;
    if (!claim) return null;
    return showEvidence
      ? (claim.evidenceAnchor ?? claim.anchor)
      : (claim.anchor ?? claim.evidenceAnchor);
  }, [jump, claim, showEvidence]);

  const select = useCallback((i: number) => {
    setSelected(i);
    setShowEvidence(false);
    setJump(null);
    setTab("claims");
  }, []);

  const counts = dossier
    ? {
        ask: 0,
        claims: dossier.claims.length,
        numbers: dossier.numbers.length,
        tables: dossier.tables.length,
        equations: dossier.equations.length,
        references: dossier.references.length,
        checked: dossier.baselines.length + dossier.findings.length,
        structure: dossier.sections.length,
      }
    : {
        ask: 0,
        claims: 0,
        numbers: 0,
        tables: 0,
        equations: 0,
        references: 0,
        checked: 0,
        structure: 0,
      };

  return (
    <main className="mx-auto flex h-screen max-w-[1800px] flex-col px-5 pb-5 pt-4 lg:px-8">
      <Masthead
        index={index}
        current={current}
        onSelect={(next) => {
          setCurrent(next);
          window.history.replaceState(null, "", `/paper/${next}`);
        }}
      />

      <div className="mt-3 grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_30rem]">
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
            <>
              <Summary dossier={dossier} />
              <Tabs tab={tab} counts={counts} onChange={setTab} />

              <div
                className={`min-h-0 flex-1 pr-1 pt-3 ${
                  tab === "ask" ? "overflow-hidden" : "overflow-y-auto"
                }`}
              >
                {tab === "ask" ? (
                  <AskTab paperId={dossier.id} title={dossier.title || dossier.id} />
                ) : null}
                {tab === "claims" ? (
                  <ClaimsTab
                    dossier={dossier}
                    selected={selected}
                    claim={claim}
                    showEvidence={showEvidence}
                    onSelect={select}
                    onToggleEvidence={() => setShowEvidence((v) => !v)}
                  />
                ) : null}
                {tab === "numbers" ? (
                  <NumbersTab dossier={dossier} onJump={setJump} />
                ) : null}
                {tab === "tables" ? (
                  <TablesTab dossier={dossier} onJump={setJump} />
                ) : null}
                {tab === "equations" ? <EquationsTab dossier={dossier} /> : null}
                {tab === "references" ? <ReferencesTab dossier={dossier} /> : null}
                {tab === "checked" ? <CheckedTab dossier={dossier} /> : null}
                {tab === "structure" ? <StructureTab dossier={dossier} /> : null}
              </div>
            </>
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
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-5 border-b border-paper-edge pb-3">
      <div className="flex items-baseline gap-4">
        <Link
          href="/"
          className="pressed text-[1.5rem] leading-none tracking-[-0.02em] transition-colors hover:text-brass"
        >
          Keystone
        </Link>
        <p className="text-[0.82rem] italic text-ink-soft">
          Which claim is holding this paper up — and how much of it we could check.
        </p>
      </div>

      <span className="flex items-center gap-5">
      <ThemeToggle />
      <label className="flex items-center gap-3 text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
        Paper
        <select
          value={current}
          onChange={(e) => onSelect(e.target.value)}
          className="max-w-[22rem] truncate border-b border-ink/25 bg-transparent pb-0.5 font-[family-name:var(--font-display)] text-[0.92rem] normal-case tracking-normal text-ink outline-none transition-colors hover:border-brass focus:border-brass"
        >
          {index.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      </span>
    </header>
  );
}

function Summary({ dossier }: { dossier: Dossier }) {
  const { coverage, keystone } = dossier;
  return (
    <div className="shrink-0 pt-3">
      {keystone ? (
        <p className="text-[1rem] leading-snug">
          <span className="text-brass">{keystone.table}</span> carries{" "}
          <span className="numeral">{keystone.supported}</span> of{" "}
          <span className="numeral">{coverage.claims}</span> headline numbers.
        </p>
      ) : (
        <p className="text-[0.92rem] italic text-ink-soft">
          {coverage.claims === 0
            ? "This paper states no numeric claims up front — its evidence is below."
            : "No single table carries this paper's headline numbers."}
        </p>
      )}

      {coverage.claims > 0 ? (
        <div className="mt-2 flex items-center gap-3">
          <div className="flex flex-1 gap-[2px]">
            {Array.from({ length: coverage.claims }, (_, i) => {
              const verified = i < coverage.supported;
              const declared = !verified && i < coverage.supported + coverage.declared;
              return (
                <motion.span
                  key={i}
                  initial={{ scaleY: 0.3, opacity: 0 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ delay: 0.08 + i * 0.025, duration: 0.35, ease: EASE }}
                  className="h-3 flex-1 origin-bottom rounded-[1px]"
                  style={{
                    background: verified
                      ? "var(--color-supported)"
                      : declared
                        ? "var(--color-ink-faint)"
                        : "transparent",
                    border:
                      verified || declared
                        ? "1px solid transparent"
                        : "1px dashed var(--color-missing)",
                    opacity: declared ? 0.5 : 1,
                  }}
                />
              );
            })}
          </div>
          <span className="numeral shrink-0 text-[0.75rem] text-ink-soft">
            {coverage.supported}/{coverage.claims} verified
            {coverage.declared > 0 ? ` · ${coverage.declared} declared` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Tabs({
  tab,
  counts,
  onChange,
}: {
  tab: Tab;
  counts: Record<Tab, number>;
  onChange: (t: Tab) => void;
}) {
  const items: { key: Tab; label: string }[] = [
    { key: "ask", label: "Ask" },
    { key: "claims", label: "Claims" },
    { key: "numbers", label: "Numbers" },
    { key: "tables", label: "Tables" },
    { key: "equations", label: "Equations" },
    { key: "references", label: "References" },
    { key: "checked", label: "Checked" },
    { key: "structure", label: "Structure" },
  ];
  return (
    <nav className="mt-4 flex shrink-0 gap-4 overflow-x-auto border-b border-paper-edge">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className="-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2 text-[0.7rem] uppercase tracking-[0.1em] transition-colors"
          style={{
            borderBottomColor: tab === item.key ? "var(--color-brass)" : "transparent",
            color: tab === item.key ? "var(--color-ink)" : "var(--color-ink-faint)",
          }}
        >
          {item.label}
          {counts[item.key] > 0 ? (
            <span className="numeral ml-1.5 text-[0.7rem] text-ink-faint">
              {counts[item.key]}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

function ClaimsTab({
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
  if (dossier.claims.length === 0) {
    return (
      <p className="text-[0.9rem] italic leading-relaxed text-ink-faint">
        The abstract, introduction and conclusion state no numbers, so there is nothing
        to trace. The Tables, Equations and Structure tabs hold what this paper does
        put forward.
      </p>
    );
  }

  return (
    <>
      <EvidenceMap
        claims={dossier.claims}
        keystoneTable={dossier.keystone?.table ?? null}
        selected={selected}
        onSelect={onSelect}
      />

      <ul className="mt-3 space-y-1">
        {dossier.claims.map((c, i) => (
          <ClaimRow key={i} claim={c} active={selected === i} onSelect={() => onSelect(i)} />
        ))}
      </ul>

      {claim ? (
        <Detail
          claim={claim}
          dossier={dossier}
          showEvidence={showEvidence}
          onToggle={onToggleEvidence}
        />
      ) : null}
    </>
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
          className="numeral shrink-0 text-[0.92rem]"
          style={{
            color: supported || declared ? "var(--color-ink)" : "var(--color-missing)",
          }}
        >
          {claim.value}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.8rem] text-ink-soft">
          {claim.sentence}
        </span>
        <span className="numeral shrink-0 text-[0.68rem] text-ink-faint">
          {claim.anchor ? `p${claim.anchor.page + 1}` : "—"}
        </span>
      </button>
    </li>
  );
}

function Detail({
  claim,
  dossier,
  showEvidence,
  onToggle,
}: {
  claim: Claim;
  dossier: Dossier;
  showEvidence: boolean;
  onToggle: () => void;
}) {
  const supported = isSupported(claim.status);
  const declared = isDeclared(claim.status);

  // The table the claim rests on, shown here rather than named. This is the whole
  // point: evidence produced, not referred to.
  const table = claim.table
    ? (dossier.tables.find((t) => t.name === claim.table) ?? null)
    : null;
  const focus = table ? findCell(table, claim.row, claim.cell) : null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={claim.value + claim.sentence.slice(0, 20)}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="mt-4 border-t border-paper-edge pt-3"
      >
        <p className="quote-mark text-[0.86rem] leading-relaxed text-ink-soft">
          {claim.sentence}
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[0.8rem]">
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
              {showEvidence
                ? "back to the claim"
                : `show in the PDF (p${claim.evidenceAnchor.page + 1})`}
            </button>
          ) : null}
        </div>

        {table ? (
          <div className="mt-3 rounded-[2px] border border-paper-edge bg-paper/70 p-2">
            <p className="mb-1.5 text-[0.72rem] leading-snug text-ink-faint">
              {table.name}
              {table.caption ? ` — ${table.caption}` : ""}
            </p>
            <TableView table={table} focus={focus} compact />
          </div>
        ) : null}

        {!claim.anchor ? (
          <p className="mt-2 text-[0.76rem] italic text-ink-faint">
            This sentence could not be located in the PDF, so there is nothing to
            highlight. The trace above still holds — it was made from the LaTeX source.
          </p>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

function NumbersTab({
  dossier,
  onJump,
}: {
  dossier: Dossier;
  onJump: (a: AnchorJson | null) => void;
}) {
  const [filter, setFilter] = useState<"all" | "result" | "configuration" | "untraced">(
    "all",
  );

  const shown = dossier.numbers.filter((n) => {
    if (filter === "all") return true;
    if (filter === "untraced") return n.status === "untraced";
    return n.kind === filter;
  });

  if (dossier.numbers.length === 0) {
    return (
      <p className="text-[0.9rem] italic text-ink-faint">
        No measurements were found in this paper&rsquo;s prose.
      </p>
    );
  }

  const options: { key: typeof filter; label: string }[] = [
    { key: "all", label: "all" },
    { key: "result", label: "results" },
    { key: "configuration", label: "setup" },
    { key: "untraced", label: "unevidenced" },
  ];

  return (
    <>
      <div className="mb-2 flex gap-3 text-[0.72rem]">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            className="border-b transition-colors"
            style={{
              borderBottomColor:
                filter === option.key ? "var(--color-brass)" : "transparent",
              color:
                filter === option.key ? "var(--color-ink)" : "var(--color-ink-faint)",
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <ul className="space-y-0.5">
        {shown.map((number, i) => (
          <NumberRow key={i} number={number} onJump={onJump} />
        ))}
      </ul>
    </>
  );
}

function NumberRow({
  number,
  onJump,
}: {
  number: IndexedNumber;
  onJump: (a: AnchorJson | null) => void;
}) {
  const tone =
    number.status === "configuration"
      ? "var(--color-ink-faint)"
      : isSupported(number.status as Claim["status"])
        ? "var(--color-supported)"
        : isDeclared(number.status as Claim["status"])
          ? "var(--color-ink-faint)"
          : "var(--color-missing)";

  return (
    <li>
      <button
        type="button"
        onClick={() => onJump(number.anchor)}
        disabled={!number.anchor}
        className="flex w-full items-baseline gap-2.5 rounded-[2px] border-l-2 px-2 py-1 text-left transition-colors hover:bg-paper-deep/40 disabled:cursor-default"
        style={{ borderLeftColor: tone }}
        title={number.sentence}
      >
        <span className="numeral w-24 shrink-0 truncate text-[0.82rem]">
          {number.value}
        </span>
        <span className="w-16 shrink-0 text-[0.62rem] uppercase tracking-[0.08em] text-ink-faint">
          {number.section.slice(0, 9)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.76rem] text-ink-soft">
          {number.table ?? number.sentence}
        </span>
        <span className="numeral shrink-0 text-[0.64rem] text-ink-faint">
          {number.anchor ? `p${number.anchor.page + 1}` : "—"}
        </span>
      </button>
    </li>
  );
}

function TablesTab({
  dossier,
  onJump,
}: {
  dossier: Dossier;
  onJump: (a: AnchorJson | null) => void;
}) {
  const [open, setOpen] = useState<number | null>(0);

  if (dossier.tables.length === 0) {
    return <p className="text-[0.9rem] italic text-ink-faint">No tables in this paper.</p>;
  }

  return (
    <ul className="space-y-2">
      {dossier.tables.map((table, i) => (
        <li key={i} className="border-b border-paper-edge/60 pb-2">
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-baseline gap-3 text-left"
          >
            <span
              className="shrink-0 text-[0.86rem]"
              style={{
                color:
                  table.supports > 0 ? "var(--color-brass)" : "var(--color-ink-soft)",
              }}
            >
              {table.name}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.78rem] text-ink-soft">
              {table.caption || "no caption recovered"}
            </span>
            <span className="numeral shrink-0 text-[0.68rem] text-ink-faint">
              {table.numericCells > 0
                ? `${table.numericCells} numeric`
                : `${table.rows.length}×${table.rows[0]?.length ?? 0}`}
              {table.supports > 0 ? ` · carries ${table.supports}` : ""}
            </span>
          </button>

          {open === i ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="mt-2"
            >
              <TableView table={table} compact />
              {table.anchor ? (
                <button
                  type="button"
                  onClick={() => onJump(table.anchor)}
                  className="mt-1.5 text-[0.74rem] italic text-brass transition-colors hover:text-ink"
                >
                  find it in the PDF (p{table.anchor.page + 1}) &rarr;
                </button>
              ) : null}
            </motion.div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function EquationsTab({ dossier }: { dossier: Dossier }) {
  if (dossier.equations.length === 0) {
    return (
      <p className="text-[0.9rem] italic text-ink-faint">
        No display equations in this paper&rsquo;s source.
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {dossier.equations.map((equation) => (
        <li key={equation.ordinal} className="border-b border-paper-edge/60 pb-3">
          <EquationView
            latex={equation.latex}
            label={equation.labels[0] ?? equation.environment}
            macros={dossier.macros}
          />
        </li>
      ))}
    </ul>
  );
}

function ReferencesTab({ dossier }: { dossier: Dossier }) {
  const [onlyCheckable, setOnlyCheckable] = useState(false);
  const checkable = dossier.references.filter((r) => r.arxivId).length;
  const shown = onlyCheckable
    ? dossier.references.filter((r) => r.arxivId)
    : dossier.references;

  if (dossier.references.length === 0) {
    return (
      <p className="text-[0.9rem] italic text-ink-faint">
        No bibliography could be recovered from this paper&rsquo;s source.
      </p>
    );
  }

  return (
    <>
      <p className="mb-2 text-[0.76rem] leading-relaxed text-ink-faint">
        Read from the paper&rsquo;s own bibliography — no lookup service involved.{" "}
        <button
          type="button"
          onClick={() => setOnlyCheckable((v) => !v)}
          className="border-b border-dotted border-brass/60 italic text-brass transition-colors hover:text-ink"
        >
          {onlyCheckable ? "show all" : `${checkable} can be followed to arXiv`}
        </button>
      </p>

      <ul className="space-y-2">
        {shown.map((reference) => (
          <ReferenceRow key={reference.key} reference={reference} />
        ))}
      </ul>
    </>
  );
}

function ReferenceRow({ reference }: { reference: Reference }) {
  return (
    <li className="border-b border-paper-edge/50 pb-2">
      <p className="text-[0.84rem] leading-snug text-ink">
        {reference.title || reference.raw.slice(0, 110)}
      </p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[0.75rem] text-ink-faint">
        <span className="truncate">{reference.authors || "unknown authors"}</span>
        {reference.year ? <span className="numeral">{reference.year}</span> : null}
        {reference.arxivId ? (
          <a
            href={`https://arxiv.org/abs/${reference.arxivId}`}
            target="_blank"
            rel="noreferrer"
            className="numeral text-brass transition-colors hover:text-ink"
          >
            arXiv:{reference.arxivId}
          </a>
        ) : null}
      </p>
    </li>
  );
}

function CheckedTab({ dossier }: { dossier: Dossier }) {
  const { baselines, findings } = dossier;
  const confirmed = baselines.filter((b) => b.outcome === "confirmed");
  const missing = baselines.filter((b) => b.outcome === "not_found");
  const unavailable = baselines.filter((b) => b.outcome === "unavailable");

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-faint">
          Findings
        </h3>
        {findings.length === 0 ? (
          <p className="mt-2 text-[0.85rem] leading-relaxed text-ink-soft">
            No inconsistencies found. That is not a clean bill of health — it means the
            checks below ran and found nothing, and what they covered is stated
            underneath so you can judge how much that is worth.
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {findings.map((finding, i) => (
              <li key={i} className="border-l-2 border-missing pl-3">
                <p className="text-[0.88rem] leading-snug text-ink">{finding.title}</p>
                <p className="mt-1 text-[0.8rem] italic leading-relaxed text-ink-soft">
                  {finding.explanation}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-faint">
          Baselines checked against their source papers
        </h3>

        {baselines.length === 0 ? (
          <p className="mt-2 text-[0.85rem] leading-relaxed text-ink-soft">
            No figure in this paper&rsquo;s tables is attributed to a citation that could
            be followed, so there was nothing to check across papers. This needs a
            comparison table whose rows cite their source and a reference carrying an
            arXiv identifier.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-soft">
              Every other check asks this paper about itself, which is why they stay
              quiet on careful work. This one reads the cited paper and asks whether it
              reports the figure attributed to it.
            </p>

            <dl className="mt-3 space-y-1.5 text-[0.85rem]">
              <Row label="Confirmed in the cited paper" value={confirmed.length} tone="supported" />
              {missing.length > 0 ? (
                <Row label="Not found in the cited paper" value={missing.length} tone="missing" />
              ) : null}
              {unavailable.length > 0 ? (
                <Row label="Cited paper could not be read" value={unavailable.length} />
              ) : null}
            </dl>

            <ul className="mt-4 space-y-1.5">
              {[...missing, ...confirmed, ...unavailable].map((check, i) => (
                <BaselineRow key={i} check={check} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function BaselineRow({ check }: { check: BaselineCheck }) {
  const tone =
    check.outcome === "confirmed"
      ? "var(--color-supported)"
      : check.outcome === "not_found"
        ? "var(--color-missing)"
        : "var(--color-ink-faint)";
  return (
    <li className="flex items-baseline gap-2.5 border-l-2 pl-2.5" style={{ borderLeftColor: tone }}>
      <span className="numeral w-14 shrink-0 text-[0.82rem]" style={{ color: tone }}>
        {check.value}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8rem] text-ink-soft">
          {check.row || check.table} &rarr; {check.citedTitle}
        </span>
        {check.note ? (
          <span className="block text-[0.72rem] italic text-ink-faint">{check.note}</span>
        ) : null}
      </span>
      {check.arxivId ? (
        <a
          href={`https://arxiv.org/abs/${check.arxivId}`}
          target="_blank"
          rel="noreferrer"
          className="numeral shrink-0 text-[0.68rem] text-brass transition-colors hover:text-ink"
        >
          {check.arxivId}
        </a>
      ) : null}
    </li>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "supported" | "missing";
}) {
  const colour =
    tone === "supported"
      ? "var(--color-supported)"
      : tone === "missing"
        ? "var(--color-missing)"
        : "var(--color-ink-soft)";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <span aria-hidden className="mx-1 flex-1 border-b border-dotted border-paper-edge" />
      <dd className="numeral" style={{ color: colour }}>
        {value}
      </dd>
    </div>
  );
}

function StructureTab({ dossier }: { dossier: Dossier }) {
  const max = Math.max(1, ...dossier.sections.map((s) => s.numbers));
  return (
    <ul className="space-y-0.5">
      {dossier.sections.map((section, i) => (
        <li
          key={i}
          className="flex items-baseline gap-3 border-b border-paper-edge/40 py-1.5"
        >
          <span className="w-20 shrink-0 text-[0.66rem] uppercase tracking-[0.1em] text-ink-faint">
            {section.kind}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.86rem]">{section.title}</span>

          {/* A bar per section, so the shape of where a paper puts its numbers is
              visible at a glance rather than having to be read off a column. */}
          <span className="hidden w-16 shrink-0 sm:block">
            <span
              className="block h-1.5 rounded-[1px]"
              style={{
                width: `${Math.max(3, (section.numbers / max) * 100)}%`,
                background:
                  section.numbers > 0 ? "var(--color-supported)" : "var(--color-paper-edge)",
                opacity: 0.55,
              }}
            />
          </span>
          <span className="numeral w-24 shrink-0 text-right text-[0.68rem] text-ink-faint">
            {section.numbers} nums · {section.citations} cites
          </span>
        </li>
      ))}
    </ul>
  );
}
