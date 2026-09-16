export type ClaimStatus = "exact" | "rounded" | "mismatch" | "untraced";

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
  /** Where the claim is stated in the PDF; null when it could not be located. */
  anchor: AnchorJson | null;
  /** Where its evidence sits — the cell if it is unambiguous, else the caption. */
  evidenceAnchor: AnchorJson | null;
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
    unsupported: number;
    mismatched: number;
    rate: number;
  };
  claims: Claim[];
  tables: { name: string; caption: string; numericCells: number; supports: number }[];
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

export const isSupported = (status: ClaimStatus) => status === "exact" || status === "rounded";
