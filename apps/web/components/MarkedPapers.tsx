"use client";

/*
 * The papers this reader has marked up, and the one button that erases all of it.
 *
 * The button is the reason this block exists. The reading list already had "forget it
 * everywhere", and the page's own privacy note promises that a reader can delete what
 * is kept about them — which marks quietly made untrue the moment they were stored,
 * since nothing on this page could reach them. A promise about deletion with no way to
 * delete is the sort of gap that is easy to leave and not defensible to leave.
 */

import Link from "next/link";
import { useState } from "react";

export function MarkedPapers({
  papers,
}: {
  papers: { id: string; title: string }[];
}) {
  const [listed, setListed] = useState(papers);
  const [state, setState] = useState<"idle" | "asking" | "working" | "failed">("idle");

  if (listed.length === 0) return null;

  return (
    <section className="mt-12 border-t border-paper-edge pt-6">
      <h2 className="text-[1.05rem]">
        Marked up{" "}
        <span className="numeral text-[0.82rem] text-ink-faint">{listed.length}</span>
      </h2>
      <ul className="mt-3 space-y-1.5">
        {listed.map((paper) => (
          <li key={paper.id} className="text-[0.92rem] leading-snug">
            <Link
              href={`/paper/${paper.id}`}
              className="text-ink transition-colors hover:text-brass"
            >
              {paper.title}
            </Link>{" "}
            <span className="numeral text-[0.76rem] text-ink-faint">{paper.id}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-4 text-[0.85rem]">
        {state === "asking" ? (
          <>
            <button
              type="button"
              onClick={async () => {
                setState("working");
                try {
                  const response = await fetch("/api/marks?scope=all", {
                    method: "DELETE",
                  });
                  if (!response.ok) throw new Error("refused");
                  setListed([]);
                  setState("idle");
                } catch {
                  setState("failed");
                }
              }}
              className="text-missing underline decoration-missing/40 underline-offset-2 hover:decoration-missing"
            >
              Yes, delete every highlight and note
            </button>
            <button
              type="button"
              onClick={() => setState("idle")}
              className="text-ink-faint transition-colors hover:text-brass"
            >
              keep them
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={state === "working"}
            onClick={() => setState("asking")}
            className="text-ink-soft transition-colors hover:text-missing disabled:text-ink-faint"
          >
            {state === "working" ? "deleting…" : "Delete every mark"}
          </button>
        )}
        {state === "failed" ? (
          <span className="text-missing">
            that did not go through &mdash; nothing was deleted
          </span>
        ) : null}
      </div>
    </section>
  );
}
