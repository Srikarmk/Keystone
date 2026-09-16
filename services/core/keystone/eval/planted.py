"""Planting known defects into real tables to measure whether checks catch them.

Unit fixtures prove a check works on the table its author imagined. They cannot prove
it works on a real one, where headers span columns, labels are inconsistent, and half
the cells are prose. And a check that finds nothing across a corpus is indistinguishable
from a check that *can* find nothing — which is the failure mode most likely to ship
unnoticed.

So: take tables the suite currently reports as clean, introduce one defect of a known
kind and location, and require the suite to find exactly that. Recall is whether the
planted defect was reported; precision is whether anything else was.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, replace
from decimal import Decimal

from keystone.audit.numbers import Number
from keystone.graph.models import Finding, Paper, Table, TableCell


@dataclass(frozen=True, slots=True)
class Planted:
    """A defect introduced on purpose, and where it was put."""

    kind: str
    table_ordinal: int
    row: int
    column: int
    description: str
    expected_check: str

    def was_found(self, findings: list[Finding]) -> bool:
        """Whether a finding names the cell that was tampered with.

        Matched on the quoted value rather than on position, because that is what the
        reader is shown — a finding pointing at the right cell but quoting the wrong
        value has not really found it.
        """
        return any(
            f.check_id == self.expected_check and self.description.split("→")[-1].strip() in f.title
            for f in findings
        )


from keystone.audit.checks.tables import comparison_group

def plant_emphasis_error(
    table: Table, rng: random.Random, *, min_group: int = 3
) -> tuple[Table, Planted] | None:
    """Move a best-in-group marker onto a value that is not an extreme of that group.

    This is the real-world defect: a result is updated late in writing and the bolding
    is not moved with it, so the table goes on claiming a value is best when it is not.
    """
    for by_column in (True, False):
        for cell in _shuffled(
            [c for c in table.cells if c.is_emphasised and c.is_numeric], rng
        ):
            group = comparison_group(table, cell, by_column=by_column)
            if len(group) < min_group or all(c.is_emphasised for c in group):
                continue

            values = [c.number.value for c in group if c.number]
            if len(set(values)) < 3:
                continue  # no strictly-middle value exists to move the marker onto
            middle = [
                c for c in group
                if c.number
                and c.number.value not in (max(values), min(values))
                and not c.is_emphasised
            ]
            if not middle:
                continue

            target = rng.choice(middle)
            moved = tuple(
                replace(c, is_emphasised=False) if c is cell
                else replace(c, is_emphasised=True) if c is target
                else c
                for c in table.cells
            )
            assert target.number is not None
            return replace(table, cells=moved), Planted(
                kind="emphasis_moved",
                table_ordinal=table.ordinal,
                row=target.row,
                column=target.column,
                description=(
                    f"emphasis moved to mid-{'column' if by_column else 'row'} "
                    f"value → {target.number.raw}"
                ),
                expected_check="table.emphasis_not_best",
            )
    return None


def plant_aggregate_error(
    table: Table, rng: random.Random, checker
) -> tuple[Table, Planted] | None:
    """Corrupt one cell of a row that currently aggregates correctly.

    ``checker`` identifies rows the suite already reads as genuine aggregates, so the
    plant lands somewhere the check is meant to look rather than somewhere it was never
    going to look.
    """
    for row_index in _shuffled(sorted({c.row for c in table.cells}), rng):
        if not checker(table, row_index):
            continue
        candidates = [
            c for c in table.row(row_index) if c.is_numeric and c.number is not None
        ]
        if not candidates:
            continue

        target = rng.choice(candidates)
        assert target.number is not None
        # Large enough that no accumulation of rounding could explain it.
        corrupted_value = target.number.value * Decimal("1.4") + Decimal(1)
        corrupted = _retyped(target, corrupted_value)
        cells = tuple(corrupted if c is target else c for c in table.cells)
        return replace(table, cells=cells), Planted(
            kind="aggregate_corrupted",
            table_ordinal=table.ordinal,
            row=target.row,
            column=target.column,
            description=f"aggregate cell {target.number.raw} → {corrupted.raw}",
            expected_check="table.aggregate_mismatch",
        )
    return None


def _retyped(cell: TableCell, value: Decimal) -> TableCell:
    """Rewrite a cell's value while keeping how it was written."""
    assert cell.number is not None
    quantised = value.quantize(cell.number.quantum)
    raw = f"{quantised}%" if cell.number.is_percent else str(quantised)
    number = Number(
        value=quantised,
        raw=raw,
        start=0,
        end=len(raw),
        decimals=cell.number.decimals,
        quantum=cell.number.quantum,
        is_percent=cell.number.is_percent,
        unit=cell.number.unit,
    )
    return replace(cell, raw=raw, number=number)


def _shuffled(items: list, rng: random.Random) -> list:
    out = list(items)
    rng.shuffle(out)
    return out


def paper_with(paper: Paper, table: Table) -> Paper:
    """The same paper with one table swapped, so a plant is evaluated in context."""
    return replace(
        paper,
        tables=tuple(table if t.ordinal == table.ordinal else t for t in paper.tables),
    )
