"use client";

/*
 * The paper itself, with the analysis drawn on top of it — and, now, with the reader's
 * own marks drawn alongside.
 *
 * This is the part that makes the rest mean anything. A coverage number is a claim
 * about a document the reader cannot see; a highlight on the page is something they
 * can check in a second. Rectangles come from the anchor layer, which locates a quote
 * in the PDF's own words and refuses rather than guesses when it cannot.
 *
 * Coordinates need no conversion: MuPDF measures from the top-left in points, and a
 * pdf.js viewport at scale s renders the same space scaled by s, so a rectangle maps
 * straight through. A mark the reader makes is divided back down into the same space
 * on the way in, which is what lets the two be compared at all.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { MARK_COLOURS, condense, type Mark, type MarkColour } from "@/lib/marks";
import { newMarkId } from "@/lib/useMarks";

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

  /** The reader's own marks, to draw on the page. */
  marks?: Mark[];
  /** Whether marking is available — that is, whether anybody is signed in. */
  canMark?: boolean;
  onSave?: (mark: Mark) => void;
  onDelete?: (id: string) => void;
  /** The mark the report column is pointing at, so the page can agree with it. */
  active?: string | null;
  onActive?: (id: string | null) => void;
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

/*
 * The four mark colours, light and dark.
 *
 * Same reasoning as the analysis highlight: multiply on white keeps the words legible
 * through the wash, and on an inverted page multiply darkens towards black exactly
 * where the reader is looking, so screen is the right operator there instead. The dark
 * values are muted rather than the same hues turned up, because a saturated wash over
 * inverted text is where these stop being readable.
 */
const WASH: Record<MarkColour, { light: string; dark: string; edge: string; dot: string }> = {
  brass: {
    light: "rgba(224, 174, 92, 0.40)",
    dark: "rgba(120, 86, 34, 0.72)",
    edge: "rgba(169, 127, 61, 0.5)",
    dot: "#d0a45c",
  },
  moss: {
    light: "rgba(133, 168, 128, 0.40)",
    dark: "rgba(52, 78, 50, 0.72)",
    edge: "rgba(95, 122, 92, 0.5)",
    dot: "#7d9c79",
  },
  rose: {
    light: "rgba(212, 136, 122, 0.38)",
    dark: "rgba(112, 52, 44, 0.72)",
    edge: "rgba(168, 98, 63, 0.5)",
    dot: "#c4796c",
  },
  slate: {
    light: "rgba(132, 157, 184, 0.40)",
    dark: "rgba(48, 66, 88, 0.75)",
    edge: "rgba(94, 118, 145, 0.5)",
    dot: "#7e9ab8",
  },
};

const COLOUR_NAMES: Record<MarkColour, string> = {
  brass: "Brass",
  moss: "Moss",
  rose: "Rose",
  slate: "Slate",
};

interface Painted {
  rect: AnchorRect;
  kind: "claim" | "evidence" | "mark";
  colour?: MarkColour;
  id?: string;
  pending?: boolean;
  focused?: boolean;
}

export function PaperView({
  url,
  highlight,
  zoom = 1,
  dark = false,
  onPageCount,
  fitPage = false,
  marks = [],
  canMark = false,
  onSave,
  onDelete,
  active = null,
  onActive,
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

  /* ------------------------------------------------------------------------------
   * Making a mark.
   *
   * The browser hands back a selection in screen pixels; this turns it into a page,
   * a set of rectangles in PDF points, and the words themselves. Nothing here names a
   * span or an offset in the text layer, so a mark keeps meaning something after a
   * zoom, a resize, or a re-render of the layer it was drawn over.
   * ------------------------------------------------------------------------------ */

  /** The mark being made or edited. Unsaved until a colour is chosen. */
  const [editing, setEditing] = useState<{ mark: Mark; fresh: boolean } | null>(null);

  /** Every page's box on screen and its layout scale, read at the moment of use. */
  const pageBoxes = useCallback(() => {
    const node = containerRef.current;
    if (!node) return [];
    return [...node.querySelectorAll<HTMLElement>("[data-page]")].map((element) => ({
      page: Number(element.dataset.page) - 1,
      scale: Number(element.dataset.scale) || 1,
      box: element.getBoundingClientRect(),
    }));
  }, []);

  const capture = useCallback(() => {
    const selection = window.getSelection();
    const node = containerRef.current;
    if (!node) return;

    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    // Only a selection inside this pane. The report column beside it is selectable
    // text too, and highlighting a quote there should not try to mark the PDF.
    if (!node.contains(selection.anchorNode)) return;
    const quote = selection.toString().replace(/\s+/g, " ").trim();
    if (quote.length < 2) return;

    const boxes = pageBoxes();
    if (boxes.length === 0) return;

    // Per page, because a selection can run across a page break. Each client
    // rectangle is filed under the page its centre falls in.
    const byPage = new Map<number, { scale: number; rects: AnchorRect[]; area: number }>();
    for (const client of selection.getRangeAt(0).getClientRects()) {
      if (client.width <= 0 || client.height <= 0) continue;
      const midX = client.left + client.width / 2;
      const midY = client.top + client.height / 2;
      const found = boxes.find(
        ({ box }) =>
          midX >= box.left && midX <= box.right && midY >= box.top && midY <= box.bottom,
      );
      if (!found) continue;
      const entry =
        byPage.get(found.page) ?? { scale: found.scale, rects: [], area: 0 };
      entry.rects.push({
        x0: (client.left - found.box.left) / found.scale,
        y0: (client.top - found.box.top) / found.scale,
        x1: (client.right - found.box.left) / found.scale,
        y1: (client.bottom - found.box.top) / found.scale,
      });
      entry.area += (client.width * client.height) / (found.scale * found.scale);
      byPage.set(found.page, entry);
    }

    // The page the selection is mostly on. A mark is a place in a document, and a
    // rectangle list spanning a page break is not one place — so a selection dragged
    // across a break marks the page it covers most and leaves the rest alone, rather
    // than storing something that cannot be drawn or scrolled to.
    let best: { page: number; rects: AnchorRect[] } | null = null;
    let bestArea = 0;
    for (const [page, entry] of byPage) {
      if (entry.area > bestArea) {
        bestArea = entry.area;
        best = { page, rects: entry.rects };
      }
    }
    if (!best) return;

    const rects = condense(best.rects);
    if (rects.length === 0) return;

    const now = Date.now();
    setEditing({
      mark: {
        id: newMarkId(),
        page: best.page,
        rects,
        quote,
        colour: "brass",
        note: "",
        at: now,
        edited: now,
      },
      fresh: true,
    });
  }, [pageBoxes]);

  /** A plain click: dismiss, or pick up a mark the reader clicked on. */
  const clicked = useCallback(
    (x: number, y: number) => {
      for (const { page, scale, box } of pageBoxes()) {
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
        const localX = (x - box.left) / scale;
        const localY = (y - box.top) / scale;
        // Last first, so the most recent mark wins where two overlap — the same
        // order they are painted in.
        for (const mark of [...marks].reverse()) {
          if (mark.page !== page) continue;
          const hit = mark.rects.some(
            (r) =>
              localX >= r.x0 - 1 &&
              localX <= r.x1 + 1 &&
              localY >= r.y0 - 1 &&
              localY <= r.y1 + 1,
          );
          if (hit) {
            setEditing({ mark, fresh: false });
            onActive?.(mark.id);
            return;
          }
        }
      }
      setEditing(null);
      onActive?.(null);
    },
    [marks, onActive, pageBoxes],
  );

  const release = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Inside the popover itself: its own buttons handle it.
      if ((event.target as HTMLElement).closest("[data-mark-ui]")) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 1) {
        capture();
        return;
      }
      clicked(event.clientX, event.clientY);
    },
    [capture, clicked],
  );

  // A mark the report column points at opens on the page too, so following a note
  // from the list shows the note rather than just scrolling to its colour.
  useEffect(() => {
    if (!active) {
      setEditing((was) => (was && !was.fresh ? null : was));
      return;
    }
    const found = marks.find((one) => one.id === active);
    if (found) setEditing({ mark: found, fresh: false });
  }, [active, marks]);

  // Scroll a mark into view when it is picked from the list.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!active || pages.length === 0) return;
    if (scrolledTo.current === active) return;
    const found = marks.find((one) => one.id === active);
    if (!found) return;
    scrolledTo.current = active;
    const holder = containerRef.current?.querySelector<HTMLElement>(
      `[data-page="${found.page + 1}"]`,
    );
    if (!holder) return;
    const scale = Number(holder.dataset.scale) || 1;
    const top = holder.offsetTop + (found.rects[0]?.y0 ?? 0) * scale;
    // A third of the pane above the mark, so the panel that opens over it has
    // somewhere to go. At 120px it fitted a bare toolbar and not a note.
    const room = Math.min(260, (containerRef.current?.clientHeight ?? 600) * 0.34);
    containerRef.current?.scrollTo({
      top: Math.max(0, top - room),
      behavior: "smooth",
    });
  }, [active, marks, pages.length]);

  useEffect(() => {
    if (!active) scrolledTo.current = null;
  }, [active]);

  const commit = useCallback(
    (mark: Mark) => {
      setEditing({ mark, fresh: false });
      onSave?.(mark);
      onActive?.(mark.id);
      // The blue system selection over a fresh amber wash reads as a rendering fault.
      window.getSelection()?.removeAllRanges();
    },
    [onSave, onActive],
  );

  const discard = useCallback(
    (id: string) => {
      setEditing(null);
      onActive?.(null);
      onDelete?.(id);
    },
    [onDelete, onActive],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setEditing(null);
      onActive?.(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onActive]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-sm text-center text-[0.92rem] italic leading-relaxed text-ink-faint">
          The PDF could not be loaded ({error}). The ledger beside this still holds the
          full account &mdash; every claim, what it rests on, and what could not be traced.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onPointerUp={release}
      /* Room at the top for the actions bar that floats over this pane, so the
         first page starts below it instead of underneath it — the title of the
         paper is the last thing that should be covered by a toolbar. */
      className="h-full overflow-y-auto overflow-x-hidden rounded-[2px] bg-paper-deep/40 px-3 pb-3 pt-12"
    >
      {pages.length === 0 ? (
        <p className="py-16 text-center text-[0.9rem] italic text-ink-faint">
          Fetching the paper&hellip;
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
        const index = page.number - 1;
        const painted: Painted[] = [
          ...(highlight && highlight.page === index
            ? highlight.rects.map((r) => ({ rect: r, kind: "claim" as const }))
            : []),
          ...marks
            .filter((one) => one.page === index)
            .flatMap((one) =>
              one.rects.map((r) => ({
                rect: r,
                kind: "mark" as const,
                colour: one.colour,
                id: one.id,
                focused: one.id === active,
              })),
            ),
          // The mark being made, before it is saved. Shown so the reader can see what
          // they are about to keep rather than choosing a colour for an invisible thing.
          ...(editing?.fresh && editing.mark.page === index
            ? editing.mark.rects.map((r) => ({
                rect: r,
                kind: "mark" as const,
                colour: editing.mark.colour,
                pending: true,
              }))
            : []),
        ];

        return (
          <PageCanvas
            key={page.number}
            page={page}
            layoutWidth={layoutWidth}
            scale={scale}
            render={renderPage}
            renderText={renderText}
            dark={dark}
            marks={painted}
            overlay={
              editing && editing.mark.page === index ? (
                <MarkPopover
                  mark={editing.mark}
                  fresh={editing.fresh}
                  scale={scale}
                  pageWidth={layoutWidth}
                  pageHeight={page.height * scale}
                  canMark={canMark}
                  onChange={(next) => setEditing({ mark: next, fresh: editing.fresh })}
                  onCommit={commit}
                  onDelete={discard}
                  onClose={() => {
                    setEditing(null);
                    onActive?.(null);
                  }}
                />
              ) : null
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
  overlay,
}: {
  page: PageState;
  layoutWidth: number;
  scale: number;
  render: (n: number, canvas: HTMLCanvasElement, width: number) => void;
  renderText: (n: number, holder: HTMLDivElement, width: number) => void;
  dark: boolean;
  marks: Painted[];
  overlay?: React.ReactNode;
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
      /* The layout scale, read back when a selection has to be turned into page
         coordinates. Kept on the element rather than in a ref map because the
         selection handler needs it for whichever page the reader happened to drag
         across, and this is the one place that already knows it. */
      data-scale={scale}
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

      {marks.map(({ rect, kind, colour, id, pending, focused }, i) => {
        const wash = kind === "mark" ? WASH[colour ?? "brass"] : null;
        return (
          <span
            key={id ? `${id}-${i}` : `${kind}-${i}`}
            aria-hidden
            /* Never clickable, deliberately. A highlight that swallows pointer
               events is a highlight you cannot select text through, so marking a
               phrase inside something you already marked becomes impossible. Clicks
               are hit-tested against these rectangles instead, one level up. */
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
              opacity: pending ? 0.55 : 1,
              background: wash
                ? dark
                  ? wash.dark
                  : wash.light
                : dark
                  ? kind === "claim"
                    ? "rgba(120, 86, 34, 0.75)"
                    : "rgba(52, 70, 50, 0.7)"
                  : kind === "claim"
                    ? "rgba(224, 174, 92, 0.42)"
                    : "rgba(95, 122, 92, 0.30)",
              boxShadow: wash
                ? focused
                  ? `0 0 0 1.5px ${wash.dot}`
                  : `0 0 0 1px ${wash.edge}`
                : kind === "claim"
                  ? "0 0 0 1px rgba(169, 127, 61, 0.55)"
                  : "0 0 0 1px rgba(95, 122, 92, 0.45)",
            }}
          />
        );
      })}

      {overlay}

      <span className="numeral absolute -left-0 -top-5 text-[0.68rem] text-ink-faint">
        {page.number}
      </span>
    </div>
  );
}

/**
 * The little panel that appears over a selection.
 *
 * Positioned inside the page rather than in the window, which is what keeps it
 * attached to the words while the reader scrolls. Its own size is measured rather than
 * assumed: every previous panel in this interface that guessed its own width ended up
 * 528px wide in a 527px window, or anchored to the wrong end of a toolbar and drawn
 * off screen.
 *
 * The clamp is against *the scroll viewport*, not against the page. Clamping to the
 * page was the first attempt and it was wrong in a way that only showed up on a mark
 * in the middle of a document: a page is 800pt tall inside a 500px pane, so "4pt from
 * the top of page 3" is several hundred pixels above anything the reader can see. The
 * panel went above the selection, satisfied its clamp, and was invisible. So the
 * placement asks how much room there is *on screen* above and below the words, and
 * only then converts back into the page's coordinates for `style.top`.
 */
function MarkPopover({
  mark,
  fresh,
  scale,
  pageWidth,
  pageHeight,
  canMark,
  onChange,
  onCommit,
  onDelete,
  onClose,
}: {
  mark: Mark;
  fresh: boolean;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  canMark: boolean;
  onChange: (mark: Mark) => void;
  onCommit: (mark: Mark) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [writing, setWriting] = useState(!fresh && mark.note.length > 0);
  const [draft, setDraft] = useState(mark.note);

  useEffect(() => {
    setDraft(mark.note);
    setWriting(!fresh && mark.note.length > 0);
  }, [mark.id, mark.note, fresh]);

  const anchor = mark.rects[0] ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  const lowest = Math.max(...mark.rects.map((r) => r.y1), anchor.y1);

  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;

    const place = () => {
      const box = node.getBoundingClientRect();
      const w = box.width;
      const h = box.height;

      // The page this sits on, and the pane the page scrolls inside. Found by
      // walking up rather than assumed to be the parent, so a wrapper added to the
      // layout later does not silently move the panel back off screen.
      const holder = node.parentElement;
      let scroller = holder?.parentElement ?? null;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      if (!holder) return;

      const page = holder.getBoundingClientRect();
      const view = scroller?.getBoundingClientRect() ?? {
        top: 0,
        bottom: window.innerHeight,
      };

      let top = page.top + anchor.y0 * scale - h - 8;
      if (top < view.top + 6) {
        const under = page.top + lowest * scale + 8;
        top =
          under + h <= view.bottom - 6
            ? under
            : // Neither side fits: pin it inside the pane. A panel that is hard to
              // place is still a panel the reader has to be able to read.
              Math.max(view.top + 6, view.bottom - h - 6);
      }

      setAt({
        left: Math.min(
          Math.max(4, anchor.x0 * scale - 6),
          Math.max(4, pageWidth - w - 4),
        ),
        top: top - page.top,
      });
    };

    place();

    // Re-placed on resize *and* on scroll, and the scroll part is not optional.
    //
    // Opening the note editor roughly trebles the panel's height, which is exactly
    // when an above-the-selection placement stops fitting. And following a mark from
    // the list scrolls the pane smoothly, so the first placement is decided against
    // a viewport the page is still travelling through — which is how this shipped
    // 46px above the top of the pane and invisible, with the arithmetic all correct
    // for where the page had been a moment earlier.
    const observer = new ResizeObserver(place);
    observer.observe(node);

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    const holder = node.parentElement;
    let scroller = holder?.parentElement ?? null;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [anchor.x0, anchor.y0, lowest, scale, pageWidth, pageHeight, writing]);

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <div
      ref={panel}
      data-mark-ui
      onPointerUp={stop}
      onPointerDown={stop}
      className="absolute z-20 w-max max-w-[19rem] rounded-[3px] border border-paper-edge bg-paper shadow-[0_3px_14px_rgba(28,26,23,0.20)]"
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        // Hidden until it has been measured, so the reader never sees it jump from
        // the unclamped position to the clamped one.
        visibility: at ? "visible" : "hidden",
      }}
    >
      {!canMark ? (
        <div className="max-w-[17rem] px-3 py-2.5">
          <p className="text-[0.82rem] leading-snug text-ink-soft">
            Sign in to keep highlights and notes on this paper. They are yours, they
            follow you between machines, and nothing about them is public.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <a
              href="/signin"
              className="text-[0.82rem] text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
            >
              Sign in
            </a>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(mark.quote);
                onClose();
              }}
              className="text-[0.82rem] text-ink-faint transition-colors hover:text-brass"
            >
              Copy the words
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 px-1.5 py-1.5">
            {MARK_COLOURS.map((colour) => (
              <button
                key={colour}
                type="button"
                title={COLOUR_NAMES[colour]}
                aria-label={`${COLOUR_NAMES[colour]} highlight`}
                onClick={() => onCommit({ ...mark, colour, note: draft })}
                className="flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
              >
                <span
                  className="block h-4 w-4 rounded-full"
                  style={{
                    background: WASH[colour].dot,
                    boxShadow:
                      mark.colour === colour && !fresh
                        ? `0 0 0 1.5px var(--color-paper), 0 0 0 3px ${WASH[colour].dot}`
                        : "inset 0 0 0 1px rgba(28,26,23,0.18)",
                  }}
                />
              </button>
            ))}

            <span className="mx-0.5 h-4 w-px bg-paper-edge" aria-hidden />

            <button
              type="button"
              onClick={() => setWriting((v) => !v)}
              className={`px-1.5 text-[0.78rem] transition-colors ${
                writing || mark.note ? "text-brass" : "text-ink-faint hover:text-brass"
              }`}
            >
              {mark.note ? "Note ·" : "Note"}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(mark.quote);
                onClose();
              }}
              className="px-1.5 text-[0.78rem] text-ink-faint transition-colors hover:text-brass"
            >
              Copy
            </button>
            {!fresh ? (
              <button
                type="button"
                onClick={() => onDelete(mark.id)}
                className="px-1.5 text-[0.78rem] text-ink-faint transition-colors hover:text-missing"
              >
                Remove
              </button>
            ) : null}
          </div>

          {writing ? (
            <div className="border-t border-paper-edge/70 px-2 pb-2 pt-2">
              <textarea
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 4_000))}
                onKeyDown={(event) => {
                  // Enter saves, shift-enter breaks the line. A note is usually a
                  // sentence, so the common case should not need the mouse.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onCommit({ ...mark, note: draft.trim() });
                  }
                }}
                rows={3}
                placeholder="What do you make of it?"
                className="w-[17rem] resize-none rounded-[2px] border border-paper-edge bg-paper-deep/40 px-2 py-1.5 text-[0.84rem] leading-snug text-ink outline-none placeholder:italic placeholder:text-ink-faint focus:border-brass/60"
              />
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[0.72rem] italic text-ink-faint">
                  {fresh ? "saved when you choose a colour" : "Enter to save"}
                </span>
                <button
                  type="button"
                  onClick={() => onCommit({ ...mark, note: draft.trim() })}
                  className="text-[0.8rem] text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
