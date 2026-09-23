"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { byCue, rowHref, useLibrary, type LibraryRow } from "@/lib/library";

/*
 * What the library takes on faith, gathered into one place.
 *
 * Read one paper and "we believe this generalises" is a turn of phrase. Read four
 * hundred of them side by side and it is a habit with a shape: the same dozen cue
 * phrases, overwhelmingly in the introduction and the discussion, and the great
 * majority offering nothing at all in the sentence that states them.
 *
 * The grouping is by cue phrase for that reason. Grouping by paper would make this a
 * slower version of the reader; grouping by the words themselves is the thing you
 * cannot see from inside a single paper.
 */

const SUPPORT: { key: string; label: string; hint: string }[] = [
  { key: "bare", label: "nothing offered", hint: "no citation, no evidence, in the sentence that states it" },
  { key: "cited", label: "a citation", hint: "the sentence points at somebody else's work" },
  { key: "shown", label: "its own evidence", hint: "the sentence points at the paper's own results" },
];

export default function Assumptions() {
  const { library, failed } = useLibrary();
  const [support, setSupport] = useState<string>("bare");
  const [open, setOpen] = useState<string | null>(null);

  const all = useMemo(
    () => (library?.rows ?? []).filter((row) => row.kind === "assumption"),
    [library],
  );

  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const row of all) by[row.stance] = (by[row.stance] ?? 0) + 1;
    return by;
  }, [all]);

  const groups = useMemo(
    () => byCue(all.filter((row) => row.stance === support)),
    [all, support],
  );

  /*
   * Where in a paper these get said.
   *
   * Reported with its own denominators, which matters more than it looks. Papers
   * name their own sections, so there is a very long tail — "Motivations",
   * "Model Architectures", "Why does it work?" — and the six commonest cover well
   * under half the total. A top-six bar chart with no denominator would read as
   * "assumptions live in the introduction", which is not what the data says; what it
   * says is that the introduction is the single commonest of a hundred-odd places.
   */
  const sections = useMemo(() => {
    const by = new Map<string, number>();
    const mine = all.filter((r) => r.stance === support);
    for (const row of mine) {
      const name = row.section || "elsewhere";
      by.set(name, (by.get(name) ?? 0) + 1);
    }
    const ranked = [...by.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 6);
    return {
      top,
      distinct: ranked.length,
      total: mine.length,
      covered: top.reduce((n, [, count]) => n + count, 0),
    };
  }, [all, support]);

  const papers = useMemo(
    () => new Set(all.filter((r) => r.stance === support).map((r) => r.paper)).size,
    [all, support],
  );

  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <SiteHeader />

      <section className="pt-10">
        <h1 className="pressed max-w-3xl text-[2.5rem] leading-[1.1] tracking-[-0.02em]">
          What the library takes on faith
        </h1>
        <p className="mt-5 max-w-2xl text-[1.02rem] leading-relaxed text-ink-soft">
          Every paper announces a few things it is assuming and then gets on with the
          argument. Each one below is quoted as written, grouped by the phrase that
          announced it, and filed by what the same sentence offers for it.
        </p>
        <p className="mt-4 max-w-2xl text-[0.92rem] leading-relaxed text-ink-faint">
          &ldquo;Nothing offered&rdquo; is a statement about the sentence, not a
          verdict on the paper. The evidence may well be three paragraphs later. What
          it means is that the claim was made without anything attached to it at the
          moment it was made &mdash; which is exactly where an assumption becomes easy
          to forget.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-2">
          {SUPPORT.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setSupport(option.key);
                setOpen(null);
              }}
              title={option.hint}
              className={`text-[0.9rem] transition-colors ${
                support === option.key
                  ? "border-b border-brass pb-0.5 text-brass"
                  : "text-ink-faint hover:text-ink"
              }`}
            >
              {option.label}{" "}
              <span className="numeral">{counts[option.key] ?? 0}</span>
            </button>
          ))}
        </div>
      </section>

      {sections.top.length > 0 ? (
        <section className="mt-9 border-t border-paper-edge pt-6">
          <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint">
            The commonest places they are said
          </h2>
          <ul className="mt-4 space-y-2">
            {sections.top.map(([name, n]) => (
              <li key={name} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-[0.86rem] text-ink-soft sm:w-44">
                  {name}
                </span>
                {/* The bar takes its width from the space actually left over, not
                    from the viewport: a percentage of the row pushed it under the
                    count on a phone, where the label alone was half the screen. */}
                <span className="min-w-0 flex-1">
                  <span
                    className="block h-2 rounded-[1px] bg-brass/60"
                    style={{ width: `${Math.max(2, (n / sections.top[0][1]) * 100)}%` }}
                  />
                </span>
                <span className="numeral shrink-0 whitespace-nowrap text-[0.78rem] text-ink-faint">
                  {n} &middot; {Math.round((100 * n) / sections.total)}%
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-xl text-[0.8rem] leading-relaxed text-ink-faint">
            <span className="numeral">{sections.distinct}</span> distinct section names
            in all, because papers name their own &mdash; these six hold{" "}
            <span className="numeral">
              {Math.round((100 * sections.covered) / sections.total)}%
            </span>{" "}
            of <span className="numeral">{sections.total}</span>, across{" "}
            <span className="numeral">{papers}</span> papers. The rest are spread thin.
          </p>
        </section>
      ) : null}

      <section className="mt-10 border-t border-paper-edge pt-8">
        <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint">
          By the phrase that announced it
        </h2>

        {failed ? (
          <p className="mt-5 text-[0.95rem] italic text-ink-faint">
            The library index could not be loaded.
          </p>
        ) : !library ? (
          <p className="mt-5 text-[0.95rem] italic text-ink-faint">
            Reading the library&hellip;
          </p>
        ) : (
          <ul className="mt-5 space-y-1">
            {groups.map((group) => (
              <CueGroup
                key={group.cue}
                cue={group.cue}
                rows={group.rows}
                titles={library.titles}
                open={open === group.cue}
                onToggle={() => setOpen(open === group.cue ? null : group.cue)}
              />
            ))}
          </ul>
        )}
      </section>

      <Footer papers={library ? Object.keys(library.titles).length : undefined} />
    </main>
  );
}

function CueGroup({
  cue,
  rows,
  titles,
  open,
  onToggle,
}: {
  cue: string;
  rows: LibraryRow[];
  titles: Record<string, string>;
  open: boolean;
  onToggle: () => void;
}) {
  const widest = 60;
  return (
    <li className="border-b border-paper-edge/70">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group flex w-full items-center gap-4 py-2.5 text-left"
      >
        <span
          aria-hidden
          className="w-3 shrink-0 text-[0.7rem] text-ink-faint transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        >
          &rsaquo;
        </span>
        <span className="w-28 shrink-0 truncate text-[0.95rem] italic transition-colors group-hover:text-brass sm:w-48">
          &ldquo;{cue}&rdquo;
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block h-1.5 rounded-[1px] bg-brass/50"
            style={{ width: `${Math.max(1.5, (rows.length / widest) * 100)}%` }}
          />
        </span>
        <span className="numeral shrink-0 text-[0.8rem] text-ink-faint">
          {rows.length}
        </span>
      </button>

      {open ? (
        <ul className="space-y-4 pb-5 pl-7">
          {rows.map((row) => (
            <li key={row.row + row.paper} className="border-l-2 border-paper-edge pl-4">
              <p className="text-[0.9rem] leading-relaxed text-ink">
                &ldquo;{row.text}&rdquo;
              </p>
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[0.78rem] text-ink-faint">
                <Link
                  href={`/paper/${row.paper}`}
                  className="max-w-md truncate text-ink-soft transition-colors hover:text-brass"
                >
                  {titles[row.paper] ?? row.paper}
                </Link>
                <span>{row.section}</span>
                <Link
                  href={rowHref(row)}
                  className="transition-colors hover:text-brass"
                >
                  see it on the page &rarr;
                </Link>
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
