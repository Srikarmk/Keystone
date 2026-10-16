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

from keystone.audit.numbers import Number, find_numbers
from keystone.audit.trace import Coverage, Trace, mismatch_findings, trace_all
from keystone.ingest.tables import cell_number
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


# ------------------------------------------------ what may be set against a cell at all
#
# Both from the library's growth to 160 papers, and both pairings the tracer made
# before any row test was reached.


def _traced(sentence: str, raw_cell: str, column: str, row: str = "SNLI") -> str:
    """Trace the first number in `sentence` against a one-cell table; return its status."""
    number = find_numbers(sentence)[0]
    mention = NumericMention(number=number, sentence=sentence, section=SectionKind.ABSTRACT)
    cell = TableCell(
        row=1, column=1, raw=raw_cell, number=cell_number(raw_cell),
        row_header=row, column_header=column,
    )
    table = Table(ordinal=8, caption="SNLI entailment accuracy under triggers", cells=(cell,))
    return trace_all((mention,), (table,)).traces[0].status


def test_a_near_miss_on_the_same_scale_is_still_a_mismatch() -> None:
    """The control: without it the two below would pass by suppressing everything."""
    assert _traced("SNLI entailment accuracy is 89.94% before attack.", "90.31%", "Accuracy") == "mismatch"


def test_a_cell_under_a_percent_heading_is_read_as_a_percentage() -> None:
    """0.90 under "E %" is under one percent, not ninety (1908.07125, Table 8)."""
    assert _traced("SNLI entailment accuracy is 89.94% before attack.", "0.90", "E %") != "mismatch"


def test_a_bound_is_never_set_against_a_cell() -> None:
    """"Greater than 99%" holds for 99.6 and for 100 alike (1511.04834)."""
    assert _traced(
        "SNLI entailment accuracy is greater than 99.10% on most cases.", "99.40%", "Accuracy"
    ) != "mismatch"
    assert _traced("SNLI entailment accuracy is 99.10% on most cases.", "99.40%", "Accuracy") == "mismatch"
