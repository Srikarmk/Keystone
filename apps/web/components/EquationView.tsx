"use client";

/*
 * Equations rendered from the paper's own LaTeX.
 *
 * These are exact rather than approximate: they came out of the source tarball, not
 * out of a reading of positioned glyphs. That is the one place where source ingestion
 * is unambiguously better than looking at the PDF — a stacked fraction or a stretched
 * delimiter is where glyph extraction is least reliable and where being wrong matters
 * most.
 */

import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

export function EquationView({
  latex,
  label,
  macros,
}: {
  latex: string;
  label?: string;
  /**
   * The paper's own \newcommand definitions. Papers write their equations in their
   * own notation — one of these defines \act, another \gain — and without them
   * every such symbol renders as error text instead of mathematics.
   */
  macros?: Record<string, string>;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
        macros,
        // Papers define their own macros constantly. Rather than fail, KaTeX renders
        // what it understands and marks the rest — a partially rendered equation is
        // far more use than an error box.
        errorColor: "var(--color-missing)",
        strict: false,
        trust: false,
      });
    } catch {
      return null;
    }
  }, [latex, macros]);

  if (!html) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-[2px] bg-paper-deep/50 p-3 text-[0.75rem] text-ink-soft">
        {latex}
      </pre>
    );
  }

  return (
    <figure className="my-1">
      <div
        className="overflow-x-auto py-1 text-ink"
        // KaTeX emits its own markup; the string is built here from source LaTeX and
        // rendered with trust disabled, so no \href or \includegraphics can smuggle
        // anything through.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {label ? (
        <figcaption className="numeral mt-0.5 text-[0.68rem] text-ink-faint">
          {label}
        </figcaption>
      ) : null}
    </figure>
  );
}
