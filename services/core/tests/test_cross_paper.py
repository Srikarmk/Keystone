"""Checking reported baselines against the papers they are attributed to.

Unit-level, with a stubbed resolver. The real check downloads the cited papers, and a
test that depends on nine arXiv fetches is a test that fails for reasons which have
nothing to do with the code.
"""

from __future__ import annotations

from decimal import Decimal

from keystone.audit.checks import cross_paper
from keystone.audit.numbers import find_numbers
from keystone.graph.models import Table, TableCell
from keystone.ingest.bibliography import Reference


def _cell(row: int, column: int, text: str, *, cites: tuple[str, ...] = (), header: str = "") -> TableCell:
    numbers = find_numbers(text, skip_years=False)
    return TableCell(
        row=row,
        column=column,
        raw=text,
        number=numbers[0] if len(numbers) == 1 else None,
        row_header=header,
        column_header="BLEU",
        cites=cites,
    )


def _comparison_table() -> Table:
    """A comparison table with one cited baseline row and one of the paper's own."""
    return Table(
        ordinal=0,
        caption="Results",
        cells=(
            _cell(0, 0, "Model"),
            _cell(0, 1, "BLEU"),
            _cell(1, 0, "Prior work", cites=("prior2020",), header="Prior work"),
            _cell(1, 1, "24.6", header="Prior work"),
            _cell(2, 0, "Ours", header="Ours"),
            _cell(2, 1, "28.4", header="Ours"),
        ),
    )


REFERENCES = [
    Reference(
        key="prior2020",
        raw="Prior work on translation",
        title="Prior work on translation",
        arxiv_id="1609.08144",
    )
]

# A cited paper has to state enough numbers for absence to mean anything.
SOURCE = {Decimal("24.6")} | {Decimal(f"{n}.{n}") for n in range(1, 20)}


def test_confirms_a_baseline_the_cited_paper_reports():
    checks = cross_paper.verify((_comparison_table(),), REFERENCES, lambda _id: SOURCE)
    assert [c.outcome for c in checks] == ["confirmed"]
    assert checks[0].value.raw == "24.6"
    assert not cross_paper.findings(checks)


def test_flags_a_baseline_the_cited_paper_does_not_report():
    changed = SOURCE - {Decimal("24.6")}
    checks = cross_paper.verify((_comparison_table(),), REFERENCES, lambda _id: changed)
    assert [c.outcome for c in checks] == ["not_found"]

    findings = cross_paper.findings(checks)
    assert len(findings) == 1
    assert "24.6" in findings[0].title
    assert findings[0].arithmetic["arxivId"] == "1609.08144"


def test_ignores_the_papers_own_rows():
    """Only cited rows are attributable; "Ours" belongs to the paper being read."""
    checks = cross_paper.verify((_comparison_table(),), REFERENCES, lambda _id: SOURCE)
    assert all(check.row != "Ours" for check in checks)


def test_says_nothing_when_the_cited_paper_cannot_be_read():
    """An unreadable source is not evidence of a discrepancy."""
    checks = cross_paper.verify((_comparison_table(),), REFERENCES, lambda _id: None)
    assert [c.outcome for c in checks] == ["unavailable"]
    assert not cross_paper.findings(checks)


def test_says_nothing_when_the_cited_paper_is_too_thin():
    """Absence from a paper stating three numbers concludes nothing."""
    checks = cross_paper.verify(
        (_comparison_table(),), REFERENCES, lambda _id: {Decimal("1.1")}
    )
    assert [c.outcome for c in checks] == ["unavailable"]
    assert not cross_paper.findings(checks)


def test_ignores_whole_numbers():
    """A bare integer coincides across unrelated papers far too often to mean anything."""
    table = Table(
        ordinal=0,
        caption="Results",
        cells=(
            _cell(1, 0, "Prior work", cites=("prior2020",), header="Prior work"),
            _cell(1, 1, "50", header="Prior work"),
        ),
    )
    assert not cross_paper.verify((table,), REFERENCES, lambda _id: SOURCE)


def test_says_nothing_when_a_row_cites_two_papers():
    """Two citations in a row make the attribution ambiguous, not checkable."""
    table = Table(
        ordinal=0,
        caption="Results",
        cells=(
            _cell(1, 0, "Prior work", cites=("prior2020", "other2019"), header="Prior"),
            _cell(1, 1, "24.6", header="Prior"),
        ),
    )
    assert not cross_paper.verify((table,), REFERENCES, lambda _id: SOURCE)


def test_caps_how_many_cited_papers_are_downloaded():
    fetched: list[str] = []

    def resolve(arxiv_id: str):
        fetched.append(arxiv_id)
        return SOURCE

    references = [
        Reference(key=f"k{i}", raw="", title=f"Paper {i}", arxiv_id=f"20{i:02d}.0000{i}")
        for i in range(8)
    ]
    table = Table(
        ordinal=0,
        caption="Results",
        cells=tuple(
            cell
            for i in range(8)
            for cell in (
                _cell(i, 0, f"Work {i}", cites=(f"k{i}",), header=f"Work {i}"),
                _cell(i, 1, f"2{i}.5", header=f"Work {i}"),
            )
        ),
    )

    cross_paper.verify((table,), references, resolve, max_sources=3)
    assert len(fetched) == 3
