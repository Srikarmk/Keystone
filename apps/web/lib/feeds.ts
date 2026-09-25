/*
 * What is new in the field, from the people who publish it.
 *
 * RSS and Atom, not scraping. Every source here publishes a feed *for this purpose* —
 * it is the mechanism, it is stable, and it is not somebody's markup that breaks when
 * they redesign. Pulling the same information out of the HTML would be more fragile,
 * more requests, and in several cases against the site's own terms.
 *
 * What makes this Keystone's feed rather than a reader: an arXiv item carries an
 * identifier, and this project can already read any paper on arXiv. So a new paper in
 * the feed is one click from its citations and assumptions, parsed on the way.
 *
 * Nothing here is summarised or rewritten. Each item shows the title and the opening
 * of the abstract or post *as its author wrote it*, and links out. A feed that
 * paraphrased its sources would be making claims this project has no way to check.
 */

//: Relative, not `@/lib/arxiv`, and only here. The parser below is covered by tests
//: that run under plain Node, which resolves no TypeScript path aliases — and a feed
//: parser is exactly the kind of code that should be tested rather than eyeballed.
import { readArxivId } from "./arxiv.ts";

export interface Source {
  id: string;
  name: string;
  url: string;
  /** Papers, or writing about them. The reader can have one without the other. */
  kind: "papers" | "writing";
  /** Where it comes from, said plainly, because a feed is only as good as its source. */
  about: string;
}

export const SOURCES: Source[] = [
  { id: "cs.LG", name: "arXiv cs.LG", url: "https://arxiv.org/rss/cs.LG", kind: "papers", about: "Machine Learning — new submissions" },
  { id: "cs.CL", name: "arXiv cs.CL", url: "https://arxiv.org/rss/cs.CL", kind: "papers", about: "Computation and Language — new submissions" },
  { id: "cs.CV", name: "arXiv cs.CV", url: "https://arxiv.org/rss/cs.CV", kind: "papers", about: "Computer Vision — new submissions" },
  { id: "cs.AI", name: "arXiv cs.AI", url: "https://arxiv.org/rss/cs.AI", kind: "papers", about: "Artificial Intelligence — new submissions" },
  { id: "google", name: "Google Research", url: "https://research.google/blog/rss/", kind: "writing", about: "Google Research blog" },
  { id: "deepmind", name: "DeepMind", url: "https://deepmind.google/blog/rss.xml", kind: "writing", about: "Google DeepMind blog" },
  { id: "openai", name: "OpenAI", url: "https://openai.com/news/rss.xml", kind: "writing", about: "OpenAI news" },
  { id: "bair", name: "BAIR", url: "https://bair.berkeley.edu/blog/feed.xml", kind: "writing", about: "Berkeley AI Research blog" },
  { id: "gradient", name: "The Gradient", url: "https://thegradient.pub/rss/", kind: "writing", about: "Essays on machine learning" },
  { id: "lilian", name: "Lil'Log", url: "https://lilianweng.github.io/index.xml", kind: "writing", about: "Lilian Weng's notes" },
  { id: "simonw", name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", kind: "writing", about: "Daily notes on LLMs and tooling" },
];

export interface Item {
  title: string;
  link: string;
  /** ISO date, or empty when the feed did not give one. Never invented. */
  published: string;
  /** The author's own opening words, plain text, truncated. */
  summary: string;
  source: string;
  sourceName: string;
  kind: "papers" | "writing";
  /** Set when the item is an arXiv paper, so it can be read here. */
  arxivId?: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};

/** XML entities, including the numeric forms feeds use freely. */
export function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * Readable text out of a feed's description.
 *
 * Feeds carry HTML inside CDATA or escaped, sometimes both, and an item's description
 * can be a whole post. Entities are decoded *first* so an escaped `&lt;p&gt;` becomes a
 * tag and is then stripped — decode after stripping and the markup survives as
 * literal text in the middle of a sentence.
 */
export function plain(raw: string, limit = 320): string {
  let text = decode(raw.replace(/<!\[CDATA\[|\]\]>/g, ""));
  text = decode(text).replace(/<[^>]*>/g, " ");
  // arXiv prefixes every abstract with its own bookkeeping; the reader can see the
  // identifier on the item itself.
  text = text.replace(/^\s*arXiv:\S+\s+Announce Type:\s*\S+\s*/i, "");
  text = text.replace(/^\s*Abstract:\s*/i, "");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function tag(block: string, name: string): string {
  const found = block.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
  );
  return found ? found[1].trim() : "";
}

/** An Atom `<link href>` — preferring the one meant for humans. */
function atomLink(block: string): string {
  const alternate = block.match(
    /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i,
  );
  if (alternate) return alternate[1];
  const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return href ? href[1] : "";
}

/** An ISO date, or "" — a date this could not read is left empty, never guessed. */
export function when(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

/** Items from one feed document, RSS 2.0 or Atom. */
export function parseFeed(xml: string, source: Source): Item[] {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((match) => match[1]);

  return blocks.flatMap((block) => {
    const title = plain(tag(block, "title"), 200);
    const link = decode(tag(block, "link") || atomLink(block)).trim();
    if (!title || !link) return [];
    const summary = plain(
      tag(block, "description") || tag(block, "summary") || tag(block, "content"),
    );
    const published = when(
      tag(block, "pubDate") || tag(block, "published") || tag(block, "updated"),
    );
    const arxivId = readArxivId(link);
    return [
      {
        title,
        link,
        published,
        summary,
        source: source.id,
        sourceName: source.name,
        kind: source.kind,
        ...(arxivId ? { arxivId } : {}),
      },
    ];
  });
}

/** Newest first. Items with no date sort last rather than to 1970. */
export function newestFirst(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    if (!a.published && !b.published) return 0;
    if (!a.published) return 1;
    if (!b.published) return -1;
    return b.published.localeCompare(a.published);
  });
}
