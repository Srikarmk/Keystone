"""A mismatch must name the cell it accuses.

`reporting.headline_table_mismatch` is the strongest statement this project makes
about a paper: that a number in the abstract is not the number the paper's own table
carries. It is published at high severity and likely confidence, so it has to be right
far more often than not.

What separates a real one from a coincidence is the row header. With a row, the finding
names a cell and a reader can go and look — EfficientNet's introduction says 76.3% for
ResNet-50 where its Table 3 says 76.0%, and that is checkable in ten seconds. Without
one, the claim is only that *some* value under a similarly-named column differs, which
in a multi-row table is what you would expect even when the paper is entirely correct.

Measured when the library went from 74 papers to 101: seven mismatches, two with a row
and five without. Both with a row were real; all five without were a headline number
paired against another configuration's row — Megatron-LM's 76% scaling efficiency
against a 77% cell, MBPP's 59.6% few-shot result against a 59.0% cell for a different
model size.
"""

from __future__ import annotations

from decimal import Decimal

from keystone.audit.numbers import Number
from keystone.audit.trace import Coverage, Trace, mismatch_findings
from keystone.graph.models import NumericMention, SectionKind, Table, TableCell


def _mismatch(row_header: str) -> Coverage:
    """One headline number against one table cell, differing beyond rounding."""
    def percent(text: str) -> Number:
        return Number(
            value=Decimal(text),
            raw=f"{text}%",
            start=0,
            end=len(text) + 1,
            decimals=0,
            quantum=Decimal("1"),
            is_percent=True,
        )

    cell = TableCell(
        row=1,
        column=1,
        raw="77",
        number=percent("77"),
        row_header=row_header,
        column_header="Scaling Efficiency",
    )
    table = Table(ordinal=6, caption="Scaling", cells=(cell,))
    mention = NumericMention(
        number=percent("76"),
        sentence="We sustain 76% scaling efficiency across the application.",
        section=SectionKind.ABSTRACT,
    )
    return Coverage(
        traces=(
            Trace(
                mention=mention,
                status="mismatch",
                table=table,
                cell=cell,
                context_score=2,
            ),
        ),
        keystone=None,
    )


def test_a_mismatch_with_a_named_row_is_reported() -> None:
    findings = mismatch_findings(_mismatch("ResNet-50"))
    assert len(findings) == 1
    assert findings[0].arithmetic["row"] == "ResNet-50"


def test_a_mismatch_with_no_row_is_not_reported() -> None:
    """The five false accusations that arrived with the library's expansion."""
    assert mismatch_findings(_mismatch("")) == []


def test_a_whitespace_row_is_no_row() -> None:
    assert mismatch_findings(_mismatch("   ")) == []
