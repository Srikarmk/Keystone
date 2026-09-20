/*
 * A BibTeX entry for a paper in the library.
 *
 * Built from what arXiv says, not from the PDF: the title, the author list and the
 * submission date all come from the metadata request the library already makes, so
 * the entry cannot disagree with what the page shows.
 */

export interface Citable {
  id: string;
  title: string;
  authors?: string[];
  published?: string;
  primary?: string;
}

/** "Ashish Vaswani" → "Vaswani, Ashish", which is the form BibTeX sorts on. */
function surnameFirst(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  const surname = parts[parts.length - 1];
  return `${surname}, ${parts.slice(0, -1).join(" ")}`;
}

//: Words too common to identify a paper in a citation key.
const DULL = new Set([
  "a", "an", "the", "of", "for", "and", "on", "in", "to", "with", "from", "is",
  "are", "we", "you", "your", "its", "it", "by", "at", "as", "all", "need",
]);

/**
 * A key of the shape everyone's .bib already uses: surname, year, first real word.
 *
 * "vaswani2017attention". Not unique in principle — two papers by the same author in
 * the same year on the same subject would collide — but it matches what a reader's
 * existing bibliography looks like, and a key they have to rewrite is worse than one
 * they might have to disambiguate once.
 */
export function citationKey({ id, title, authors, published }: Citable): string {
  const surname = (authors?.[0] ?? "").trim().split(/\s+/).pop() ?? "";
  const year = published?.slice(0, 4) ?? "";
  const word =
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .find((w) => w.length > 2 && !DULL.has(w)) ?? "";
  const key = [surname, year, word].filter(Boolean).join("").replace(/[^A-Za-z0-9]/g, "");
  return key.toLowerCase() || id.replace(".", "");
}

/** The entry itself, as an arXiv preprint. */
export function bibtex(paper: Citable): string {
  const authors = (paper.authors ?? []).map(surnameFirst).join(" and ");
  const year = paper.published?.slice(0, 4) ?? "";
  const lines = [
    `@misc{${citationKey(paper)},`,
    `  title         = {${paper.title}},`,
    authors ? `  author        = {${authors}},` : null,
    year ? `  year          = {${year}},` : null,
    `  eprint        = {${paper.id}},`,
    `  archivePrefix = {arXiv},`,
    paper.primary ? `  primaryClass  = {${paper.primary}},` : null,
    `  url           = {https://arxiv.org/abs/${paper.id}},`,
    `}`,
  ];
  return lines.filter(Boolean).join("\n");
}
