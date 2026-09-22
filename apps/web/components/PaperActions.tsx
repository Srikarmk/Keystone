"use client";

import { useEffect, useRef, useState } from "react";

import { bibtex, type Citable } from "@/lib/cite";
import {
  CiteGlyph,
  DownloadGlyph,
  PrintGlyph,
  ShareGlyph,
} from "@/components/Glyph";

/*
 * Take the paper away with you: the file, a printout, a link, a citation.
 *
 * The PDF lives on arXiv, which would normally rule out two of these — the `download`
 * attribute is ignored cross-origin, and a cross-origin iframe cannot be printed. But
 * arXiv serves it with `access-control-allow-origin: *`, so the browser can hold the
 * file itself. From a blob both work properly: a real download with a sensible
 * filename, and a real print dialog on a same-origin document.
 */

type Busy = "" | "download" | "print";

function Action({
  glyph,
  onClick,
  title,
  busy,
}: {
  glyph: React.ReactNode;
  onClick: () => void;
  title: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-busy={busy || undefined}
      className="flex h-6 w-6 items-center justify-center text-ink-faint transition-colors hover:text-brass disabled:text-ink-faint/40"
      disabled={busy}
    >
      {busy ? <Spinner /> : glyph}
    </button>
  );
}

/** A quiet mark for the seconds a two-megabyte PDF takes to arrive. */
function Spinner() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      aria-hidden
      className="animate-spin"
    >
      <circle cx="8" cy="8" r="5.4" strokeOpacity="0.28" />
      <path d="M8 2.6a5.4 5.4 0 0 1 5.4 5.4" />
    </svg>
  );
}

export function PaperActions({ paper, pdfUrl }: { paper: Citable; pdfUrl: string }) {
  const [busy, setBusy] = useState<Busy>("");
  const [said, setSaid] = useState("");
  const [showCite, setShowCite] = useState(false);
  const citeBox = useRef<HTMLDivElement>(null);

  // Object URLs are revoked on the way out; a printing iframe has to outlive the
  // click that made it, so it is torn down here rather than in the handler.
  const made = useRef<{ url: string; frame: HTMLIFrameElement }[]>([]);
  useEffect(
    () => () => {
      for (const { url, frame } of made.current) {
        URL.revokeObjectURL(url);
        frame.remove();
      }
    },
    [],
  );

  useEffect(() => {
    if (!showCite) return;
    const away = (e: MouseEvent) => {
      if (!citeBox.current?.contains(e.target as Node)) setShowCite(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setShowCite(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [showCite]);

  function announce(message: string) {
    setSaid(message);
    setTimeout(() => setSaid(""), 2200);
  }

  async function blob(): Promise<Blob | null> {
    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  }

  async function download() {
    setBusy("download");
    const file = await blob();
    setBusy("");
    if (!file) {
      // Falling back to a plain navigation rather than failing: the browser's own
      // viewer can still save it, which is most of what was wanted.
      window.open(pdfUrl, "_blank", "noopener");
      return;
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${paper.id}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function print() {
    setBusy("print");
    const file = await blob();
    setBusy("");
    if (!file) {
      window.open(pdfUrl, "_blank", "noopener");
      return;
    }
    const url = URL.createObjectURL(file);
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, "_blank", "noopener");
      }
    };
    document.body.append(frame);
    made.current.push({ url, frame });
  }

  async function share() {
    const url = window.location.href;
    // The system sheet where there is one — on a phone that is the expected way to
    // send a link on. Everywhere else, the clipboard.
    if (navigator.share) {
      try {
        await navigator.share({ title: paper.title, url });
        return;
      } catch {
        return; // dismissed, which is not a failure
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      announce("link copied");
    } catch {
      announce("could not copy");
    }
  }

  const entry = bibtex(paper);

  return (
    /* `relative` on the row, not on the button. Anchored to the button, the panel
       started wherever "cite" happened to sit — fourth along — and ran off the right
       edge of a phone: 528px of panel in a 527px window. From the row it starts at the
       text margin, where the width cap can actually keep it on screen. */
    <div ref={citeBox} className="relative flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      <Action
        glyph={<DownloadGlyph />}
        onClick={download}
        title="Save the PDF"
        busy={busy === "download"}
      />
      <Action
        glyph={<PrintGlyph />}
        onClick={print}
        title="Print the paper"
        busy={busy === "print"}
      />
      <Action glyph={<ShareGlyph />} onClick={share} title="Copy a link to this paper" />

      <button
        type="button"
        onClick={() => setShowCite((v) => !v)}
        aria-expanded={showCite}
        aria-label="Cite this paper"
        title="Cite this paper"
        className="flex h-6 w-6 items-center justify-center text-ink-faint transition-colors hover:text-brass"
      >
        <CiteGlyph />
      </button>

      {showCite ? (
        /* Width from the viewport, not from the row. `max-w-full` looked right and
           was not: this row is a flex *item*, so it is only as wide as the four words
           in it, and the panel collapsed to 193px of wrapped BibTeX. */
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-10 w-[26rem] max-w-[calc(100vw-3rem)] border border-paper-edge bg-paper/95 p-3.5 shadow-lg backdrop-blur">
          <pre className="numeral max-h-52 overflow-auto whitespace-pre-wrap text-[0.74rem] leading-relaxed text-ink-soft">
            {entry}
          </pre>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(entry);
                announce("BibTeX copied");
              } catch {
                announce("could not copy");
              }
              setShowCite(false);
            }}
            className="mt-2.5 border-b border-brass pb-0.5 text-[0.8rem] text-brass transition-colors hover:text-ink"
          >
            copy BibTeX
          </button>
        </div>
      ) : null}

      {said ? (
        <span role="status" className="text-[0.8rem] text-brass">
          {said}
        </span>
      ) : null}
    </div>
  );
}
