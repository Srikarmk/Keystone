"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SearchGlyph } from "@/components/Glyph";
import { track } from "@/components/Track";

/*
 * Search the library by what its papers said, not by what they are called.
 *
 * Searching a paper collection by title is close to useless: a reader who knows the
 * title already knows where to go. The question worth answering is "does anything
 * here argue with layer normalisation", and the answer is in the sentences — which
 * is the one thing this project has and a title index does not.
 *
 * So a hit is a *reading*, and following it lands on that line with its section
 * open, using the same row ids the deep links use. The paper is where you end up,
 * not what you searched.
 */

interface Row {
  paper: string;
  kind: "edge" | "assumption";
  stance: string;
  text: string;
  cue: string;
  section: string;
  about: string;
  row: string;
}

interface Index {
  titles: Record<string, string>;
  rows: Row[];
}

const LIMIT = 40;

//: Whether what was typed reads as a question rather than a phrase to find.
//:
//: A guess, and a cheap one — but enter has to do *something*, and the two intents
//: are usually distinguishable: "layer normalization" is a phrase, "what argues with
//: layer normalization" is a question. Shift+enter overrides it either way, and the
//: "ask" button is always there, so a wrong guess costs one keystroke.
const QUESTION = /^(what|which|who|why|how|where|when|does|do|is|are|can|should|find|show|tell)\b|\?\s*$/i;

function looksLikeAQuestion(text: string): boolean {
  const trimmed = text.trim();
  return QUESTION.test(trimmed) || trimmed.split(/\s+/).length >= 6;
}

interface Pick {
  paper: string;
  title: string;
  kind: string;
  stance: string;
  section: string;
  cue: string;
  about: string;
  rowId: string;
  text: string;
  why: string;
}

interface Guidance {
  answer: string;
  picks: Pick[];
  considered?: number;
  message?: string;
}

const LABEL: Record<string, string> = {
  inherits: "adopts",
  extends: "builds on",
  contests: "argues with",
  compares: "measures against",
  background: "mentions",
  cited: "assumes, cited",
  shown: "assumes, shown",
  bare: "assumes, bare",
};

export function Search() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<Index | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // Asking is a second mode of the same box, not a second box. A reader who types a
  // phrase wants the lines that contain it; a reader who types a question wants to be
  // pointed somewhere. Both start the same way, so they start in the same place.
  const [asking, setAsking] = useState(false);
  const [guide, setGuide] = useState<Guidance | null>(null);
  const [thinking, setThinking] = useState(false);

  // Fetched on first open, not on load: it is the largest file the site has and most
  // visits never search.
  useEffect(() => {
    if (!open || index) return;
    fetch("/dossiers/search.json")
      .then((r) => r.json())
      .then(setIndex)
      .catch(() => setIndex({ titles: {}, rows: [] }));
  }, [open, index]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (event.key === "Escape") setOpen(false);
      // "/" is the search key everywhere else on the web, but only when the reader
      // is not already typing into something.
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => field.current?.focus(), 30);
    else {
      setQuery("");
      setCursor(0);
      setAsking(false);
      setGuide(null);
    }
  }, [open]);

  const ask = useCallback(async () => {
    const question = query.trim();
    if (question.length < 3) return;
    setAsking(true);
    setThinking(true);
    setGuide(null);
    try {
      track("search");
      const response = await fetch("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = (await response.json()) as Guidance & { message?: string };
      setGuide(
        response.ok
          ? body
          : { answer: body.message ?? "The guide is unavailable.", picks: [] },
      );
    } catch {
      setGuide({ answer: "The guide could not be reached.", picks: [] });
    } finally {
      setThinking(false);
    }
  }, [query]);

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!index || needle.length < 2) return [];
    const terms = needle.split(/\s+/);
    const scored: { row: Row; score: number }[] = [];
    for (const row of index.rows) {
      const text = row.text.toLowerCase();
      const near = `${row.cue} ${row.about}`.toLowerCase();
      const title = (index.titles[row.paper] ?? "").toLowerCase();
      if (!terms.every((t) => `${text} ${near} ${title}`.includes(t))) continue;

      // Where the words are matters more than that they are there. Searching "layer
      // normalization" first returned every line of the *Layer Normalization* paper,
      // because its title matched and so every one of its lines did — burying the
      // Transformer sentence that actually says "followed by layer normalization".
      //
      // So: the sentence itself first, then the cue or the work being cited, then the
      // paper's name last. A paper's title matching is the weakest kind of hit there
      // is, because it is true of every line that paper has.
      const tier = text.includes(needle)
        ? 0
        : near.includes(needle)
          ? 1
          : terms.every((t) => text.includes(t))
            ? 2
            : 3;
      scored.push({ row, score: tier * 10_000 + Math.min(row.text.length, 900) });
    }
    scored.sort((a, b) => a.score - b.score);

    // One sentence, one result. "We employ a residual connection [He et al. 2016]
    // around each of the two sub-layers, followed by layer normalization [Ba et al.
    // 2016]" is two readings — it cites two works — and both are real rows. But a
    // reader searching sees the same sentence twice and reads it as a bug. They land
    // in the same place either way, since the two rows sit next to each other.
    const seen = new Set<string>();
    const unique: Row[] = [];
    for (const { row } of scored) {
      const key = `${row.paper}\u0000${row.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
      if (unique.length >= LIMIT) break;
    }
    return unique;
  }, [index, query]);

  useEffect(() => setCursor(0), [query]);

  const go = useCallback(
    (row: Row) => {
      setOpen(false);
      router.push(`/paper/${row.paper}#${row.row}`);
    },
    [router],
  );

  function onKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      // A question gets asked; a phrase jumps to its line. The shift key is the
      // reader saying which they meant when the text could be either.
      if (event.shiftKey || looksLikeAQuestion(query)) void ask();
      else if (hits[cursor]) go(hits[cursor]);
      else void ask();
    }
  }

  useEffect(() => {
    list.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search the library  ⌘K"
        aria-label="Search the library"
        className="flex h-6 w-6 items-center justify-center text-ink-soft transition-colors hover:text-brass"
      >
        <SearchGlyph />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 pt-[12vh] backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-2xl border border-paper-edge bg-paper shadow-2xl">
            <div className="flex items-center gap-3 border-b border-paper-edge px-4 py-3">
              <span className="text-ink-faint">
                <SearchGlyph />
              </span>
              <input
                ref={field}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="a phrase to find, or a question to ask"
                aria-label="Search the library"
                className="min-w-0 flex-1 bg-transparent text-[1rem] text-ink outline-none placeholder:text-ink-faint/70"
              />
              <button
                type="button"
                onClick={() => void ask()}
                disabled={query.trim().length < 3 || thinking}
                className="shrink-0 text-[0.78rem] text-ink-faint transition-colors hover:text-brass disabled:text-ink-faint/40"
                title="Ask the library where to look (shift + enter)"
              >
                {thinking ? "looking…" : "ask"}
              </button>
              <kbd className="numeral shrink-0 text-[0.7rem] text-ink-faint">esc</kbd>
            </div>

            {asking ? (
              <div className="max-h-[52vh] overflow-y-auto px-4 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setAsking(false);
                    setGuide(null);
                  }}
                  className="text-[0.76rem] italic text-ink-faint transition-colors hover:text-brass"
                >
                  &larr; back to the lines
                </button>

                {thinking ? (
                  <p className="mt-3 text-[0.9rem] italic text-ink-faint">
                    Reading what the library actually says&hellip;
                  </p>
                ) : guide ? (
                  <>
                    <p className="mt-3 text-[0.95rem] leading-relaxed text-ink">
                      {guide.answer}
                    </p>
                    {guide.picks.length > 0 ? (
                      <ul className="mt-4 space-y-3.5">
                        {guide.picks.map((pick, i) => (
                          <li
                            key={i}
                            className="border-l-2 pl-3.5"
                            style={{
                              borderLeftColor:
                                pick.stance === "contests"
                                  ? "var(--color-missing)"
                                  : "var(--color-brass)",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpen(false);
                                router.push(`/paper/${pick.paper}#${pick.rowId}`);
                              }}
                              className="block w-full text-left"
                            >
                              <span className="block text-[0.9rem] leading-snug transition-colors hover:text-brass">
                                {pick.title}
                              </span>
                              {/* The model's sentence, marked as the model's. */}
                              <span className="mt-0.5 block text-[0.8rem] italic text-ink-faint">
                                {pick.why}
                              </span>
                              {/* The paper's sentence, which the model never saw a
                                  way to alter: it chose a number, not this text. */}
                              <span className="mt-1.5 block text-[0.86rem] leading-relaxed text-ink-soft">
                                &ldquo;{pick.text}&rdquo;
                              </span>
                              <span className="mt-0.5 block text-[0.74rem] text-ink-faint">
                                {pick.section}
                                {pick.cue ? ` · placed by ${pick.cue}` : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="mt-5 border-t border-paper-edge pt-3 text-[0.74rem] leading-relaxed text-ink-faint">
                      The quotations are the papers&rsquo; own and were not written by
                      a model &mdash; it chose which lines to show, not what they say.
                      Only the italic line under each title is its own.
                    </p>
                  </>
                ) : null}
              </div>
            ) : query.trim().length < 2 ? (
              <p className="px-4 py-6 text-[0.88rem] leading-relaxed text-ink-faint">
                Searches the sentences, not the titles &mdash; every citation this
                library has read and every assumption it has found. A result takes you
                to that line on the page it appears on. Or ask a question and it will
                point you at the lines that bear on it.
              </p>
            ) : hits.length === 0 ? (
              <p className="px-4 py-6 text-[0.88rem] text-ink-faint">
                Nothing in the library says that.
              </p>
            ) : (
              <ul ref={list} className="max-h-[52vh] overflow-y-auto">
                {hits.map((row, i) => (
                  <li key={`${row.paper}-${row.row}-${i}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(row)}
                      className={`block w-full border-b border-paper-edge/60 px-4 py-2.5 text-left transition-colors ${
                        i === cursor ? "bg-paper-deep" : ""
                      }`}
                    >
                      <span className="flex items-baseline gap-2.5">
                        <span
                          className="shrink-0 text-[0.68rem] uppercase tracking-[0.1em]"
                          style={{
                            color:
                              row.stance === "contests"
                                ? "var(--color-missing)"
                                : "var(--color-brass)",
                          }}
                        >
                          {LABEL[row.stance] ?? row.stance}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[0.82rem] text-ink-faint">
                          {index?.titles[row.paper] ?? row.paper}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[0.88rem] leading-relaxed text-ink-soft">
                        <Marked text={row.text} needle={query.trim()} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** The matched words picked out, so a reader can see why a line came back. */
function Marked({ text, needle }: { text: string; needle: string }) {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0 || !needle) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-brass/20 text-ink">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
