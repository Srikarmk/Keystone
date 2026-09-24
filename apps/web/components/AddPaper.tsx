"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { readArxivId } from "@/lib/arxiv";

/*
 * Read a paper that is not in the library.
 *
 * The library is seventy-four papers chosen by hand, which is the honest limit of a
 * demonstration: the paper somebody actually wants to look at is never in it. Paste an
 * id and the same parser runs against it on the way to the page.
 *
 * The id is checked here before navigating. Not for the server's benefit — the
 * function validates it again, and has to — but so that a typo says so immediately
 * instead of loading a reader that spends three seconds discovering the same thing.
 */
export function AddPaper({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [complaint, setComplaint] = useState<string | null>(null);

  const go = () => {
    const id = readArxivId(text);
    if (!id) {
      setComplaint(
        text.trim()
          ? "That is not an arXiv id. A link to the abstract works too."
          : null,
      );
      return;
    }
    setComplaint(null);
    router.push(`/paper/${id}`);
  };

  return (
    <div className={compact ? "" : "max-w-xl"}>
      <div className="flex items-baseline gap-3 border-b border-ink/20 pb-1 focus-within:border-brass">
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (complaint) setComplaint(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") go();
          }}
          placeholder="arXiv id or link — 1706.03762"
          aria-label="Read a paper by arXiv id"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[0.95rem] text-ink outline-none placeholder:text-ink-faint/70"
        />
        <button
          type="button"
          onClick={go}
          disabled={!text.trim()}
          className="shrink-0 text-[0.9rem] text-brass transition-colors hover:text-ink disabled:text-ink-faint/50"
        >
          read it &rarr;
        </button>
      </div>

      <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-faint">
        {complaint ?? (
          <>
            Any paper on arXiv that ships LaTeX source &mdash; about nine in ten. It is
            parsed on the way to the page, which takes a few seconds the first time.
          </>
        )}
      </p>
    </div>
  );
}
