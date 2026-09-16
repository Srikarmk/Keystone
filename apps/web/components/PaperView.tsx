"use client";

/*
 * The paper itself, with the analysis drawn on top of it.
 *
 * This is the part that makes the rest mean anything. A coverage number is a claim
 * about a document the reader cannot see; a highlight on the page is something they
 * can check in a second. Rectangles come from the anchor layer, which locates a quote
 * in the PDF's own words and refuses rather than guesses when it cannot.
 *
 * Coordinates need no conversion: MuPDF measures from the top-left in points, and a
 * pdf.js viewport at scale s renders the same space scaled by s, so a rectangle maps
 * straight through.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface AnchorRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface AnchorJson {
  page: number;
  pageWidth: number;
  pageHeight: number;
  precision: string;
  rects: AnchorRect[];
}

interface PageState {
  number: number;
  width: number;
  height: number;
}

export interface PaperViewProps {
  url: string;
  highlight: AnchorJson | null;
  /**
   * Layout scale. Papers are typeset with wide margins, so fitting a page to the pane
   * leaves the text column small — zoom is the difference between the PDF being
   * present and being readable.
   */
  zoom?: number;
  onPageCount?: (count: number) => void;
}

const RENDER_SCALE = 1.6; // canvas resolution multiplier, independent of layout width

export function PaperView({ url, highlight, zoom = 1, onPageCount }: PaperViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PageState[]>([]);
  const [width, setWidth] = useState(720);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<any>(null);
  const renderedRef = useRef(new Set<number>());

  // Load the document and read every page's dimensions up front, so the scroll
  // container has its full height immediately and jumping to a page is exact.
  useEffect(() => {
    let cancelled = false;
    renderedRef.current = new Set();
    setPages([]);
    setError(null);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const doc = await pdfjs.getDocument({ url, withCredentials: false }).promise;
        if (cancelled) return;
        docRef.current = doc;

        const sizes: PageState[] = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: 1 });
          sizes.push({ number: n, width: viewport.width, height: viewport.height });
        }
        if (cancelled) return;
        setPages(sizes);
        onPageCount?.(doc.numPages);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "could not load the PDF");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, onPageCount]);

  // Zooming changes every page's canvas size, so the already-rendered set has to be
  // dropped or the pages keep their old resolution and go soft.
  useEffect(() => {
    renderedRef.current = new Set();
  }, [zoom]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Pages render only as they approach the viewport. A sixty-page appendix would
  // otherwise rasterise on load and lock the tab.
  const renderPage = useCallback(
    async (pageNumber: number, canvas: HTMLCanvasElement, layoutWidth: number) => {
      const doc = docRef.current;
      if (!doc || renderedRef.current.has(pageNumber)) return;
      renderedRef.current.add(pageNumber);

      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: (layoutWidth / base.width) * RENDER_SCALE,
      });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      await page.render({ canvasContext: context, viewport }).promise;
    },
    [],
  );

  // Scroll the highlighted page into view whenever the selection changes.
  useEffect(() => {
    if (!highlight || pages.length === 0) return;
    const target = containerRef.current?.querySelector(
      `[data-page="${highlight.page + 1}"]`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlight, pages.length]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-sm text-center text-[0.92rem] italic leading-relaxed text-ink-faint">
          The PDF could not be loaded ({error}). The ledger beside this still holds the
          full account — every claim, what it rests on, and what could not be traced.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto overflow-x-hidden rounded-[2px] bg-paper-deep/40 px-3 py-3"
    >
      {pages.length === 0 ? (
        <p className="py-16 text-center text-[0.9rem] italic text-ink-faint">
          Fetching the paper…
        </p>
      ) : null}

      {pages.map((page) => {
        const layoutWidth = Math.max(240, (width - 24) * zoom);
        const scale = layoutWidth / page.width;
        return (
          <PageCanvas
            key={page.number}
            page={page}
            layoutWidth={layoutWidth}
            scale={scale}
            render={renderPage}
            marks={
              highlight && highlight.page + 1 === page.number
                ? highlight.rects.map((r) => ({ rect: r, kind: "claim" as const }))
                : []
            }
          />
        );
      })}
    </div>
  );
}

function PageCanvas({
  page,
  layoutWidth,
  scale,
  render,
  marks,
}: {
  page: PageState;
  layoutWidth: number;
  scale: number;
  render: (n: number, canvas: HTMLCanvasElement, width: number) => void;
  marks: { rect: AnchorRect; kind: "claim" | "evidence" }[];
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && canvas.current) {
          render(page.number, canvas.current, layoutWidth);
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [page.number, layoutWidth, render]);

  return (
    <div
      ref={holder}
      data-page={page.number}
      className="relative mx-auto mb-3 bg-white shadow-[0_1px_10px_rgba(28,26,23,0.10)]"
      style={{ width: layoutWidth, height: page.height * scale }}
    >
      <canvas ref={canvas} className="block h-full w-full" />

      {marks.map(({ rect, kind }, i) => (
        <span
          key={`${kind}-${i}`}
          aria-hidden
          className="pointer-events-none absolute rounded-[1px] transition-opacity duration-300"
          style={{
            left: rect.x0 * scale,
            top: rect.y0 * scale,
            width: Math.max(2, (rect.x1 - rect.x0) * scale),
            height: Math.max(2, (rect.y1 - rect.y0) * scale),
            // Multiply keeps the text legible through the mark, the way a highlighter
            // works on paper. A flat overlay would grey the words it is pointing at.
            mixBlendMode: "multiply",
            background:
              kind === "claim"
                ? "rgba(224, 174, 92, 0.42)"
                : "rgba(95, 122, 92, 0.30)",
            boxShadow:
              kind === "claim"
                ? "0 0 0 1px rgba(169, 127, 61, 0.55)"
                : "0 0 0 1px rgba(95, 122, 92, 0.45)",
          }}
        />
      ))}

      <span className="numeral absolute -left-0 -top-5 text-[0.68rem] text-ink-faint">
        {page.number}
      </span>
    </div>
  );
}
