"use client";

/*
 * The reader: the paper on the left, the analysis on the right.
 *
 * The analysis used to be eight tabs crammed into a 30rem column — the bar clipped
 * mid-word and needed a horizontal scrollbar, and every claim row ended in an
 * ellipsis, so the list showed the shape of the claims without any of their content.
 * Tabs were the wrong shape for this. What the parser produces is a report about one
 * paper, and a report is something you scroll, with the parts you do not need folded
 * away. So: one column, collapsible sections, real type hierarchy, and Ask as a mode
 * rather than a ninth peer view.
 */

import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useIsDark } from "@/lib/theme";

import type {
  Accuracy,
  AnchorJson,
  LibraryGraph,
  BaselineCheck,
  Claim,
  Dossier,
  External as ExternalScore,
  IndexedNumber,
  IndexEntry,
  Reference,
} from "@/lib/dossier";
import { declaredAs, isDeclared, isSupported } from "@/lib/dossier";
import { record, sync } from "@/lib/history";
import { assumptionId, edgeId } from "@/lib/rows";
import { AskTab } from "@/components/AskTab";
import { AssumptionList, AssumptionSummary } from "@/components/Assumptions";
import { Foundation, InboundList, LineageList } from "@/components/Lineage";
import { EquationView } from "@/components/EquationView";
import { EvidenceMap } from "@/components/EvidenceMap";
import { PaperView } from "@/components/PaperView";
import { Section } from "@/components/Section";
import { findCell, TableView } from "@/components/TableView";
import { AccountMenu } from "@/components/AccountMenu";
import { ThemeToggle } from "@/components/ThemeToggle";

const EASE = [0.16, 1, 0.3, 1] as const;
const ZOOMS = [1, 1.3, 1.7, 2.1];

export function Reader({ id }: { id: string }) {
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [current, setCurrent] = useState(id);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [asking, setAsking] = useState(false);
  const [jump, setJump] = useState<AnchorJson | null>(null);
  const [zoomStep, setZoomStep] = useState(0);
  const [darkPage, setDarkPage] = useState(false);
  const [graph, setGraph] = useState<LibraryGraph | null>(null);
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null);
  const appIsDark = useIsDark();

  useEffect(() => {
    // Sorted by title, not by the order the library happened to be built in. At nine
    // papers the difference was invisible; at forty-five an unsorted picker is a wall.
    fetch("/dossiers/index.json")
      .then((r) => r.json())
      .then((entries: IndexEntry[]) =>
        setIndex(
          [...entries].sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
          ),
        ),
      )
      .catch(() => {});
    // The library graph, so this paper can also show who leans on *it*. Fetched once
    // rather than baked into each dossier: it changes whenever any paper is added.
    fetch("/dossiers/lineage.json").then((r) => r.json()).then(setGraph).catch(() => {});
    fetch("/dossiers/accuracy.json").then((r) => r.json()).then(setAccuracy).catch(() => {});
  }, []);

  // A link to one reading: land on it.
  //
  // Harder than one `scrollIntoView` for two reasons. The browser's own fragment jump
  // has already happened and missed, because the row's section only opens once it
  // recognises the fragment — a render later. And scrolling once is not enough
  // either: the sections above expand over the next few hundred milliseconds and
  // carry the row back off screen. So this keeps scrolling until the row actually
  // holds still in view, then stops.
  //
  // The highlight is set here too rather than left to `:target`, which does not
  // reliably apply to an element that did not exist when the fragment was parsed.
  useEffect(() => {
    if (!dossier) return;
    const id = window.location.hash.slice(1);
    if (!id) return;

    let tries = 0;
    let settled = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const target = document.getElementById(id);
      if (!target) {
        if (tries > 60) window.clearInterval(timer);
        return;
      }
      const box = target.getBoundingClientRect();
      const centred = box.top > 40 && box.bottom < window.innerHeight - 40;
      if (centred) {
        settled += 1;
      } else {
        settled = 0;
        // Instant, not smooth. A smooth scroll takes longer than this interval, so
        // each tick interrupted the one before it and the row never arrived — it
        // took seven seconds to settle instead of a tenth of one. Following a link
        // should land you there, not animate you there.
        target.scrollIntoView({ behavior: "auto", block: "center" });
      }
      // Two consecutive ticks in view means the sections above have finished
      // expanding and the row has stopped moving.
      if (settled >= 2 || tries > 80) {
        target.setAttribute("data-targeted", "");
        window.clearInterval(timer);
      }
    }, 60);
    return () => window.clearInterval(timer);
  }, [dossier]);

  useEffect(() => {
    setDossier(null);
    setSelected(null);
    setShowEvidence(false);
    setJump(null);
    setAsking(false);
    fetch(`/dossiers/${current}.json`)
      .then((r) => r.json())
      .then((loaded: Dossier) => {
        setDossier(loaded);
        // Noted after the dossier arrives, so a mistyped id or a paper that failed to
        // build never lands in the reading list. Local first, then pushed to the
        // account if there is one — not awaited, because a reader waiting on a
        // bookkeeping request to read a paper would be the wrong trade.
        record(loaded.id, loaded.title);
        void sync();
      })
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
    setAsking(false);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1880px] flex-col px-5 pb-4 pt-4 sm:px-6 lg:h-screen lg:px-10">
      <Masthead
        index={index}
        current={current}
        onSelect={(next) => {
          setCurrent(next);
          window.history.replaceState(null, "", `/paper/${next}`);
        }}
      />

      {/* Both panes were starved before: a narrow text column inside wide grey
          gutters on one side, eight clipped tabs on the other.

          Below `lg` they stack and the page scrolls as one, because side-by-side on a
          phone gives each pane half of 375px and neither is readable. The page then
          keeps a fixed slice of the viewport so the report starts visible underneath
          it rather than a screen and a half down.

          The page column is capped rather than elastic. Left to take whatever was
          going it reached 948px on a 1680px screen, which is not a page any more —
          it is a wall, and it made the report beside it look like a sidebar. Capped,
          the pair centres and the margins absorb the rest. The cap only binds on a
          wide screen; below about 1300px there was never any spare width, so narrow
          desktops are unchanged. */}
      <div className="mt-4 grid gap-7 lg:min-h-0 lg:flex-1 lg:justify-center lg:gap-9 lg:grid-cols-[minmax(0,42rem)_37rem]">
        <section className="relative h-[58vh] lg:h-auto lg:min-h-0">
          {dossier ? (
            <>
              <PaperView
                url={dossier.pdfUrl}
                highlight={highlight}
                zoom={ZOOMS[zoomStep]}
                dark={darkPage}
              />
              <PageTools
                step={zoomStep}
                onZoom={setZoomStep}
                dark={darkPage}
                onDark={() => setDarkPage((v) => !v)}
                offerDark={appIsDark}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[0.95rem] italic text-ink-faint">
              Fetching the paper&hellip;
            </div>
          )}
        </section>

        <aside className="flex flex-col lg:rule-left lg:min-h-0 lg:pl-9">
          {dossier ? (
            <>
              <Summary
                dossier={dossier}
                asking={asking}
                onToggleAsk={() => setAsking((v) => !v)}
                onJump={setJump}
              />

              {asking ? (
                <div className="min-h-0 flex-1 overflow-hidden pt-5">
                  <AskTab paperId={dossier.id} title={dossier.title || dossier.id} />
                </div>
              ) : (
                <Report
                  dossier={dossier}
                  graph={graph}
                  accuracy={accuracy}
                  selected={selected}
                  claim={claim}
                  showEvidence={showEvidence}
                  onSelect={select}
                  onToggleEvidence={() => setShowEvidence((v) => !v)}
                  onJump={setJump}
                />
              )}
            </>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function PageTools({
  step,
  onZoom,
  dark,
  onDark,
  offerDark,
}: {
  step: number;
  onZoom: (n: number) => void;
  dark: boolean;
  onDark: () => void;
  offerDark: boolean;
}) {
  return (
    <div className="absolute bottom-3 right-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-[2px] border border-paper-edge bg-paper/90 px-2 py-1 text-[0.8rem] backdrop-blur sm:right-4">
      {/* Offered whenever the interface is dark, and only then: on a light screen a
          white page is already the right answer and the control would be noise. */}
      {offerDark || dark ? (
        <>
          <button
            type="button"
            onClick={onDark}
            aria-pressed={dark}
            title={
              dark
                ? "Show the page as published"
                : "Invert the page (figures will invert too)"
            }
            className="px-1 transition-colors hover:text-brass"
            style={{ color: dark ? "var(--color-brass)" : "var(--color-ink-soft)" }}
          >
            {dark ? "inverted" : "invert"}
          </button>
          <span aria-hidden className="text-ink-faint/40">
            |
          </span>
        </>
      ) : null}
      <button
        type="button"
        onClick={() => onZoom(Math.max(0, step - 1))}
        disabled={step === 0}
        aria-label="Zoom out"
        className="px-1 text-ink-soft transition-colors hover:text-brass disabled:text-ink-faint/40"
      >
        &minus;
      </button>
      <span className="numeral w-10 text-center text-ink-faint">
        {Math.round(ZOOMS[step] * 100)}%
      </span>
      <button
        type="button"
        onClick={() => onZoom(Math.min(ZOOMS.length - 1, step + 1))}
        disabled={step === ZOOMS.length - 1}
        aria-label="Zoom in"
        className="px-1 text-ink-soft transition-colors hover:text-brass disabled:text-ink-faint/40"
      >
        +
      </button>
    </div>
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
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-5 border-b border-paper-edge pb-3.5">
      <Link
        href="/"
        className="pressed text-[1.6rem] leading-none tracking-[-0.02em] transition-colors hover:text-brass"
      >
        Keystone
      </Link>

      <span className="flex min-w-0 flex-1 items-center justify-end gap-4 sm:gap-7">
        <ThemeToggle />
        <AccountMenu />
        <select
          value={current}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Paper"
          className="w-full max-w-[28rem] truncate border-b border-ink/25 bg-transparent pb-0.5 font-[family-name:var(--font-display)] text-[0.95rem] text-ink outline-none transition-colors hover:border-brass focus:border-brass sm:text-[1rem]"
        >
          {index.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </span>
    </header>
  );
}

function Summary({
  dossier,
  asking,
  onToggleAsk,
  onJump,
}: {
  dossier: Dossier;
  asking: boolean;
  onToggleAsk: () => void;
  onJump: (a: AnchorJson | null) => void;
}) {
  const { lineage, assumptionTally } = dossier;
  const stands = lineage.tally.inherits + lineage.tally.extends;
  return (
    <div className="shrink-0 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          {/* The keystone, in the sense the name was always reaching for: not a table
              of numbers but the piece this paper would collapse without. */}
          <Foundation edge={lineage.foundation} onJump={onJump} />
        </div>

        <button
          type="button"
          onClick={onToggleAsk}
          className="shrink-0 border-b pb-0.5 text-[0.95rem] transition-colors"
          style={{
            borderBottomColor: asking ? "var(--color-ink-faint)" : "var(--color-brass)",
            color: asking ? "var(--color-ink-soft)" : "var(--color-brass)",
          }}
        >
          {asking ? "back to the analysis" : "ask the paper →"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1.5 border-t border-paper-edge pt-3">
        {/* arXiv's own filing, shown with its code so it can be checked against the
            abstract page rather than taken on trust like everything else here. */}
        {dossier.arxiv?.primary ? (
          <a
            href={`https://arxiv.org/abs/${dossier.id}`}
            className="text-[0.82rem] text-ink-faint transition-colors hover:text-brass"
            title={`arXiv primary category ${dossier.arxiv.primary}`}
          >
            {dossier.arxiv.primaryName}{" "}
            <span className="numeral">{dossier.arxiv.primary}</span>
          </a>
        ) : null}
        <Stat n={stands} label="works it stands on" tone="var(--color-brass)" />
        {lineage.tally.contests > 0 ? (
          <Stat
            n={lineage.tally.contests}
            label="it argues with"
            tone="var(--color-missing)"
          />
        ) : null}
        {assumptionTally.total > 0 ? (
          <span className="flex items-baseline gap-2.5">
            <Stat n={assumptionTally.total} label="assumptions" />
            <AssumptionSummary tally={assumptionTally} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <motion.span
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
        className="numeral text-[1.1rem]"
        style={{ color: tone ?? "var(--color-ink)" }}
      >
        {n}
      </motion.span>
      <span className="text-[0.82rem] text-ink-soft">{label}</span>
    </span>
  );
}

function Report({
  dossier,
  graph,
  accuracy,
  selected,
  claim,
  showEvidence,
  onSelect,
  onToggleEvidence,
  onJump,
}: {
  dossier: Dossier;
  graph: LibraryGraph | null;
  accuracy: Accuracy | null;
  selected: number | null;
  claim: Claim | null;
  showEvidence: boolean;
  onSelect: (i: number) => void;
  onToggleEvidence: () => void;
  onJump: (a: AnchorJson | null) => void;
}) {
  // The broadest external corpus, which is the only honest place to state an error
  // rate. The ninety hand labels were drawn from these same forty-one papers, so
  // their agreement measures the rules' consistency, not whether they travel.
  const external = (accuracy?.external ?? []).reduce<ExternalScore | null>(
    (best, item) => (best && best.instances >= item.instances ? best : item),
    null,
  );
  const confirmed = dossier.baselines.filter((b) => b.outcome === "confirmed").length;
  const notFound = dossier.baselines.filter((b) => b.outcome === "not_found").length;

  const stands = [...dossier.lineage.edges].filter(
    (e) => e.stance === "inherits" || e.stance === "extends",
  );
  const disputes = dossier.lineage.edges.filter((e) => e.stance === "contests");
  const rivals = dossier.lineage.edges.filter((e) => e.stance === "compares");
  const inbound = (graph?.edges ?? []).filter((e) => e.to === dossier.id);
  const titles = Object.fromEntries(
    (graph?.nodes ?? []).map((n) => [n.id, n.title]),
  );

  return (
    <div className="mt-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-3">
      {/* Lineage first. What a paper inherits and argues with is always there and
          always specific; its arithmetic, on a careful paper, is always fine. */}
      <Section
        anchors={stands.map(edgeId)}
        title="What it stands on"
        count={stands.length}
        subtitle="method and setup taken from other work"
        defaultOpen
      >
        <LineageList edges={stands} onJump={onJump} />
      </Section>

      <Section
        title="What stands on this"
        count={inbound.length}
        subtitle={
          inbound.length > 0
            ? "other papers in the library that lean on it"
            : undefined
        }
        defaultOpen={inbound.length > 0 && inbound.length <= 6}
      >
        <InboundList edges={inbound} titles={titles} />
      </Section>

      <Section
        anchors={disputes.map(edgeId)}
        title="What it argues with"
        count={disputes.length}
        subtitle={
          disputes.length > 0 ? "where it says prior work is wrong" : undefined
        }
        defaultOpen={disputes.length > 0 && disputes.length <= 4}
      >
        <LineageList edges={disputes} onJump={onJump} />
      </Section>

      <Section
        anchors={dossier.assumptions.map(assumptionId)}
        title="What it takes on faith"
        count={dossier.assumptions.length}
        subtitle={
          dossier.assumptionTally.bare > 0
            ? `${dossier.assumptionTally.bare} stated with nothing offered`
            : undefined
        }
        defaultOpen={dossier.assumptionTally.bare > 0}
      >
        <AssumptionList assumptions={dossier.assumptions} onJump={onJump} />
      </Section>

      <Section
        anchors={rivals.map(edgeId)}
        title="What it measures against"
        count={rivals.length}
        subtitle="baselines it puts itself beside"
      >
        <LineageList edges={rivals} onJump={onJump} />
      </Section>

      <Section
        title="Headline claims"
        count={dossier.claims.length}
        subtitle={
          dossier.claims.length > 0 ? "traced to the table that carries them" : undefined
        }
      >
        <EvidenceMap
          claims={dossier.claims}
          keystoneTable={dossier.keystone?.table ?? null}
          selected={selected}
          onSelect={onSelect}
        />
        <ul className="mt-4 space-y-1">
          {dossier.claims.map((c, i) => (
            <ClaimRow
              key={i}
              claim={c}
              active={selected === i}
              onSelect={() => onSelect(i)}
            />
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
      </Section>

      <Section
        title="Every number in the paper"
        count={dossier.numbers.length}
        subtitle="measurements and setup"
      >
        <Numbers dossier={dossier} onJump={onJump} />
      </Section>

      <Section
        title="Tables"
        count={dossier.tables.length}
        subtitle="cells as the author wrote them"
      >
        <Tables dossier={dossier} onJump={onJump} />
      </Section>

      <Section
        title="Equations"
        count={dossier.equations.length}
        subtitle="exact, from the source"
      >
        <ul className="space-y-5">
          {dossier.equations.map((equation) => (
            <li key={equation.ordinal} className="border-b border-paper-edge/50 pb-4">
              <EquationView
                latex={equation.latex}
                label={equation.labels[0] ?? equation.environment}
                macros={dossier.macros}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="References"
        count={dossier.references.length}
        subtitle="the paper’s own bibliography"
      >
        <References references={dossier.references} />
      </Section>

      {/* No count on this one, deliberately. An empty audit is the thing this section
          exists to explain, so it must stay openable when there is nothing in it. */}
      <Section
        title="What was checked"
        subtitle={
          notFound > 0
            ? `${notFound} disagree with the cited paper`
            : dossier.baselines.length > 0
              ? `${confirmed} baselines confirmed`
              : "nothing to report \u2014 and why"
        }
      >
        <Checked dossier={dossier} />
      </Section>

      <Section
        title="Structure"
        count={dossier.sections.length}
        subtitle="where the evidence sits"
      >
        <Structure dossier={dossier} />
      </Section>

      <div className="py-7 text-[0.82rem] leading-relaxed text-ink-faint">
        <p>
          Every line above is quoted from this paper&rsquo;s own LaTeX source, with the
          words that placed it shown alongside. Nothing was summarised, and no model
          was in the loop. {dossier.lineage.tally.background} further citations say
          nothing the prose makes checkable, so nothing is claimed about them.
        </p>
        {/* How often these readings are right, stated here rather than left implicit.
            A tool whose claim is that its findings are checkable should publish its
            own error rate first. */}
        {external ? (
          <p className="mt-2.5">
            Scored against{" "}
            <span className="numeral">
              {external.instances.toLocaleString()}
            </span>{" "}
            citations labelled by other people in {external.corpus}, from papers
            outside this library. A stance was reported for{" "}
            <span className="numeral text-ink-soft">
              {Math.round(external.coverage * 100)}%
            </span>{" "}
            of them, and{" "}
            <span className="numeral text-ink-soft">
              {Math.round(external.spokenPrecision * 100)}%
            </span>{" "}
            of those were right &mdash;{" "}
            <span className="numeral">
              {Math.round(external.spokenInterval[0] * 100)}&ndash;
              {Math.round(external.spokenInterval[1] * 100)}%
            </span>{" "}
            with 95% confidence. The other{" "}
            <span className="numeral">
              {Math.round((1 - external.coverage) * 100)}%
            </span>{" "}
            carry no cue phrase this can read, and nothing is shown for them. So
            roughly one reading in five is wrong, and which one is not knowable &mdash;
            which is why the sentence is always shown.
          </p>
        ) : null}
      </div>
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
        className={`flex w-full items-baseline gap-4 rounded-[2px] border-l-2 px-3 py-2 text-left transition-colors ${
          active ? "bg-paper-deep/70" : "hover:bg-paper-deep/40"
        }`}
        style={{ borderLeftColor: tone }}
      >
        <span
          className="numeral w-[5.5rem] shrink-0 text-[1.05rem] leading-snug"
          style={{ color: supported || declared ? "var(--color-ink)" : "var(--color-missing)" }}
        >
          {claim.value}
        </span>
        {/* Two lines, not one with an ellipsis. Every row used to end in "..." */}
        <span className="line-clamp-2 min-w-0 flex-1 text-[0.9rem] leading-snug text-ink-soft">
          {claim.sentence}
        </span>
        <span className="numeral shrink-0 text-[0.76rem] text-ink-faint">
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
    <motion.div
      key={claim.value + claim.sentence.slice(0, 20)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
      className="mt-5 border-t border-paper-edge pt-4"
    >
      <p className="quote-mark text-[0.95rem] leading-relaxed text-ink-soft">
        {claim.sentence}
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[0.88rem]">
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
        <div className="mt-4 rounded-[2px] border border-paper-edge bg-paper/70 p-3">
          <p className="mb-2 text-[0.8rem] leading-snug text-ink-faint">
            {table.name}
            {table.caption ? ` — ${table.caption}` : ""}
          </p>
          <TableView table={table} focus={focus} />
        </div>
      ) : null}

      {!claim.anchor ? (
        <p className="mt-3 text-[0.8rem] italic leading-relaxed text-ink-faint">
          This sentence could not be located in the PDF, so there is nothing to
          highlight. The trace above still holds &mdash; it was made from the LaTeX.
        </p>
      ) : null}
    </motion.div>
  );
}

function Numbers({
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

  const options: { key: typeof filter; label: string }[] = [
    { key: "all", label: "all" },
    { key: "result", label: "results" },
    { key: "configuration", label: "setup" },
    { key: "untraced", label: "unevidenced" },
  ];

  return (
    <>
      <div className="mb-3 flex gap-5 text-[0.84rem]">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            className="border-b pb-0.5 transition-colors"
            style={{
              borderBottomColor:
                filter === option.key ? "var(--color-brass)" : "transparent",
              color: filter === option.key ? "var(--color-ink)" : "var(--color-ink-faint)",
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
        className="flex w-full items-baseline gap-3 rounded-[2px] border-l-2 px-3 py-1.5 text-left transition-colors hover:bg-paper-deep/40 disabled:cursor-default"
        style={{ borderLeftColor: tone }}
        title={number.sentence}
      >
        <span className="numeral w-[5.5rem] shrink-0 truncate text-[0.95rem]">
          {number.value}
        </span>
        <span className="w-[5.5rem] shrink-0 truncate text-[0.72rem] uppercase tracking-[0.08em] text-ink-faint">
          {number.section}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.86rem] text-ink-soft">
          {number.table ?? number.sentence}
        </span>
        <span className="numeral shrink-0 text-[0.74rem] text-ink-faint">
          {number.anchor ? `p${number.anchor.page + 1}` : "—"}
        </span>
      </button>
    </li>
  );
}

function Tables({
  dossier,
  onJump,
}: {
  dossier: Dossier;
  onJump: (a: AnchorJson | null) => void;
}) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <ul className="space-y-3">
      {dossier.tables.map((table, i) => (
        <li key={i} className="border-b border-paper-edge/50 pb-3">
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-baseline gap-3 text-left"
          >
            <span
              className="shrink-0 text-[0.95rem]"
              style={{
                color: table.supports > 0 ? "var(--color-brass)" : "var(--color-ink-soft)",
              }}
            >
              {table.name}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.86rem] text-ink-soft">
              {table.caption || "no caption recovered"}
            </span>
            <span className="numeral shrink-0 text-[0.74rem] text-ink-faint">
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
              className="mt-3"
            >
              <TableView table={table} />
              {table.anchor ? (
                <button
                  type="button"
                  onClick={() => onJump(table.anchor)}
                  className="mt-2 text-[0.82rem] italic text-brass transition-colors hover:text-ink"
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

function References({ references }: { references: Reference[] }) {
  const [onlyCheckable, setOnlyCheckable] = useState(false);
  const checkable = references.filter((r) => r.arxivId).length;
  const shown = onlyCheckable ? references.filter((r) => r.arxivId) : references;

  return (
    <>
      <p className="mb-3 text-[0.84rem] leading-relaxed text-ink-faint">
        No lookup service involved.{" "}
        <button
          type="button"
          onClick={() => setOnlyCheckable((v) => !v)}
          className="border-b border-dotted border-brass/60 italic text-brass transition-colors hover:text-ink"
        >
          {onlyCheckable ? "show all" : `${checkable} can be followed to arXiv`}
        </button>
      </p>

      <ul className="space-y-2.5">
        {shown.map((reference) => (
          <li key={reference.key} className="border-b border-paper-edge/40 pb-2.5">
            <p className="text-[0.9rem] leading-snug text-ink">
              {reference.title || reference.raw.slice(0, 120)}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[0.8rem] text-ink-faint">
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
        ))}
      </ul>
    </>
  );
}

function Checked({ dossier }: { dossier: Dossier }) {
  const { baselines, findings } = dossier;
  const confirmed = baselines.filter((b) => b.outcome === "confirmed");
  const missing = baselines.filter((b) => b.outcome === "not_found");
  const unavailable = baselines.filter((b) => b.outcome === "unavailable");

  return (
    <div className="space-y-6">
      {findings.length === 0 ? (
        <p className="text-[0.9rem] leading-relaxed text-ink-soft">
          No inconsistencies found. That is not a clean bill of health &mdash; it means
          the checks ran and found nothing, and what they covered is below so you can
          judge how much that is worth.
        </p>
      ) : (
        <ul className="space-y-4">
          {findings.map((finding, i) => (
            <li key={i} className="border-l-2 border-missing pl-4">
              <p className="text-[0.98rem] leading-snug text-ink">{finding.title}</p>
              <p className="mt-1.5 text-[0.86rem] italic leading-relaxed text-ink-soft">
                {finding.explanation}
              </p>
            </li>
          ))}
        </ul>
      )}

      {baselines.length === 0 ? (
        <p className="text-[0.86rem] leading-relaxed text-ink-faint">
          Nothing in this paper&rsquo;s tables is attributed to a citation that could be
          followed, so there was nothing to check across papers. That needs a comparison
          table whose rows cite their source, and a reference carrying an arXiv id.
        </p>
      ) : (
        <div>
          <p className="text-[0.86rem] leading-relaxed text-ink-soft">
            Every other check asks this paper about itself, which is why they stay quiet
            on careful work. This one reads the cited paper and asks whether it reports
            the figure attributed to it.
          </p>
          <p className="numeral mt-3 text-[0.88rem]">
            <span className="text-supported">{confirmed.length} confirmed</span>
            {missing.length > 0 ? (
              <span className="text-missing"> · {missing.length} not found</span>
            ) : null}
            {unavailable.length > 0 ? (
              <span className="text-ink-faint"> · {unavailable.length} unreadable</span>
            ) : null}
          </p>
          <ul className="mt-4 space-y-2">
            {[...missing, ...confirmed, ...unavailable].map((check, i) => (
              <BaselineRow key={i} check={check} />
            ))}
          </ul>
        </div>
      )}
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
    <li className="flex items-baseline gap-3 border-l-2 pl-3" style={{ borderLeftColor: tone }}>
      <span className="numeral w-14 shrink-0 text-[0.9rem]" style={{ color: tone }}>
        {check.value}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.86rem] text-ink-soft">
          {check.row || check.table} &rarr; {check.citedTitle}
        </span>
        {check.note ? (
          <span className="block text-[0.78rem] italic text-ink-faint">{check.note}</span>
        ) : null}
      </span>
      {check.arxivId ? (
        <a
          href={`https://arxiv.org/abs/${check.arxivId}`}
          target="_blank"
          rel="noreferrer"
          className="numeral shrink-0 text-[0.74rem] text-brass transition-colors hover:text-ink"
        >
          {check.arxivId}
        </a>
      ) : null}
    </li>
  );
}

function Structure({ dossier }: { dossier: Dossier }) {
  const max = Math.max(1, ...dossier.sections.map((s) => s.numbers));
  return (
    <ul className="space-y-0.5">
      {dossier.sections.map((section, i) => (
        <li
          key={i}
          className="flex items-baseline gap-3 border-b border-paper-edge/40 py-2"
        >
          <span className="w-[5.5rem] shrink-0 truncate text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
            {section.kind}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.92rem]">{section.title}</span>

          {/* A bar per section, so the shape of where a paper puts its numbers is
              visible at a glance rather than having to be read off a column. */}
          <span className="hidden w-20 shrink-0 sm:block">
            <span
              className="block h-1.5 rounded-[1px]"
              style={{
                width: `${Math.max(3, (section.numbers / max) * 100)}%`,
                background:
                  section.numbers > 0
                    ? "var(--color-supported)"
                    : "var(--color-paper-edge)",
                opacity: 0.55,
              }}
            />
          </span>
          <span className="numeral w-[7rem] shrink-0 text-right text-[0.74rem] text-ink-faint">
            {section.numbers} nums &middot; {section.citations} cites
          </span>
        </li>
      ))}
    </ul>
  );
}
