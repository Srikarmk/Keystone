"use client";

import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import type { Claim, Dossier, IndexEntry } from "@/lib/dossier";
import { isSupported } from "@/lib/dossier";
import type { StoneDatum } from "@/components/Arch";

const Arch = dynamic(() => import("@/components/Arch").then((m) => m.Arch), {
  ssr: false,
});

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Stones are laid so that the claims resting on the keystone table sit at the apex,
 * unverified claims fall to the springing points, and everything else fills between.
 * The arrangement is a reading of the same data the ledger below states plainly — the
 * ledger is the record, the arch is the intuition.
 */
function arrangeStones(dossier: Dossier): StoneDatum[] {
  const keystoneTable = dossier.keystone?.table ?? null;

  const bucket = (claim: Claim): StoneDatum["kind"] => {
    if (!isSupported(claim.status)) return "missing";
    return claim.table && claim.table === keystoneTable ? "keystone" : "supported";
  };

  const described = dossier.claims.map((claim) => ({
    kind: bucket(claim),
    label: claim.value,
    detail:
      claim.table && isSupported(claim.status)
        ? `${claim.table} · ${claim.row ?? ""} ${claim.column ?? ""}`.trim()
        : "no evidence found in any table",
  }));

  const keystone = described.filter((s) => s.kind === "keystone");
  const supported = described.filter((s) => s.kind === "supported");
  const missing = described.filter((s) => s.kind === "missing");

  // Apex outward: keystone claims, then other supported, then the gaps at the ends.
  const ordered: StoneDatum[] = [];
  const centre = [...keystone, ...supported];
  const outer = [...missing];
  centre.forEach((stone, i) => (i % 2 === 0 ? ordered.push(stone) : ordered.unshift(stone)));
  outer.forEach((stone, i) => (i % 2 === 0 ? ordered.push(stone) : ordered.unshift(stone)));
  return ordered;
}

export default function Page() {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [current, setCurrent] = useState<string>("1706.03762");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [hovered, setHovered] = useState<StoneDatum | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/dossiers/index.json")
      .then((r) => r.json())
      .then(setIndex)
      .catch(() => setIndex([]));
  }, []);

  useEffect(() => {
    setDossier(null);
    setCollapsed(false);
    fetch(`/dossiers/${current}.json`)
      .then((r) => r.json())
      .then(setDossier)
      .catch(() => setDossier(null));
  }, [current]);

  const stones = useMemo(() => (dossier ? arrangeStones(dossier) : []), [dossier]);
  const entry = index.find((e) => e.id === current);

  return (
    <main className="mx-auto max-w-[1400px] px-6 pb-24 pt-8 lg:px-10">
      <Masthead index={index} current={current} onSelect={setCurrent} />

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="relative">
          <div className="relative h-[27rem] w-full sm:h-[32rem]">
            {stones.length > 0 ? (
              <Arch
                stones={stones}
                collapsed={collapsed}
                onHover={setHovered}
                onSelectKeystone={() => setCollapsed((v) => !v)}
              />
            ) : (
              <EmptyArch loading={dossier === null} />
            )}

            <AnimatePresence>
              {hovered ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-sm border border-paper-edge bg-paper/95 px-4 py-2 text-center shadow-[0_2px_18px_rgba(28,26,23,0.09)]"
                >
                  <div className="numeral text-lg text-ink">{hovered.label}</div>
                  <div className="mt-0.5 text-[0.78rem] italic text-ink-soft">{hovered.detail}</div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <Legend
            collapsed={collapsed}
            hasKeystone={Boolean(dossier?.keystone)}
            onToggle={() => setCollapsed((v) => !v)}
          />
        </section>

        <aside className="rule-left lg:pl-10">
          {dossier ? <Ledger dossier={dossier} entry={entry} /> : <LedgerSkeleton />}
        </aside>
      </div>

      {dossier ? <ClaimTable dossier={dossier} /> : null}
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
    <header className="border-b border-paper-edge pb-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="pressed text-[2.6rem] leading-none tracking-[-0.02em] text-ink">
            Keystone
          </h1>
          <p className="mt-2 max-w-md text-[0.95rem] italic leading-snug text-ink-soft">
            Which claim is holding this paper up — and how much of it we could actually
            check.
          </p>
        </div>

        <label className="flex items-center gap-3 text-[0.8rem] uppercase tracking-[0.14em] text-ink-faint">
          Paper
          <select
            value={current}
            onChange={(event) => onSelect(event.target.value)}
            className="max-w-[24rem] truncate border-b border-ink/25 bg-transparent pb-1 font-[family-name:var(--font-display)] text-[1rem] normal-case tracking-normal text-ink outline-none transition-colors hover:border-brass focus:border-brass"
          >
            {index.map((paper) => (
              <option key={paper.id} value={paper.id}>
                {paper.title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}

function EmptyArch({ loading }: { loading: boolean }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="max-w-xs text-center text-[0.95rem] italic leading-relaxed text-ink-faint">
        {loading
          ? "Laying the stones…"
          : "This paper states no numeric claims in its abstract, introduction or conclusion. There is nothing here to hold up."}
      </p>
    </div>
  );
}

function Legend({
  collapsed,
  hasKeystone,
  onToggle,
}: {
  collapsed: boolean;
  hasKeystone: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-3 text-[0.78rem] text-ink-soft">
      <Swatch color="var(--color-brass)" label="rests on the keystone" />
      <Swatch color="#d3cab7" label="evidenced elsewhere" />
      <Swatch color="transparent" outline label="no evidence found" />
      {hasKeystone ? (
        // An explicit control as well as the stone itself. The point of the
        // interaction is the argument it makes — remove this table and the rest goes
        // with it — and an affordance nobody finds makes no argument at all.
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={collapsed}
          className="ml-auto border-b border-dotted border-brass/60 pb-0.5 italic text-brass transition-colors hover:border-solid hover:text-ink"
        >
          {collapsed ? "rebuild the arch" : "pull the keystone →"}
        </button>
      ) : null}
    </div>
  );
}

function Swatch({ color, label, outline }: { color: string; label: string; outline?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-3 w-5 rounded-[1px]"
        style={{
          background: color,
          border: outline ? "1px dashed var(--color-missing)" : "1px solid rgba(28,26,23,0.12)",
        }}
      />
      {label}
    </span>
  );
}

function Ledger({ dossier, entry }: { dossier: Dossier; entry?: IndexEntry }) {
  const { coverage, keystone } = dossier;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      key={dossier.id}
    >
      <SectionHeading>The keystone</SectionHeading>
      {keystone ? (
        <>
          <p className="mt-3 font-[family-name:var(--font-display)] text-[1.35rem] leading-snug text-ink">
            <span className="text-brass">{keystone.table}</span> carries{" "}
            <span className="numeral">{keystone.supported}</span> of this paper&rsquo;s{" "}
            <span className="numeral">{coverage.claims}</span> headline numbers.
          </p>
          <p className="mt-2 text-[0.9rem] italic leading-relaxed text-ink-soft">
            {keystone.caption || "No caption recovered for this table."}
          </p>
        </>
      ) : (
        <p className="mt-3 text-[1rem] italic leading-relaxed text-ink-soft">
          No single table carries this paper&rsquo;s headline numbers.
        </p>
      )}

      <SectionHeading className="mt-9">Coverage</SectionHeading>
      <CoverageBar coverage={coverage} />

      <dl className="mt-5 space-y-2 text-[0.92rem]">
        <Row label="Headline numbers" value={coverage.claims} />
        <Row label="Traced to a table" value={coverage.supported} tone="supported" />
        <Row label="No evidence found" value={coverage.unsupported} tone="missing" />
        {coverage.mismatched > 0 ? (
          <Row label="Near-miss against a cell" value={coverage.mismatched} tone="missing" />
        ) : null}
      </dl>

      <p className="mt-5 border-t border-paper-edge pt-4 text-[0.85rem] leading-relaxed text-ink-faint">
        Coverage counts results the paper asserts up front. Hardware, epochs and layer
        counts are configuration, not claims, and are excluded rather than counted as
        unverified.
      </p>

      {entry && entry.findings > 0 ? (
        <>
          <SectionHeading className="mt-9">Findings</SectionHeading>
          <ul className="mt-3 space-y-3">
            {dossier.findings.map((finding, i) => (
              <li key={i} className="border-l-2 border-missing pl-3">
                <p className="text-[0.95rem] leading-snug text-ink">{finding.title}</p>
                <p className="mt-1 text-[0.84rem] italic leading-relaxed text-ink-soft">
                  {finding.explanation}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <SectionHeading className="mt-9">Findings</SectionHeading>
          <p className="mt-3 text-[0.9rem] italic leading-relaxed text-ink-soft">
            No inconsistencies found. That is not a clean bill of health — it means the
            checks that ran found nothing, and the coverage above says how much they
            could see.
          </p>
        </>
      )}
    </motion.div>
  );
}

function CoverageBar({ coverage }: { coverage: Dossier["coverage"] }) {
  const total = Math.max(coverage.claims, 1);
  const cells = Array.from({ length: coverage.claims }, (_, i) =>
    i < coverage.supported ? "supported" : "missing",
  );

  return (
    <div className="mt-3">
      <div className="flex gap-[3px]">
        {cells.length > 0 ? (
          cells.map((kind, i) => (
            <motion.span
              key={i}
              initial={{ scaleY: 0.25, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.045, duration: 0.45, ease: EASE }}
              className="h-7 flex-1 origin-bottom rounded-[1px]"
              style={{
                background:
                  kind === "supported" ? "var(--color-supported)" : "transparent",
                border:
                  kind === "supported"
                    ? "1px solid transparent"
                    : "1px dashed var(--color-missing)",
              }}
            />
          ))
        ) : (
          <span className="h-7 flex-1 rounded-[1px] border border-dashed border-paper-edge" />
        )}
      </div>
      <p className="numeral mt-2 text-[0.82rem] text-ink-soft">
        {coverage.supported} of {total} traced &middot;{" "}
        {Math.round(coverage.rate * 100)}%
      </p>
    </div>
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
        : "var(--color-ink)";
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <span aria-hidden className="mx-1 flex-1 border-b border-dotted border-paper-edge" />
      <dd className="numeral text-[1rem]" style={{ color: colour }}>
        {value}
      </dd>
    </div>
  );
}

function SectionHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint ${className}`}
    >
      {children}
    </h2>
  );
}

function LedgerSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-3 w-24 animate-pulse rounded bg-paper-deep" />
      <div className="h-8 w-full animate-pulse rounded bg-paper-deep" />
      <div className="h-8 w-3/4 animate-pulse rounded bg-paper-deep" />
    </div>
  );
}

function ClaimTable({ dossier }: { dossier: Dossier }) {
  if (dossier.claims.length === 0) return null;

  return (
    <section className="mt-16 border-t border-paper-edge pt-8">
      <SectionHeading>Every headline number, and what it rests on</SectionHeading>

      <ul className="mt-6 space-y-5">
        {dossier.claims.map((claim, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.04, duration: 0.45, ease: EASE }}
            className="grid gap-x-6 gap-y-2 border-b border-paper-edge/70 pb-5 md:grid-cols-[7rem_minmax(0,1fr)_16rem]"
          >
            <div>
              <div
                className="numeral text-[1.4rem] leading-none"
                style={{
                  color: isSupported(claim.status)
                    ? "var(--color-ink)"
                    : "var(--color-missing)",
                }}
              >
                {claim.value}
              </div>
              <div className="mt-1 text-[0.72rem] uppercase tracking-[0.12em] text-ink-faint">
                {claim.section}
              </div>
            </div>

            <p className="quote-mark text-[0.98rem] leading-relaxed text-ink-soft">
              {claim.sentence}
            </p>

            <div className="text-[0.88rem] leading-relaxed">
              {isSupported(claim.status) ? (
                <>
                  <span className="text-supported">Traced to {claim.table}</span>
                  {claim.row || claim.column ? (
                    <div className="mt-1 text-ink-faint">
                      {[claim.row, claim.column].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                </>
              ) : claim.status === "mismatch" ? (
                <span className="text-missing">
                  {claim.table} gives {claim.cell}
                </span>
              ) : (
                <span className="italic text-missing">
                  Not found in any table in this paper
                </span>
              )}
            </div>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
