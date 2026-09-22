/*
 * Line icons for the paper actions.
 *
 * Drawn rather than pulled from a set, for the same reason the favicon was: an icon
 * library brings its own drawing conventions — rounded 2px strokes, a 24px grid, a
 * house style — and next to type this thin they read as pasted in from somewhere
 * else. These are 1.25px on a 16px grid, which is about the weight of the surrounding
 * text, and they inherit `currentColor` so they pick up the same hover as the links
 * beside them.
 *
 * Every one keeps a `<title>`, because an icon on its own is a guess about what the
 * reader already knows.
 */

const BASE = {
  width: 15,
  height: 15,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function DownloadGlyph() {
  return (
    <svg {...BASE}>
      <path d="M8 2v7.5" />
      <path d="M5 7l3 3 3-3" />
      <path d="M2.5 12.5h11" />
    </svg>
  );
}

export function PrintGlyph() {
  return (
    <svg {...BASE}>
      {/* The sheet going in, the machine, the sheet coming out. */}
      <path d="M4.5 6V2.5h7V6" />
      <path d="M4.5 11.5h-2V6h11v5.5h-2" />
      <rect x="4.5" y="9.5" width="7" height="4" />
    </svg>
  );
}

export function ShareGlyph() {
  return (
    <svg {...BASE}>
      {/* Three nodes and the lines between them: a thing passed on, not a box. */}
      <circle cx="12" cy="3.5" r="1.6" />
      <circle cx="4" cy="8" r="1.6" />
      <circle cx="12" cy="12.5" r="1.6" />
      <path d="M5.4 7.2l5.2-2.9" />
      <path d="M5.4 8.8l5.2 2.9" />
    </svg>
  );
}

export function CiteGlyph() {
  return (
    <svg {...BASE}>
      {/* Two opening quotes, which is what a citation is. */}
      <path d="M6 4.5C4.3 5.2 3.3 6.6 3.3 8.3V11H7V7.6H5.2c0-1 .4-1.8 1.4-2.3z" />
      <path d="M12.7 4.5C11 5.2 10 6.6 10 8.3V11h3.7V7.6h-1.8c0-1 .4-1.8 1.4-2.3z" />
    </svg>
  );
}

export function CodeGlyph() {
  return (
    <svg {...BASE}>
      <path d="M5.5 5L2.5 8l3 3" />
      <path d="M10.5 5l3 3-3 3" />
      <path d="M9.2 3.2L6.8 12.8" />
    </svg>
  );
}

export function SearchGlyph() {
  return (
    <svg {...BASE}>
      <circle cx="7" cy="7" r="4.3" />
      <path d="M10.2 10.2l3.3 3.3" />
    </svg>
  );
}
