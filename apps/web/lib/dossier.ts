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

export interface Dossier {
  id: string;
  title: string;
  pdfUrl: string;
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
}

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
