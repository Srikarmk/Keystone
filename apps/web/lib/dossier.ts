export type ClaimStatus = "exact" | "rounded" | "mismatch" | "untraced";

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
}

export interface Dossier {
  id: string;
  title: string;
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
