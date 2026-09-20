"use client";

import { useEffect, useRef, useState } from "react";

import type { AnchorJson, SectionData } from "@/lib/dossier";

/**
 * Jump to a section of the paper.
 *
 * Sixteen pages is a lot to scroll past to reach the evaluation, and the reader
 * already knows the paper's structure — it extracts every section to count what is
 * in them. What it did not do is let you *go* there, which is a strange gap in a
 * tool whose whole claim is that it can put you on the right page.
 *
 * Only sections it can actually anchor are offered. A heading it could not locate
 * would be a menu item that does nothing, and the alternative — scrolling to a
 * guessed position — is the sort of nearly-right that this project avoids
 * everywhere else.
 */
export function Outline({
  sections,
  onJump,
}: {
  sections: SectionData[];
  onJump: (anchor: AnchorJson | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const reachable = sections.filter((section) => section.anchor);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (reachable.length < 2) return null;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="px-1 text-ink-soft transition-colors hover:text-brass"
        title="Jump to a section"
      >
        sections
      </button>

      {open ? (
        <div className="absolute bottom-[calc(100%+0.5rem)] right-0 max-h-[60vh] w-[19rem] overflow-y-auto border border-paper-edge bg-paper/95 py-1.5 shadow-lg backdrop-blur">
          {reachable.map((section, i) => (
            <button
              key={`${section.title}-${i}`}
              type="button"
              onClick={() => {
                onJump(section.anchor ?? null);
                setOpen(false);
              }}
              className="flex w-full items-baseline justify-between gap-3 px-3.5 py-1.5 text-left transition-colors hover:bg-paper-deep"
            >
              <span
                className={`min-w-0 flex-1 truncate text-[0.86rem] ${
                  section.kind === "abstract" || section.kind === "introduction"
                    ? "text-ink"
                    : "text-ink-soft"
                }`}
              >
                {section.title}
              </span>
              <span className="numeral shrink-0 text-[0.72rem] text-ink-faint">
                p{(section.anchor?.page ?? 0) + 1}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
