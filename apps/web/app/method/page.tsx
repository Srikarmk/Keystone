"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import type { Accuracy, External as ExternalScore } from "@/lib/dossier";

/*
 * How the reading is done, and how often it is wrong.
 *
 * Every number on this page is read from `accuracy.json`, which is written by the
 * evaluation run itself. Nothing is typed in by hand, so the figures on the site
 * cannot drift from the run that produced them — which matters more here than
 * anywhere else, because this is the page making the claim that the rest can be
 * trusted.
 */

export default function Method() {
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null);

  useEffect(() => {
    fetch("/dossiers/accuracy.json")
      .then((r) => r.json())
      .then(setAccuracy)
      .catch(() => {});
  }, []);

  const external = [...(accuracy?.external ?? [])].sort(
    (a, b) => b.instances - a.instances,
  );

  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <SiteHeader />

      <section className="pt-10">
        <h1 className="pressed max-w-3xl text-[2.5rem] leading-[1.1] tracking-[-0.02em]">
          How it reads, and how often it is wrong
        </h1>
        <p className="mt-5 max-w-2xl text-[1.02rem] leading-relaxed text-ink-soft">
          Keystone does not summarise a paper and it does not ask a model what a
          citation meant. It looks for specific phrases in specific grammatical
          positions, and when it does not find one it says nothing at all.
        </p>
      </section>

      <section className="mt-12 grid gap-9 border-t border-paper-edge pt-9 sm:grid-cols-3">
        <Step n="i" title="Read the source, not the picture">
          Papers are parsed from the LaTeX arXiv ships alongside the PDF. That is why a
          quote here is the sentence the author typed, with its citation keys intact,
          rather than whatever a column-splitting text extractor made of a two-column
          page.
        </Step>
        <Step n="ii" title="A cue decides, and shows its working">
          &ldquo;Following Ba et al.&rdquo; and &ldquo;unlike Ba et al.&rdquo; are
          opposite statements about the same work. The phrase that decided each reading
          is shown beside it, so a wrong reading is visible rather than load-bearing.
        </Step>
        <Step n="iii" title="Pin it, or refuse to point">
          Each sentence is located in the PDF and stored as pixel rectangles, verified
          by re-reading the page geometry rather than trusting the matcher. Where a
          sentence cannot be located, nothing is drawn.
        </Step>
      </section>

      <section className="mt-14 border-t border-paper-edge pt-9">
        <h2 className="text-[1.35rem] leading-snug">Scored on other people&rsquo;s labels</h2>
        <p className="mt-4 max-w-2xl text-[0.98rem] leading-relaxed text-ink-soft">
          Accuracy measured on the papers a rule was written against is not accuracy,
          it is a restatement. So the cue grammar is scored against public benchmarks
          it was never tuned on, annotated by other people, on papers outside this
          library.
        </p>

        {external.length === 0 ? (
          <p className="mt-6 text-[0.92rem] italic text-ink-faint">
            Loading the evaluation&hellip;
          </p>
        ) : (
          <div className="mt-7 grid gap-8 sm:grid-cols-2">
            {external.map((score) => (
              <Benchmark key={score.corpus} score={score} />
            ))}
          </div>
        )}

        <div className="mt-9 max-w-2xl space-y-4 text-[0.92rem] leading-relaxed text-ink-soft">
          <p>
            <span className="text-ink">Why the coverage is low on purpose.</span> Most
            citations carry no cue phrase at all &mdash; they are a name in a list of
            names. A system that guessed at those would be right about as often as the
            base rate and would put a confident label on a sentence that does not
            support one. Silence is the correct output for a sentence that says nothing
            checkable, and it is the majority of them.
          </p>
          <p>
            <span className="text-ink">What that costs.</span> Macro-F1 punishes
            abstention exactly as hard as error, so on these benchmarks it is low
            {accuracy?.external?.[0]
              ? ` (${accuracy.external[0].macroF1.toFixed(2)} on ${accuracy.external[0].corpus})`
              : ""}{" "}
            against neural classifiers around 0.84. That is the honest trade and not a
            rounding error: this is not the system to use if you need a label on every
            citation. It is the one to use if a label needs to be checkable.
          </p>
          {accuracy && accuracy.heldOutAccuracy !== null ? (
            <p>
              <span className="text-ink">In-domain, for comparison.</span> On{" "}
              <span className="numeral">{accuracy.labelled}</span> hand-labelled rows
              from this library it agrees{" "}
              <span className="numeral">{Math.round(accuracy.accuracy * 100)}%</span> of
              the time, and{" "}
              <span className="numeral">
                {Math.round(accuracy.heldOutAccuracy * 100)}%
              </span>{" "}
              on the <span className="numeral">{accuracy.heldOut}</span> labelled after
              the rules last changed &mdash; the only half of that pair that means
              anything, and too small a sample to pin down further than{" "}
              <span className="numeral">
                {Math.round(accuracy.heldOutInterval[0] * 100)}&ndash;
                {Math.round(accuracy.heldOutInterval[1] * 100)}%
              </span>
              .
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-14 border-t border-paper-edge pt-9">
        <h2 className="text-[1.35rem] leading-snug">What it will not tell you</h2>
        <ul className="mt-5 max-w-2xl space-y-3.5 text-[0.95rem] leading-relaxed text-ink-soft">
          <Limit>
            Whether a paper is any good. Nothing here is a judgement; it is a report of
            what the paper said about other work and about itself.
          </Limit>
          <Limit>
            Anything about a paper that does not ship LaTeX source. Roughly one arXiv
            paper in ten does not, and those are absent rather than approximated.
          </Limit>
          <Limit>
            What a citation with no cue meant. Those rows are blank on purpose, and a
            blank row is not a claim that the citation is unimportant.
          </Limit>
          <Limit>
            Whether an assumption is reasonable. Only whether the sentence stating it
            offered a citation, its own evidence, or nothing.
          </Limit>
        </ul>

        <div className="mt-8 flex flex-wrap items-center gap-6">
          <Link
            href="/contested"
            className="border-b border-brass pb-1 text-[0.98rem] text-brass transition-colors hover:text-ink"
          >
            See where papers disagree &rarr;
          </Link>
          <a
            href="https://github.com/Srikarmk/Keystone"
            className="text-[0.92rem] text-ink-soft transition-colors hover:text-brass"
          >
            Read the rules themselves
          </a>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="numeral text-[0.72rem] uppercase tracking-[0.2em] text-brass">
        {n}
      </span>
      <h3 className="mt-2 text-[1.08rem] leading-snug">{title}</h3>
      <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}

function Limit({ children }: { children: React.ReactNode }) {
  return (
    <li className="border-l-2 border-paper-edge pl-4">{children}</li>
  );
}

function Benchmark({ score }: { score: ExternalScore }) {
  const coverage = Math.round(score.coverage * 100);
  return (
    <div className="border-t-2 border-brass/50 pt-4">
      <h3 className="flex items-baseline gap-2.5">
        <span className="text-[1.05rem]">{score.corpus}</span>
        <span className="numeral text-[0.74rem] text-ink-faint">
          {score.instances.toLocaleString()} citations
        </span>
      </h3>

      {/* The bar is the honest picture of this system in one shape: a narrow slice it
          speaks to, and the rest left alone. A precision figure on its own hides
          exactly that. */}
      <div className="mt-4 flex h-2 w-full overflow-hidden rounded-[1px] bg-paper-deep">
        <span
          className="h-full bg-brass"
          style={{ width: `${Math.max(1.5, coverage)}%` }}
          title={`${coverage}% given a stance`}
        />
      </div>
      <p className="numeral mt-2 text-[0.76rem] text-ink-faint">
        {coverage}% given a stance &middot; {score.spoken.toLocaleString()} readings
      </p>

      <dl className="mt-4 space-y-1.5 text-[0.88rem]">
        <Row
          term="right, when it speaks"
          value={`${Math.round(score.spokenPrecision * 100)}%`}
          note={`95% CI ${Math.round(score.spokenInterval[0] * 100)}–${Math.round(
            score.spokenInterval[1] * 100,
          )}%`}
        />
        <Row term="macro-F1" value={score.macroF1.toFixed(3)} note="abstention counts as error" />
        {score.unreachable?.length ? (
          <Row
            term="classes it cannot express"
            value={score.unreachable.join(", ")}
            note="no cue grammar for these"
          />
        ) : null}
      </dl>
    </div>
  );
}

function Row({ term, value, note }: { term: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-paper-edge/60 pb-1.5">
      <dt className="text-ink-soft">{term}</dt>
      <dd className="flex items-baseline gap-2.5 text-right">
        <span className="numeral text-ink">{value}</span>
        {note ? <span className="text-[0.74rem] text-ink-faint">{note}</span> : null}
      </dd>
    </div>
  );
}
