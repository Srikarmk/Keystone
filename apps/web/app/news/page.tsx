"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import type { Item } from "@/lib/feeds";

/*
 * What is new, and what of it this project can read.
 *
 * The second half is the reason this is here rather than in a feed reader. A new paper
 * on arXiv carries an identifier, and Keystone can parse any paper on arXiv — so every
 * paper in this list is one click from its citations and assumptions, analysed on the
 * way to the page.
 *
 * Nothing is summarised. Each item shows its own title and the opening of its own
 * abstract or post; a feed that paraphrased its sources would be making claims this
 * project has no way to check, which is the one thing it is built not to do.
 */

interface Feed {
  items: Item[];
  sources: { id: string; name: string; kind: string; about: string }[];
  unreachable: string[];
  fetched: string;
}

const FILTERS = [
  { key: "all", label: "everything" },
  { key: "papers", label: "new papers" },
  { key: "writing", label: "writing" },
] as const;

export default function News() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<string>("all");
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/feed")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setFeed)
      .catch(() => setFailed(true));
  }, []);

  const shown = useMemo(() => {
    const items = feed?.items ?? [];
    return items.filter(
      (item) =>
        (kind === "all" || item.kind === kind) &&
        (!source || item.source === source),
    );
  }, [feed, kind, source]);

  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const item of feed?.items ?? []) by[item.source] = (by[item.source] ?? 0) + 1;
    return by;
  }, [feed]);

  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <SiteHeader />

      <section className="pt-10">
        <h1 className="pressed max-w-3xl text-[2.5rem] leading-[1.1] tracking-[-0.02em]">
          What the field published this week
        </h1>
        <p className="mt-5 max-w-2xl text-[1.02rem] leading-relaxed text-ink-soft">
          New papers from arXiv and writing from the labs and people who work on this,
          taken from the feeds they publish. Each item shows its own words and links to
          its own page &mdash; nothing here is summarised or rewritten.
        </p>
        <p className="mt-4 max-w-2xl text-[0.93rem] leading-relaxed text-ink-faint">
          Every arXiv paper below can be read by Keystone directly: follow{" "}
          <span className="text-brass">read it here</span> and the same parser that
          built the library runs against it on the way to the page.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setKind(filter.key)}
              className={`text-[0.9rem] transition-colors ${
                kind === filter.key
                  ? "border-b border-brass pb-0.5 text-brass"
                  : "text-ink-faint hover:text-ink"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </section>

      {feed && feed.sources.length > 0 ? (
        <section className="mt-8 border-t border-paper-edge pt-6">
          <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint">
            Sources
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              onClick={() => setSource(null)}
              className={`text-[0.82rem] transition-colors ${
                source === null
                  ? "border-b border-brass pb-0.5 text-brass"
                  : "text-ink-faint hover:text-ink"
              }`}
            >
              all {feed.sources.length}
            </button>
            {feed.sources.map((one) => (
              <button
                key={one.id}
                type="button"
                title={one.about}
                onClick={() => setSource(source === one.id ? null : one.id)}
                className={`text-[0.82rem] transition-colors ${
                  source === one.id
                    ? "border-b border-brass pb-0.5 text-brass"
                    : "text-ink-faint hover:text-ink"
                }`}
              >
                {one.name}{" "}
                <span className="numeral">{counts[one.id] ?? 0}</span>
              </button>
            ))}
          </div>
          {feed.unreachable.length > 0 ? (
            <p className="mt-3 text-[0.8rem] text-missing">
              Could not reach {feed.unreachable.join(", ")} &mdash; those are missing
              from the list below rather than silently absent.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-9 border-t border-paper-edge pt-8">
        {failed ? (
          <p className="text-[0.95rem] italic text-ink-faint">
            The feed could not be loaded.
          </p>
        ) : !feed ? (
          <p className="text-[0.95rem] italic text-ink-faint">
            Reading the feeds&hellip;
          </p>
        ) : shown.length === 0 ? (
          <p className="text-[0.95rem] italic text-ink-faint">Nothing of this kind.</p>
        ) : (
          <ul className="space-y-7">
            {shown.map((item, i) => (
              <li key={`${item.link}-${i}`}>
                <h3 className="text-[1.05rem] leading-snug">
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-brass"
                  >
                    {item.title}
                  </a>
                </h3>
                {item.summary ? (
                  <p className="mt-1.5 max-w-3xl text-[0.92rem] leading-relaxed text-ink-soft">
                    {item.summary}
                  </p>
                ) : null}
                <p className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[0.78rem] text-ink-faint">
                  <span>{item.sourceName}</span>
                  {item.published ? <Stamp iso={item.published} /> : null}
                  {item.arxivId ? (
                    <Link
                      href={`/paper/${item.arxivId}`}
                      className="text-brass transition-colors hover:text-ink"
                    >
                      read it here &rarr;
                    </Link>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Footer />
    </main>
  );
}

/** A date rendered on the client only, because the server's day may not be yours. */
function Stamp({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const date = new Date(iso);
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    setText(
      days <= 0
        ? "today"
        : days === 1
          ? "yesterday"
          : days < 14
            ? `${days} days ago`
            : date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    );
  }, [iso]);
  return <span className="numeral">{text}</span>;
}
