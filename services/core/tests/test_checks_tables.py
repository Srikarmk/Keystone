"""Table consistency checks.

Every check is tested in both directions: it must fire on a defect, and — more
importantly — stay silent on correct data. A deterministic check that reports with
certainty is worse than a model's guess when its trigger condition is wrong, so the
negative cases below carry most of the weight. Each one exists because an earlier
version of the check got it wrong on a real paper.
"""

from __future__ import annotations

import keystone.audit.checks.tables  # noqa: F401  (registers the checks)
from keystone.audit.registry import run
from keystone.graph.models import Paper, Table, TableCell
from keystone.ingest.tables import cell_number


def _table(rows: list[list[str]], *, bold: set[tuple[int, int]] = frozenset()) -> Table:
    """Build a table from text rows; row 0 is the header, column 0 the row labels."""
    cells = []
    for r, row in enumerate(rows):
        for c, text in enumerate(row):
            if not text:
                continue
            cells.append(
                TableCell(
                    row=r,
                    column=c,
                    raw=text,
                    number=cell_number(text),
                    row_header=rows[r][0] if c else "",
                    column_header=rows[0][c] if r else "",
                    is_emphasised=(r, c) in bold,
                )
            )
    return Table(ordinal=0, caption="Results", cells=tuple(cells))


def _findings(table: Table, check_id: str) -> list:
    paper = Paper(id="test", tables=(table,))
    return [f for f in run(paper) if f.check_id == check_id]


# Different methods win different columns, which is how a real results table is
# marked. A fixture bolding one row end to end would only exercise the identity guard.
RESULTS = [
    ["Model", "Accuracy", "F1", "Error"],
    ["Baseline", "88.1", "86.0", "11.9"],
    ["Prior work", "91.4", "92.5", "8.6"],
    ["Ours", "94.2", "89.5", "5.8"],
    ["Ablation", "90.0", "88.0", "10.0"],
]
BEST_IN_EACH_COLUMN = {(3, 1), (2, 2), (3, 3)}


# --------------------------------------------------------------- emphasis


def test_flags_emphasis_on_a_middle_value():
    # The F1 marker is moved off 92.5 onto 88.0, which is mid-column.
    moved = (BEST_IN_EACH_COLUMN - {(2, 2)}) | {(4, 2)}
    found = _findings(_table(RESULTS, bold=moved), "table.emphasis_not_best")
    assert len(found) == 1
    assert "88.0" in found[0].title
    assert found[0].arithmetic["group_max"] == cell_number("92.5").value
    assert found[0].arithmetic["group_min"] == cell_number("86.0").value


def test_silent_when_emphasis_marks_the_best_in_each_column():
    # 94.2 is the highest accuracy and 5.8 the lowest error — best under each metric's
    # own polarity, which the check must accept without knowing the polarity.
    assert not _findings(_table(RESULTS, bold=BEST_IN_EACH_COLUMN), "table.emphasis_not_best")


def test_silent_when_emphasis_marks_the_authors_own_row():
    """Bolding a whole row says "this is us", not "this is best in every column"."""
    every_cell_of_ours = {(3, 0), (3, 1), (3, 2), (3, 3)}
    assert not _findings(_table(RESULTS, bold=every_cell_of_ours), "table.emphasis_not_best")


def test_reads_emphasis_across_a_row_when_that_is_how_the_table_reads():
    """Where variants are columns, bold marks the best across a row, not a column.

    Assuming column orientation on a table like this produced 31 confident findings
    on a table that was entirely correct.
    """
    rows = [
        ["Task", "Small", "Medium", "Large"],
        ["Winogender", "0.750", "0.721", "0.760"],
        ["CrowS Pairs", "0.448", "0.430", "0.410"],
        ["Truthful QA", "0.312", "0.220", "0.284"],
        ["Real Toxicity", "0.228", "0.229", "0.231"],
    ]
    best_in_each_row = {(1, 3), (2, 1), (3, 1), (4, 3)}
    assert not _findings(_table(rows, bold=best_in_each_row), "table.emphasis_not_best")

    # The same table with one marker moved to a middle value must be caught.
    moved = {(1, 3), (2, 1), (3, 3), (4, 3)}  # 0.284 is mid-row
    found = _findings(_table(rows, bold=moved), "table.emphasis_not_best")
    assert len(found) == 1 and "0.284" in found[0].title


def test_silent_when_emphasis_does_not_mean_best_at_all():
    """If too much emphasis is unexplained, the reading of it is wrong — say nothing."""
    scattered = {(1, 1), (2, 1), (1, 2), (2, 3), (4, 1), (4, 2)}
    assert not _findings(_table(RESULTS, bold=scattered), "table.emphasis_not_best")


def test_silent_when_too_few_cells_are_emphasised_to_infer_meaning():
    assert not _findings(_table(RESULTS, bold={(2, 1)}), "table.emphasis_not_best")


def test_silent_when_no_group_is_large_enough_to_judge():
    """An orientation that could judge nothing must not win by having no violations."""
    narrow = [["Model", "Score"], ["A", "88.1"], ["B", "91.4"], ["C", "94.2"]]
    # Each row holds a single value, so row orientation is unevaluable; column
    # orientation must be the one used.
    found = _findings(_table(narrow, bold={(1, 1), (2, 1), (3, 1)}), "table.emphasis_not_best")
    assert not found  # all three bolded: emphasis cannot mean "best"


# -------------------------------------------------------------- aggregates


TOTALS = [
    ["Split", "Train", "Test"],
    ["English", "100", "20"],
    ["French", "150", "30"],
    ["German", "250", "50"],
    ["Total", "500", "95"],  # Train is right; Test should be 100
]


def test_flags_a_total_that_does_not_match_its_parts():
    found = _findings(_table(TOTALS), "table.aggregate_mismatch")
    assert len(found) == 1
    assert found[0].arithmetic["stated"] == cell_number("95").value
    assert found[0].arithmetic["recomputed"] == cell_number("100").value
    # The premise is part of the finding: the row added up elsewhere.
    assert found[0].arithmetic["columns_that_agree"] >= 1


def test_silent_when_totals_are_correct():
    correct = [row[:] for row in TOTALS]
    correct[4] = ["Total", "500", "100"]
    assert not _findings(_table(correct), "table.aggregate_mismatch")


def test_silent_when_the_row_is_not_really_a_total_row():
    """A method named "weighted sum of the last four layers" is not a total.

    Substring matching on labels read "summarization" as a sum row and "avg pool" as
    an average row, producing high-severity findings on correct tables.
    """
    rows = [
        ["Method", "F1", "EM"],
        ["Last hidden", "94.9", "88.1"],
        ["Weighted sum of last four hidden", "95.9", "89.0"],
        ["Concat last four", "96.1", "89.5"],
        ["Summarization", "93.2", "87.0"],
    ]
    assert not _findings(_table(rows), "table.aggregate_mismatch")


def test_silent_when_a_total_row_matches_in_no_column():
    """Adding up nowhere means the row was misread, not that every column is wrong."""
    rows = [
        ["Dataset", "Nodes", "Edges"],
        ["MUTAG", "17.9", "19.8"],
        ["PROTEINS", "39.1", "72.8"],
        ["NCI1", "29.8", "32.3"],
        ["Average degree", "2.2", "2.1"],  # a statistic, not a column aggregate
    ]
    assert not _findings(_table(rows), "table.aggregate_mismatch")


def test_tolerates_rounding_in_the_parts():
    """Summing values that were each rounded for display must not be a finding."""
    rows = [
        ["Split", "Share"],
        ["A", "33.3"],
        ["B", "33.3"],
        ["C", "33.3"],
        ["Total", "100.0"],  # parts sum to 99.9; each is rounded to one decimal
    ]
    assert not _findings(_table(rows), "table.aggregate_mismatch")
