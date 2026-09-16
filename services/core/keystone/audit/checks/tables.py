"""Checks over what a results table asserts internally.

These need no semantic understanding of the paper and no model. They exploit the fact
that a table makes claims beyond its numbers — that a bolded cell is the best in its
column, that a row labelled "Average" is the average of the rows above it — and those
claims are arithmetic, so they can simply be checked.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from decimal import Decimal

from keystone.audit.registry import check
from keystone.graph.models import (
    Confidence,
    Evidence,
    Finding,
    Paper,
    Severity,
    Table,
    TableCell,
)

# A group needs enough values for "best" to mean anything. With two, every value is
# either the maximum or the minimum and the check can never fire.
_MIN_GROUP_VALUES = 3

# Captions that state outright what emphasis means. Direct evidence beats inference,
# and papers say this far more often than one would expect.
_BOLD_MEANS_BEST = re.compile(
    r"(?:bold|boldface|underlin)\w*[^.]{0,80}?"
    r"(?:best|highest|lowest|top|strongest|winning)"
    r"|(?:best|highest|lowest|top|strongest|winning)[^.]{0,80}?"
    r"(?:bold|boldface|underlin)\w*",
    re.IGNORECASE | re.DOTALL,
)

# Captions that state a convention emphasis *other* than strict best, which
# disqualifies the check outright.
#
# This is the premise the check was missing, and a four-fold corpus expansion found it
# immediately: CLIP's Table 10 produced 57 findings, every one of them false, and the
# caption explains why in its own words — "Scores within the 99.5% Clopper-Pearson
# confidence interval of each dataset's best score are highlighted". The paper bolds
# statistical *ties*, so a highlighted value that is not the single extreme of its
# group is exactly what the convention calls for.
#
# Marking the authors' own method is the other common convention. Either way the
# arithmetic the check performs is answering a question the table never asked.
# `.` rather than `[^.]` for the gaps: excluding full stops to avoid crossing a
# sentence boundary also excluded decimal points, and the caption that motivated the
# whole pattern reads "within the 99.5% Clopper-Pearson confidence interval" — the
# dot inside the number blocked the match. The cue phrases are specific enough that
# spanning a sentence is the lesser risk.
_OTHER_CONVENTION = re.compile(
    r"within\s+(?:the\s+)?.{0,48}?(?:confidence\s+interval|standard\s+(?:deviation|error))"
    r"|statistically\s+(?:indistinguishable|insignificant|tied|equivalent|similar)"
    r"|not\s+(?:statistically\s+)?significantly\s+(?:different|worse|better)"
    r"|(?:bold|boldface|underlin)\w*.{0,60}?(?:our|ours|proposed|this\s+work)\b"
    r"|(?:our|ours|proposed).{0,60}?(?:is|are)\s+(?:shown\s+)?in\s+bold"
    r"|(?:bold|boldface|underlin)\w*.{0,60}?\bties?\b",
    re.IGNORECASE | re.DOTALL,
)

# Share of emphasis the winning interpretation may leave unexplained before the
# interpretation itself is treated as wrong. One violation is always allowed, since a
# single slip among otherwise consistent markers is the case the check exists for.
_MAX_UNEXPLAINED = 0.25

# Markers the winning interpretation must positively explain. Without this, a table
# with two consistent markers and one violation would report on the strength of very
# little evidence about what emphasis means here.
_MIN_EXPLAINED = 2

# Matched against the *whole* label, never as a substring. Substring matching reads
# "summarization" as a sum row, "avg pool" as an average row, and "small" as an all
# row — which is how a check that cannot be wrong ends up confidently wrong.
_AGGREGATE_LABEL = re.compile(
    r"^(?:(?:macro|micro|weighted|grand|column|row)[\s-]*)?"
    r"(?P<kind>total|sum|overall|average|avg|mean)\.?$",
    re.IGNORECASE,
)
_SUM_KINDS = {"total", "sum", "overall"}


# RETIRED — not registered, kept for its arithmetic and its unit tests.
#
# Growing the corpus from 9 papers to 35 was the test this check never had, and it
# failed it: 69 findings, none of them verifiable as real.
#
#   * 57 came from one CLIP table whose caption says outright that it highlights
#     "Scores within the 99.5% Clopper-Pearson confidence interval of each dataset's
#     best score" — statistical ties, not the single best. `_declares_other_convention`
#     now detects that class and drops those tables, which removed 56 of the 69.
#   * The remaining 13 are spread over six papers and cannot be dismissed *or*
#     confirmed without reading each one. Several captions declare a best scoped to a
#     group ("we bold the best task-specific and task-agnostic metrics") or bold by
#     absolute magnitude in a column whose values straddle zero. In each case the
#     premise is a convention the check has no way to establish.
#
# The rule it applies is sound — a cell that is neither the largest nor the smallest
# of its group cannot be best under either polarity — but soundness is not the
# problem. The premise is, and on nine hand-picked papers it happened to hold. A check
# whose findings cannot be vouched for must not ship: the suite's precision is the
# product's entire claim, and one confident false finding on a correct table costs
# more trust than every missed one costs coverage.
#
# Re-registering it needs the convention to be *stated* rather than inferred, and
# stated conventions turn out to be group-scoped often enough that "declared" is not
# sufficient either. That is a research problem, not a tuning problem.
def emphasis_not_best(paper: Paper) -> Iterator[Finding]:
    """Bolding a result asserts it is the best; that assertion is checkable.

    Two things are deliberately *not* assumed.

    **Direction.** Whether a column is an accuracy (higher is better) or an error rate
    (lower is better) never has to be known: under either reading the best value is an
    extreme of its group. A highlighted value strictly between the largest and smallest
    is wrong either way, so the check never produces a finding that depends on having
    guessed the metric's polarity.

    **Orientation.** Tables come both ways. Where methods are rows and metrics are
    columns, bold marks the best down a column; where model variants are columns, it
    marks the best across a row. Assuming one produced 31 confident findings on a
    single correct table. So both are tested, the better-fitting one is used, and if
    neither explains most of the emphasis then bold does not mean "best" in this table
    at all — it may mark the authors' own method, or a group heading — and the check
    says nothing.
    """
    yield from _emphasis_findings(paper)


def _emphasis_findings(paper: Paper) -> Iterator[Finding]:
    """Infer what emphasis means, then apply it per cell.

    Three designs were measured against deliberately planted errors before this one,
    and each failure says something about the problem:

    * **Per table, per table premise** caught 14%. One table usually carries only one
      or two usable markers, because the authors' own row is bolded end to end and is
      excluded as identity. That is far too little to establish a convention.
    * **One orientation for the whole paper** produced a false positive on ResNet,
      which genuinely contains both row-compared and column-compared tables. There is
      no single orientation to choose.
    * **Per table orientation, paper-wide premise** let a table that explained none of
      its own markers contribute nothing but violations, dragging the premise down and
      silencing real findings elsewhere.

    What holds: orientation is a property of a table, the convention is a property of
    the paper, and evidence may only be pooled between tables that *read the same way*.
    """
    readings: dict[str, list[tuple[Table, list, list]]] = {"column": [], "row": []}

    for table in paper.tables:
        # Dropped before it can contribute anything, findings *or* evidence: a table
        # that bolds statistical ties would drag the pooled premise down as well as
        # producing violations of a rule it never claimed to follow.
        if _declares_other_convention(table):
            continue

        highlighted = [
            c for c in table.cells
            if c.is_emphasised and c.is_numeric and not _marks_identity(table, c)
        ]
        if not highlighted:
            continue

        best: tuple[int, str, list, list] | None = None
        for orientation, by_column in (("column", True), ("row", False)):
            violations, evaluable = _violations(table, highlighted, by_column=by_column)
            # An orientation that could judge nothing has explained nothing, and must
            # not win by vacuously having no violations.
            if not evaluable:
                continue
            score = len(evaluable) - len(violations)
            if best is None or score > best[0]:
                best = (score, orientation, violations, evaluable)

        if best is not None:
            _score, orientation, violations, evaluable = best
            readings[orientation].append((table, violations, evaluable))

    for orientation, tables in readings.items():
        evaluated = sum(len(e) for _t, _v, e in tables)
        violated = sum(len(v) for _t, v, _e in tables)
        if not evaluated or not violated:
            continue

        # Without a statement of the convention it has to be inferred, and inference
        # needs the markers to be mostly consistent.
        explained = evaluated - violated
        inferred = (
            explained >= _MIN_EXPLAINED
            and violated <= max(1, _MAX_UNEXPLAINED * evaluated)
        )

        for table, violations, _evaluable in tables:
            # Scoped to the table that says it. A paper stating "highlighted in bold
            # in Table 5" has told you about Table 5 and nothing else; reading it as a
            # paper-wide licence bypassed the premise everywhere and produced three
            # confident false positives on a correct paper.
            declared = _declares_emphasis_means_best(table)
            if not (inferred or declared):
                continue
            for cell, group in violations:
                yield _emphasis_finding(
                    table, cell, group, orientation, explained, evaluated, declared
                )


def _declares_other_convention(table: Table) -> bool:
    """Whether the caption says emphasis means something other than strict best.

    A disqualifier rather than a signal: where this fires, the check's whole premise
    is contradicted by the paper itself, and inference must not be allowed to override
    a stated convention.
    """
    return bool(table.caption and _OTHER_CONVENTION.search(table.caption))


def _declares_emphasis_means_best(table: Table) -> bool:
    """Whether this table's own caption says that emphasis marks the best result.

    Direct evidence, and it matters most exactly where inference fails: in a paper
    whose only other bold cells are its own method's row there is nothing to infer a
    convention from, but the caption often simply states it.
    """
    return bool(table.caption and _BOLD_MEANS_BEST.search(table.caption))


def _emphasis_finding(
    table: Table,
    cell: TableCell,
    group: tuple[TableCell, ...],
    orientation: str,
    explained: int,
    evaluated: int,
    declared: bool,
) -> Finding:
    assert cell.number is not None
    values = [c.number.value for c in group if c.number]
    where = (
        _describe_column(cell) if orientation == "column"
        else (cell.row_header or f"row {cell.row}")
    )
    basis = (
        "the caption states that emphasis marks the best result"
        if declared
        else f"emphasis elsewhere in this paper marks the best in {orientation} "
             f"in {explained} of {evaluated} checkable cases"
    )
    return Finding(
        check_id="table.emphasis_not_best",
        title=(
            f"{table.name}: highlighted {cell.number.raw} is not the best "
            f"in its {orientation}"
        ),
        severity=Severity.MEDIUM,
        confidence=Confidence.CERTAIN,
        evidence=(
            Evidence(
                description=(
                    f"{table.name}, {orientation} {where}, "
                    f"row {cell.row_header or cell.row}"
                ),
                quote=cell.raw,
                anchor=cell.anchor,
            ),
        ),
        arithmetic={
            "highlighted": cell.number.value,
            "group_max": max(values),
            "group_min": min(values),
            "group_values": values,
            "orientation": orientation,
            "emphasis_explained": explained,
            "emphasis_checked": evaluated,
            "declared_in_caption": declared,
        },
        explanation=(
            f"The cell is highlighted, which reads as best in {orientation}, but "
            f"{cell.number.raw} lies strictly between that {orientation}'s minimum "
            f"({min(values)}) and maximum ({max(values)}). It is not the best whether "
            f"the metric is better high or better low. Basis: {basis}."
        ),
    )


def _violations(
    table: Table, highlighted: list[TableCell], *, by_column: bool
) -> tuple[
    list[tuple[TableCell, tuple[TableCell, ...]]], list[TableCell]
]:
    """Emphasised cells that are not an extreme of their group, and those judged.

    The second list matters as much as the first: an orientation under which nothing
    could be judged has produced no evidence, and must not be mistaken for one under
    which everything checked out.
    """
    out: list[tuple[TableCell, tuple[TableCell, ...]]] = []
    evaluable: list[TableCell] = []
    for cell in highlighted:
        group = comparison_group(table, cell, by_column=by_column)
        if len(group) < _MIN_GROUP_VALUES:
            continue
        # If everything in the group is emphasised, emphasis distinguishes nothing and
        # cannot be read as a claim about which value is best.
        if all(c.is_emphasised for c in group):
            continue
        evaluable.append(cell)
        values = [c.number.value for c in group if c.number]
        assert cell.number is not None
        if cell.number.value not in (max(values), min(values)):
            out.append((cell, group))
    return out, evaluable


def comparison_group(
    table: Table, cell: TableCell, *, by_column: bool
) -> tuple[TableCell, ...]:
    """The cells a "best" marker claims to beat.

    Down a column, that is the cells in the same band: a marker claims to be best of
    the rows it is grouped with, not of every row the column happens to contain.

    Across a row it depends on what the columns are. Where the innermost headers
    *repeat* — "XL, 6b, 175b" under each of four model families — the repeats mark
    like quantities, and a row comparison must be made within one of them. Where they
    do not repeat, the whole row is one comparison. Without this distinction, a row
    holding mAP@.5 and mAP@[.5,.95] for two datasets gets compared end to end, and the
    smaller metric is reported as failing to be the best — which is how this check
    produced a confident false positive on ResNet.
    """
    if by_column:
        cells = table.column_block(cell.column, cell.block)
    else:
        row = table.row(cell.row)
        metrics = [c.metric for c in row if c.is_numeric and c.metric]
        repeats = len(metrics) > len(set(metrics))
        cells = (
            tuple(c for c in row if c.metric == cell.metric) if repeats and cell.metric
            else row
        )
    return tuple(c for c in cells if c.is_numeric)


def _marks_identity(table: Table, cell: TableCell) -> bool:
    """Whether emphasis means "this is our method" rather than "this is best".

    Authors routinely bold their own row end to end. Every cell in such a row is
    highlighted regardless of how it performed, so reading those as best-in-column
    claims would produce a finding on every metric the paper did not win.
    """
    row = [c for c in table.row(cell.row) if c.is_numeric]
    return len(row) > 1 and all(c.is_emphasised for c in row)


@check(
    "table.aggregate_mismatch",
    "Total or average row does not match its parts",
    description=(
        "A row labelled Total, Sum or Average is an arithmetic claim about the cells "
        "it summarises, and can be recomputed."
    ),
)
def aggregate_mismatch(paper: Paper) -> Iterator[Finding]:
    """Recompute rows that claim to summarise the rows above them.

    The hard part is not the arithmetic, it is knowing that a row really is an
    aggregate. Two guards do that work, and both exist because their absence produced
    confident nonsense on real papers:

    * the label must match in full, so a method named "weighted sum of the last four
      hidden layers" is not read as a total;
    * the row must aggregate *correctly* in at least one other column before any
      mismatch is reported. A genuine total row adds up in most of its columns and
      fails in the one that is wrong. A row that adds up in none of them is not a
      total row at all, and the right response is silence rather than a finding for
      every column.
    """
    for table in paper.tables:
        for row_index in sorted({c.row for c in table.cells}):
            label = _row_label(table, row_index)
            match = _AGGREGATE_LABEL.match(label.strip())
            if match is None:
                continue
            kind = "sum" if match.group("kind").lower() in _SUM_KINDS else "mean"
            yield from _check_aggregate(table, row_index, label, kind)


def _check_aggregate(
    table: Table, row_index: int, label: str, kind: str
) -> Iterator[Finding]:
    agreements = 0
    candidates: list[tuple[TableCell, Decimal, list[Decimal], Decimal]] = []

    for column in table.column_indices:
        stated = next(
            (c for c in table.column(column) if c.row == row_index and c.is_numeric), None
        )
        if stated is None or stated.number is None:
            continue

        parts = [
            c for c in table.column(column)
            if c.row != row_index and c.is_numeric and not _is_aggregate_row(table, c.row)
        ]
        if len(parts) < 2:
            continue

        values = [c.number.value for c in parts if c.number]
        expected = sum(values) if kind == "sum" else sum(values) / Decimal(len(values))

        # Each part is itself a rounded report, so the aggregate inherits their
        # uncertainty. Comparing against the stated value's tolerance alone would flag
        # correctly-computed totals whose parts were rounded for display.
        accumulated = sum((c.number.tolerance for c in parts if c.number), Decimal(0))
        if kind == "mean":
            accumulated /= Decimal(len(values))
        slack = stated.number.tolerance + accumulated

        if abs(expected - stated.number.as_fraction) <= slack:
            agreements += 1
        else:
            candidates.append((stated, expected, values, slack))

    # The premise has to hold before the conclusion is worth stating.
    if not agreements:
        return

    for stated, expected, values, slack in candidates:
        assert stated.number is not None
        yield Finding(
            check_id="table.aggregate_mismatch",
            title=(
                f"{table.name}: '{label.strip()}' row states {stated.number.raw}, "
                f"parts give {_round_like(expected, stated)}"
            ),
            severity=Severity.HIGH,
            confidence=Confidence.CERTAIN,
            evidence=(
                Evidence(
                    description=f"{table.name}, column {_describe_column(stated)}",
                    quote=stated.raw,
                    anchor=stated.anchor,
                ),
            ),
            arithmetic={
                "operation": kind,
                "stated": stated.number.value,
                "recomputed": _round_like(expected, stated),
                "parts": values,
                "tolerance": slack,
                "columns_that_agree": agreements,
            },
            explanation=(
                f"The {kind} of the {len(values)} values in this column is "
                f"{_round_like(expected, stated)}, but the row states "
                f"{stated.number.raw}. The same row aggregates correctly in "
                f"{agreements} other column(s), so the row is a genuine "
                f"{kind} row."
            ),
        )


def _is_aggregate_row(table: Table, row_index: int) -> bool:
    return _AGGREGATE_LABEL.match(_row_label(table, row_index).strip()) is not None


def _row_label(table: Table, row_index: int) -> str:
    for cell in table.row(row_index):
        if cell.row_header:
            return cell.row_header
    return ""


def _describe_column(cell: TableCell) -> str:
    return f"'{cell.column_header}'" if cell.column_header else str(cell.column)


def _round_like(value: Decimal, reported: TableCell) -> Decimal:
    assert reported.number is not None
    return value.quantize(reported.number.quantum)
