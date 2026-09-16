"""Turning LaTeX tabular source into typed cells.

Reading tables from source rather than from rendered glyphs buys three things:

* **Exact numbers.** A numeric check compares against what the author wrote, not
  against an interpretation of a rendered table.
* **Structure.** Row and column positions are explicit in the markup, so a value is
  never silently attributed to the wrong column — the failure mode that makes
  layout-inferred tables untrustworthy.
* **Emphasis.** ``\\textbf`` in a results table is not decoration: it is the author
  asserting "best in this column". That makes it checkable. Recovering the same fact
  from a PDF would take font analysis.
"""

from __future__ import annotations

import re

from keystone.audit.numbers import find_numbers
from keystone.graph.models import Table, TableCell
from keystone.ingest.latex import TableSource, _match_brace_group, strip_markup

# Authors mark a winning result with any of these; several journals' templates define
# their own wrapper, so a custom macro ending in "best" is included too.
_EMPHASIS = re.compile(
    r"\\(?:textbf|bf|mathbf|boldmath|underline|uline|emph|textit|it|best|winner)\b"
    r"|\{\s*\\(?:bf|it|em)\b"
)

_MULTICOLUMN = re.compile(r"\\multicolumn\b")
_MULTIROW = re.compile(r"\\multirow\*?\b")

# Characters that may sit beside a measurement without changing what it is: grouping,
# significance markers, footnote daggers, the sign of a deviation.
_CELL_DECORATION = re.compile(r"[\s()\[\]{}±+*†‡§¶^,~$\\/|·-]")


def build_table(source: TableSource) -> Table:
    """Convert one parsed tabular into positioned, typed cells."""
    grid = [_expand_row(row) for row in source.rows]
    grid = [row for row in grid if any(text.strip() for text, _ in row)]
    if not grid:
        return Table(ordinal=source.ordinal, caption=source.caption,
                     label=source.labels[0] if source.labels else "")

    header_rows = _count_header_rows(grid)
    column_headers = _column_headers(grid, header_rows)
    metrics = _leaf_headers(grid, header_rows)

    blocks = _block_of_row(source.block_starts, len(grid))

    cells: list[TableCell] = []
    for r, row in enumerate(grid):
        row_header = _row_header(row)
        for c, (text, emphasised) in enumerate(row):
            plain = strip_markup(text).strip()
            if not plain:
                continue
            cells.append(
                TableCell(
                    row=r,
                    column=c,
                    raw=plain,
                    number=cell_number(plain),
                    row_header=row_header,
                    column_header=column_headers.get(c, ""),
                    metric=metrics.get(c, ""),
                    block=blocks[r],
                    is_emphasised=emphasised,
                )
            )

    return Table(
        ordinal=source.ordinal,
        caption=source.caption,
        label=source.labels[0] if source.labels else "",
        cells=tuple(cells),
    )


def build_tables(sources: list[TableSource]) -> tuple[Table, ...]:
    return tuple(build_table(s) for s in sources)


def _read_arguments(text: str, position: int) -> tuple[list[str], int]:
    """Read consecutive ``{...}`` and ``[...]`` arguments; return (brace bodies, end)."""
    bodies: list[str] = []
    while position < len(text):
        if text[position] == "{":
            group = _match_brace_group(text, position)
            if group is None:
                break
            body, position = group
            bodies.append(body)
        elif text[position] == "[":
            close = text.find("]", position)
            if close == -1:
                break
            position = close + 1
        elif text[position].isspace():
            position += 1
        else:
            break
    return bodies, position


def _unwrap_spanning(cell: str) -> tuple[str, int]:
    """Replace spanning wrappers with their content; return (content, columns spanned).

    ``\\multicolumn{5}{c}{Results}`` must yield "Results" spanning five columns, and
    ``\\multirow{4}{*}{conv2_x}`` must yield "conv2_x". Both take the *last* argument
    as content; keeping an earlier one leaves the column specification in the cell,
    where it reads as the number 5.
    """
    text, width = cell, 1
    for pattern, is_column_span in ((_MULTICOLUMN, True), (_MULTIROW, False)):
        while (match := pattern.search(text)) is not None:
            arguments, end = _read_arguments(text, match.end())
            if not arguments:
                break
            if is_column_span and arguments:
                width = max(width, _span_width(arguments[0]))
            text = text[: match.start()] + arguments[-1] + text[end:]
    return text, width


def _span_width(argument: str) -> int:
    try:
        return max(1, int(argument.strip()))
    except ValueError:
        return 1


def _expand_row(row: tuple[str, ...]) -> list[tuple[str, bool]]:
    """Expand ``\\multicolumn`` spans so column indices stay aligned across rows.

    Without this, a header spanning three columns shifts every cell to its right by
    two and each value is attributed to the wrong column — which would make every
    column-wise check silently wrong rather than visibly broken.
    """
    out: list[tuple[str, bool]] = []
    for cell in row:
        emphasised = bool(_EMPHASIS.search(cell))
        content, width = _unwrap_spanning(cell)
        out.append((content, emphasised))
        out.extend(("", False) for _ in range(width - 1))
    return out


def cell_number(text: str):
    """The measurement a cell states, or None if the cell is not a measurement.

    A cell must *be* a number, not merely contain one. "conv1" contains a 1 and
    "18-layer" contains an 18, and treating either as a measurement would put
    fabricated values into every column-wise comparison. Anything left over after
    removing the number and its decoration means the cell is a label.
    """
    numbers = find_numbers(text, skip_years=False)
    # One measurement per cell. Several means an interval, a mean with a deviation, or
    # a composite like "94.2 (0.3)" — worth parsing properly later, not guessing now.
    if len(numbers) != 1:
        return None
    found = numbers[0]
    residue = text[: found.start] + text[found.end :]
    return found if not _CELL_DECORATION.sub("", residue) else None


def _block_of_row(block_starts: tuple[int, ...], row_count: int) -> list[int]:
    """Map each row index to the band it belongs to."""
    boundaries = sorted(set(block_starts))
    return [sum(1 for b in boundaries if b <= r) for r in range(row_count)]


def _count_header_rows(grid: list[list[tuple[str, bool]]]) -> int:
    """How many leading rows are headers rather than data.

    A header row carries no standalone measurements. Counting them by that property
    handles the two-level headers common in benchmark tables without needing to parse
    the rule commands that visually separate them.
    """
    count = 0
    for row in grid[:3]:
        values = [strip_markup(text).strip() for text, _ in row]
        numeric = sum(1 for v in values if v and cell_number(v) is not None)
        filled = sum(1 for v in values if v)
        if filled and numeric / filled > 0.4:
            break
        count += 1
    return max(count, 1) if grid else 0


def _column_headers(grid: list[list[tuple[str, bool]]], header_rows: int) -> dict[int, str]:
    """Join multi-level headers per column, so "Ours / F1" reads as one label."""
    headers: dict[int, list[str]] = {}
    for row in grid[:header_rows]:
        for index, (text, _) in enumerate(row):
            plain = strip_markup(text).strip()
            if plain:
                headers.setdefault(index, []).append(plain)
    return {index: " ".join(parts) for index, parts in headers.items()}


def _leaf_headers(grid: list[list[tuple[str, bool]]], header_rows: int) -> dict[int, str]:
    """The innermost header level per column — what the column actually measures."""
    if not header_rows:
        return {}
    leaf = grid[header_rows - 1]
    return {
        index: strip_markup(text).strip()
        for index, (text, _) in enumerate(leaf)
        if strip_markup(text).strip()
    }


def _row_header(row: list[tuple[str, bool]]) -> str:
    for text, _ in row:
        plain = strip_markup(text).strip()
        if plain and cell_number(plain) is None:
            return plain
    return ""
