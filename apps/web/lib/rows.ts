/*
 * Stable identifiers for the individual readings, so one can be linked to.
 *
 * The whole claim of this project is that every line is checkable, which is hollow if
 * checking one means telling somebody to open a paper and scroll. A row needs its own
 * URL: send the link, they land on the sentence with the page already open at it.
 *
 * "Stable" means the same row keeps the same id across a rebuild, or a link shared
 * today is dead next week. So the id comes from what the row *is* — the citation key,
 * or the sentence — and never from its position in a list, which moves whenever a cue
 * is tuned or a paper is added.
 */

/** FNV-1a, 32-bit, base36. Short, deterministic, and no dependency. */
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A citation is identified by the work it points at, which is what the row is about. */
export function edgeId(edge: { key: string }): string {
  return `cite-${slug(edge.key) || digest(edge.key)}`;
}

/** An assumption has no key, so it is identified by the sentence it quotes. */
export function assumptionId(assumption: { sentence: string }): string {
  return `assume-${digest(assumption.sentence)}`;
}

/** Whether a fragment currently addresses this row. */
export function isTargeted(id: string): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hash.slice(1) === id;
}

/** The shareable address of one reading. */
export function rowUrl(id: string): string {
  if (typeof window === "undefined") return `#${id}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${id}`;
}
