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
  /**
   * Invert the page so it reads on a dark screen.
   *
   * Off by default even in dark mode, and reversible from the toolbar, because this
   * is the one part of the interface that is *the document*. Inverting a photograph
   * or a colour-coded plot changes what it shows, so the reader has to be able to see
   * the paper as it was published.
   */
  dark?: boolean;
  /**
   * Fit the whole page rather than the pane's width.
   *
   * True only in the side-by-side layout, where the pane is as tall as the window.
   * Stacked on a phone the pane is a fixed slice of the screen and the page should
   * fill the width and be scrolled.
   */
  fitPage?: boolean;
  onPageCount?: (count: number) => void;
}

/**
 * Invert, then rotate hues back, which is what keeps a figure's colours recognisable:
 * a plain invert turns every red curve cyan, and a reader comparing two lines on a
 * plot would be reading the wrong ones.
 *
 * `contrast` below 1 is what stops the page being pitch black. Inverting white gives
 * exactly zero, and no amount of `brightness` lifts that — multiplying zero gives
 * zero. Contrast pulls both ends toward the middle instead: at 0.75 the page settles
 * at 0.5 × (1 − 0.75) ≈ 0.125, about #202020, which is the dark theme's own
 * `paper-deep`; the text lands at 0.875, near its `ink`. So the page reads as one
 * more surface in the interface rather than as a hole cut in it.
 *
 * The sepia and saturate are a warm trim, because every other surface here is warm
 * and a neutral grey page beside them looks like a rendering bug.
 */
const DARK_PAGE =
  "invert(1) hue-rotate(180deg) contrast(0.75) sepia(0.06) saturate(1.06)";

const RENDER_SCALE = 1.6; // canvas resolution multiplier, independent of layout width

export function PaperView({
  url,
  highlight,
  zoom = 1,
  dark = false,
  onPageCount,
  fitPage = false,
}: PaperViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PageState[]>([]);
  const [width, setWidth] = useState(720);
  const [height, setHeight] = useState(900);
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
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
      setHeight(entry.contentRect.height);
    });
    observer.observe(node);
    setWidth(node.clientWidth);
    setHeight(node.clientHeight);
    return () => observer.disconnect();
  }, []);

  // The text layer, drawn at layout scale rather than render scale.
  //
  // The canvas is rasterised at RENDER_SCALE for sharpness, but the text layer has to
  // land on the page as the reader sees it, so it uses the plain layout viewport. Get
  // this wrong and selection lands a fifth of a page away from the words.
  const textRendered = useRef(new Map<HTMLDivElement, string>());
  const renderText = useCallback(
    async (pageNumber: number, holder: HTMLDivElement, layoutWidth: number) => {
      const doc = docRef.current;
      if (!doc) return;
      // Keyed on the element *and* the width, so a zoom re-lays it out but a scroll
      // past the same page does not rebuild it.
      const stamp = `${pageNumber}@${Math.round(layoutWidth)}`;
      if (textRendered.current.get(holder) === stamp) return;
      textRendered.current.set(holder, stamp);

      try {
        const pdfjs = await import("pdfjs-dist");
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: layoutWidth / base.width });

        holder.replaceChildren();
        // pdf.js positions every span with this, so it has to be on the container.
        holder.style.setProperty("--scale-factor", String(viewport.scale));
        holder.style.setProperty("--total-scale-factor", String(viewport.scale));

        const layer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: holder,
          viewport,
        });
        await layer.render();
      } catch {
        // A page whose text cannot be laid out stays unselectable. That is a lost
        // convenience, not a broken page — the drawing is already on screen.
        textRendered.current.delete(holder);
      }
    },
    [],
  );

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
      /* Room at the top for the actions bar that floats over this pane, so the
         first page starts below it instead of underneath it — the title of the
         paper is the last thing that should be covered by a toolbar. */
      className="h-full overflow-y-auto overflow-x-hidden rounded-[2px] bg-paper-deep/40 px-3 pb-3 pt-12"
    >
      {pages.length === 0 ? (
        <p className="py-16 text-center text-[0.9rem] italic text-ink-faint">
          Fetching the paper…
        </p>
      ) : null}

      {pages.map((page) => {
        // Side by side, fit the whole page. Stacked, fit the width.
        //
        // Fitting to width alone made a page 948px across and 1227 tall inside a pane
        // 911 tall, so the reader saw a wide slab of paper and had to scroll to learn
        // it was a page at all. Bounding by height as well fixes that — but only
        // where the pane is as tall as the window. On a phone the pane is a fixed
        // slice of the screen, and the same rule shrank the page to 352px inside a
        // 443px pane to satisfy a height nobody was asking it to respect.
        const fitWidth = width - 24;
        const fitHeight = (height - 16) * (page.width / page.height);
        const layoutWidth = Math.max(
          240,
          (fitPage ? Math.min(fitWidth, fitHeight) : fitWidth) * zoom,
        );
        const scale = layoutWidth / page.width;
        return (
          <PageCanvas
            key={page.number}
            page={page}
            layoutWidth={layoutWidth}
            scale={scale}
            render={renderPage}
            renderText={renderText}
            dark={dark}
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
  renderText,
  dark,
  marks,
}: {
  page: PageState;
  layoutWidth: number;
  scale: number;
  render: (n: number, canvas: HTMLCanvasElement, width: number) => void;
  renderText: (n: number, holder: HTMLDivElement, width: number) => void;
  dark: boolean;
  marks: { rect: AnchorRect; kind: "claim" | "evidence" }[];
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && canvas.current) {
          render(page.number, canvas.current, layoutWidth);
          if (text.current) renderText(page.number, text.current, layoutWidth);
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [page.number, layoutWidth, render, renderText]);

  return (
    <div
      ref={holder}
      data-page={page.number}
      className="relative mx-auto mb-3 shadow-[0_1px_10px_rgba(28,26,23,0.10)]"
      style={{
        width: layoutWidth,
        height: page.height * scale,
        // The holder is painted too, not just the canvas: an unrendered page would
        // otherwise flash white on a dark screen while it rasterises.
        background: dark ? "#181614" : "#ffffff",
      }}
    >
      <canvas
        ref={canvas}
        className="block h-full w-full"
        style={{ filter: dark ? DARK_PAGE : undefined }}
      />

      {/* Invisible text over the drawn page, so the browser can select it. Outside
          the inverting filter on purpose: the filter belongs to the picture of the
          page, and running transparent text through it changes the selection colour
          for no reason. */}
      <div ref={text} className="textLayer" />

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
            //
            // Inverted, multiply is the wrong operator: an amber wash over a dark page
            // darkens it towards black and the highlight disappears exactly where it
            // is needed. Screen lightens instead, which is the same idea the other way
            // up.
            mixBlendMode: dark ? "screen" : "multiply",
            background: dark
              ? kind === "claim"
                ? "rgba(120, 86, 34, 0.75)"
                : "rgba(52, 70, 50, 0.7)"
              : kind === "claim"
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
