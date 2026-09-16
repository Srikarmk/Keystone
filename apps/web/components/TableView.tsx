"use client";

/*
 * A paper's table, rendered from its own source.
 *
 * "Rests on Table 4" makes the reader go and find Table 4. Showing the table next to
 * the claim, with the cell that carries it lit up, is the difference between naming
 * evidence and producing it.
 *
 * The cells come from the LaTeX, so the values are what the author wrote rather than a
 * reading of rendered glyphs — and the two things a results table asserts beyond its
 * numbers survive: which cells the author emphasised, and which horizontal band each
 * row belongs to.
 */

import type { TableData } from "@/lib/dossier";

export interface TableViewProps {
  table: TableData;
  /** Row and column of the cell a claim traced to, highlighted in place. */
  focus?: { row: number; column: number } | null;
  compact?: boolean;
}

export function TableView({ table, focus, compact = false }: TableViewProps) {
  if (table.rows.length === 0) {
    return (
      <p className="text-[0.85rem] italic text-ink-faint">
        This table&rsquo;s cells could not be parsed from the source.
      </p>
    );
  }

  // The header is however many leading rows carry no standalone measurement — the
  // same rule the parser uses, so the two cannot disagree about where data starts.
  const headerRows = table.rows.findIndex((row) =>
    row.some((cell) => cell.value !== null),
  );
  const header = headerRows < 0 ? 1 : Math.max(headerRows, 1);

  return (
    <div className="overflow-x-auto">
      <table
        className={`w-full border-collapse ${compact ? "text-[0.72rem]" : "text-[0.78rem]"}`}
      >
        <tbody>
          {table.rows.map((row, r) => {
            const isHeader = r < header;
            // A band change is where the source had a rule. Drawing it keeps "best in
            // its band" legible, which is what the emphasis actually claims.
            const newBand = r > 0 && row[0]?.block !== table.rows[r - 1][0]?.block;

            return (
              <tr
                key={r}
                style={{
                  borderTop: newBand
                    ? "1px solid color-mix(in srgb, var(--color-ink) 22%, transparent)"
                    : undefined,
                }}
              >
                {row.map((cell, c) => {
                  const focused = focus?.row === r && focus?.column === c;
                  return (
                    <td
                      key={c}
                      className={`px-2 py-1 align-baseline ${
                        cell.value !== null ? "numeral text-right" : "text-left"
                      } ${isHeader ? "text-ink-soft" : "text-ink"}`}
                      style={{
                        fontWeight: cell.emphasised || isHeader ? 500 : 400,
                        background: focused
                          ? "color-mix(in srgb, var(--color-brass) 28%, transparent)"
                          : undefined,
                        boxShadow: focused
                          ? "inset 0 0 0 1px var(--color-brass)"
                          : undefined,
                        borderBottom: isHeader
                          ? "1px solid color-mix(in srgb, var(--color-ink) 16%, transparent)"
                          : undefined,
                        whiteSpace: "nowrap",
                      }}
                      title={cell.emphasised ? "emphasised in the source" : undefined}
                    >
                      {cell.text || (cell.value !== null ? cell.value : "")}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Locate a cell by its row and column labels, so a claim can point at it. */
export function findCell(
  table: TableData,
  rowLabel: string | null,
  cellText: string | null,
): { row: number; column: number } | null {
  if (!cellText) return null;
  const wanted = cellText.trim();

  for (let r = 0; r < table.rows.length; r += 1) {
    const row = table.rows[r];
    const labelMatches =
      !rowLabel || row.some((cell) => cell.text.trim() === rowLabel.trim());
    if (!labelMatches) continue;
    for (let c = 0; c < row.length; c += 1) {
      if (row[c].text.trim() === wanted) return { row: r, column: c };
    }
  }

  // Fall back to the value alone. A row label recovered from a spanning header does
  // not always appear verbatim in its own row, and pointing at the right number in
  // the wrong-looking row still beats pointing at nothing.
  for (let r = 0; r < table.rows.length; r += 1) {
    for (let c = 0; c < table.rows[r].length; c += 1) {
      if (table.rows[r][c].text.trim() === wanted) return { row: r, column: c };
    }
  }
  return null;
}
