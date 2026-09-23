export type ClaimStatus =
  | "configuration"
  | "exact"
  | "rounded"
  | "mismatch"
  | "declared_table"
  | "declared_figure"
  | "declared_equation"
  | "declared_theorem"
  | "declared_algorithm"
  | "citation"
  | "untraced";

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

export interface Claim {
  value: string;
  section: string;
  sentence: string;
  status: ClaimStatus;
  table: string | null;
  caption: string | null;
  row: string | null;
  column: string | null;
  cell: string | null;
  /** Which label the paper points at, when the evidence is declared rather than verified. */
  evidenceLabel: string | null;
  /** Where the claim is stated in the PDF; null when it could not be located. */
  anchor: AnchorJson | null;
  /** Where its evidence sits — the cell if it is unambiguous, else the caption. */
  evidenceAnchor: AnchorJson | null;
}

export interface TableCellData {
  text: string;
  value: string | null;
  emphasised: boolean;
  block: number;
}

export interface TableData {
  name: string;
  caption: string;
  label: string;
  numericCells: number;
  supports: number;
  rows: TableCellData[][];
  anchor: AnchorJson | null;
}

export interface EquationData {
  ordinal: number;
  latex: string;
  environment: string;
  labels: string[];
}

export interface SectionData {
  kind: string;
  title: string;
  chars: number;
  numbers: number;
  citations: number;
  /** Where the section begins on the page, so the outline can go there. */
  anchor?: AnchorJson | null;
}

export type NumberKind = "result" | "configuration" | "reference" | "structural";

/** One measurement from anywhere in the paper, traced the way a headline claim is. */
export interface IndexedNumber {
  value: string;
  kind: NumberKind;
  section: string;
  sentence: string;
  status: ClaimStatus | "configuration";
  table: string | null;
  row: string | null;
  cell: string | null;
  anchor: AnchorJson | null;
}

export interface Reference {
  key: string;
  raw: string;
  authors: string;
  title: string;
  venue: string;
  year: number | null;
  /** Present for references we could follow to check what they actually reported. */
  arxivId: string | null;
  doi: string | null;
}

export type BaselineOutcome = "confirmed" | "not_found" | "unavailable";

/** One figure a paper attributes to another paper, and whether that paper reports it. */
export interface BaselineCheck {
  table: string;
  row: string;
  column: string;
  value: string;
  citationKey: string;
  arxivId: string | null;
  citedTitle: string;
  outcome: BaselineOutcome;
  note: string;
}

/** What a paper does with a work it cites. Read off the prose, not inferred. */
export type Stance = "inherits" | "extends" | "contests" | "compares" | "background";

export interface LineageEdge {
  key: string;
  stance: Stance;
  /** The exact words in the paper that decided the stance. */
  cue: string;
  sentence: string;
  section: string;
  sectionKind: string;
  title: string;
  authors: string;
  year: number | null;
  arxivId: string | null;
  /** Whether the cited paper is in the library, so the edge can be walked. */
  inCorpus: boolean;
  anchor: AnchorJson | null;
}

export interface LineageTally {
  inherits: number;
  extends: number;
  contests: number;
  compares: number;
  background: number;
  traversable: number;
}

/** What sort of thing the paper is taking for granted. */
export type AssumptionKind =
  | "stated"
  | "simplifying"
  | "conventional"
  | "conjectural"
  | "conditional";

/**
 * What the paper offers for it, in the same sentence. Named for what is observable:
 * a citation in the sentence is a citation in the sentence, and whether it actually
 * establishes the assumption is a judgement the reader makes, not one we claim.
 */
export type AssumptionSupport = "cited" | "shown" | "bare";

export interface Assumption {
  sentence: string;
  anchorText: string;
  kind: AssumptionKind;
  support: AssumptionSupport;
  cue: string;
  section: string;
  sectionKind: string;
  cites: string[];
  refs: string[];
  anchor: AnchorJson | null;
}

/**
 * How often the cue readings are right, measured on a hand-labelled sample.
 *
 * Written by `keystone stance-eval` from the labels themselves, so the number on the
 * site cannot drift from the file it came from. The site's whole claim is that these
 * readings are checkable; how often they are correct belongs on the site.
 */
export interface Accuracy {
  labelled: number;
  heldOut: number;
  /** Accuracy on rows drawn *after* the rules were last changed. The honest figure. */
  heldOutAccuracy: number | null;
  /** 95% Wilson interval on that figure. Thirty rows cannot pin it down further. */
  heldOutInterval: [number, number];
  /** The metric published citation-intent work reports; accuracy flatters the
   * majority class, which is over half of every corpus in that literature. */
  macroF1: number;
  baselineMacroF1: number;
  accuracy: number;
  baselineAccuracy: number;
  majorityAccuracy: number;
  classes: Record<
    string,
    { gold: number; predicted: number; precision: number | null; recall: number | null }
  >;
  /** The same rules against labels written by other people, on papers outside the
   * library. Everything above describes rules measured on the corpus they were
   * written against; this is the only part that says how far they travel. */
  external?: External[];
}

/**
 * The cue rules scored against a public citation-intent corpus.
 *
 * `coverage` and `spokenPrecision` are the pair the site quotes. `macroF1` is what
 * published work reports, and it is included because leaving it out would be the
 * convenient choice: it punishes silence exactly as hard as error, and Keystone is
 * built to be silent, so the figure is low and says so.
 */
export interface External {
  corpus: string;
  instances: number;
  /** Share of citations a stance was reported for at all. */
  coverage: number;
  /** How many that is, in citations. `coverage` is this over `instances`. */
  spoken: number;
  /** How often those were right. Excludes the silent class by construction. */
  spokenPrecision: number;
  spokenInterval: [number, number];
  macroF1: number;
  /** The best macro-F1 reachable here: ACL-ARC has two classes Keystone cannot say. */
  macroF1Ceiling: number;
  unreachable: string[];
}

export interface LibraryGraph {
  nodes: {
    id: string;
    title: string;
    inherits: number;
    contests: number;
    bare: number;
  }[];
  edges: {
    from: string;
    to: string;
    stance: Stance;
    cue: string;
    sentence: string;
    section: string;
    anchor: AnchorJson | null;
  }[];
}

export interface Dossier {
  id: string;
  title: string;
  pdfUrl: string;
  /** What arXiv files this paper under. Absent for papers whose metadata failed. */
  arxiv?: ArxivRecord | null;
  /** The repository the paper itself names, if it names one. Never inferred. */
  codeUrl?: string;
  keystone: {
    table: string;
    caption: string;
    supported: number;
    share: number;
    summary: string;
  } | null;
  coverage: {
    claims: number;
    supported: number;
    declared: number;
    unsupported: number;
    mismatched: number;
    rate: number;
  };
  claims: Claim[];
  numbers: IndexedNumber[];
  references: Reference[];
  baselines: BaselineCheck[];
  tables: TableData[];
  equations: EquationData[];
  /** The paper's own \newcommand definitions, for rendering its notation. */
  macros: Record<string, string>;
  sections: SectionData[];
  lineage: {
    tally: LineageTally;
    /** The one work this paper would not stand without. */
    foundation: LineageEdge | null;
    edges: LineageEdge[];
  };
  assumptions: Assumption[];
  assumptionTally: { total: number; cited: number; shown: number; bare: number };
  findings: {
    check_id: string;
    title: string;
    severity: string;
    confidence: string;
    explanation: string;
    arithmetic: Record<string, unknown>;
  }[];
}

export interface IndexEntry {
  id: string;
  title: string;
  coverage: Dossier["coverage"];
  keystone: Dossier["keystone"];
  findings: number;
  /**
   * How much the paper has in it beyond its headline numbers. Four of nine papers
   * state no numbers up front, and without this the library row for one of them says
   * only "no numeric claims" — which reads as a failure rather than as a paper that
   * argues in prose and still has 58 references and 10 tables to look at.
   */
  density?: {
    numbers: number;
    tables: number;
    equations: number;
    references: number;
  };
  /** The paper's own full title, used to resolve citations across the library. */
  fullTitle?: string;
  lineage?: LineageTally;
  assumptions?: { total: number; cited: number; shown: number; bare: number };
  arxiv?: ArxivRecord | null;
}

/**
 * What arXiv says a paper is, as opposed to what this project infers about it.
 *
 * The library groups by `primary`, and the reason it is fetched rather than derived
 * is the same reason every quote is verbatim: "the authors filed this under cs.CL" is
 * checkable on the abstract page, and "this looks like an NLP paper" is my opinion.
 */
export interface ArxivRecord {
  /** Primary category code, e.g. "cs.CL". */
  primary: string;
  /** arXiv's own name for it, not an abbreviation of mine. */
  primaryName: string;
  /** Every category, primary first — most papers are cross-listed. */
  categories: string[];
  /** ISO date of version 1. */
  published: string;
  /** Who wrote it, in arXiv's order. */
  authors?: string[];
}

/** Papers with no fetched record, grouped under one honest heading. */
export const UNCATEGORISED = "uncategorised";

export function categoryOf(paper: IndexEntry): string {
  return paper.arxiv?.primary || UNCATEGORISED;
}

export function categoryLabel(paper: IndexEntry): string {
  return paper.arxiv?.primaryName || "Not yet categorised";
}

/** Inheriting a method makes the cited paper's correctness a precondition of yours. */
export const isLoadBearing = (stance: Stance) =>
  stance === "inherits" || stance === "extends";

export const STANCE_VERB: Record<Stance, string> = {
  inherits: "adopts",
  extends: "builds on",
  contests: "argues with",
  compares: "measures against",
  background: "mentions",
};

/** Verified by arithmetic: the number was found where it should be. */
export const isSupported = (status: ClaimStatus) =>
  status === "exact" || status === "rounded";

/**
 * The paper names its evidence, but of a kind no arithmetic can confirm — a figure, a
 * derivation, a theorem, another paper. Distinct from unsupported on purpose:
 * "evidenced by Figure 4" and "we could find nothing" are different answers, and
 * collapsing them made every theory and figure-driven result look unevidenced.
 */
export const isDeclared = (status: ClaimStatus) =>
  status.startsWith("declared_") || status === "citation";

const EVIDENCE_WORDS: Partial<Record<ClaimStatus, string>> = {
  declared_table: "a table",
  declared_figure: "a figure",
  declared_equation: "a derivation",
  declared_theorem: "a theorem",
  declared_algorithm: "an algorithm",
  citation: "another paper",
};

export const declaredAs = (status: ClaimStatus) => EVIDENCE_WORDS[status] ?? "evidence";
