"""Checking a paper's reported baselines against the papers they came from.

Every other check in this suite interrogates a paper about itself, which is why they
are all silent on canonical, heavily-reviewed work: a good paper is internally
consistent. This one asks a different question — when paper B tabulates paper A's
result, does the number match what A actually reported? — and that can be wrong in a
paper where nothing else is.

The chain is exact rather than inferred at every step that matters. A comparison
table's row label *is* a citation in the source ("GNMT + RL \\cite{wu2016google}"), the
bibliography resolves that key to an arXiv identifier, and the cited paper's own
numbers come from its own LaTeX. No fuzzy matching of author names, no lookup service.

Confirmations are reported alongside discrepancies, on purpose. "Eight baseline
numbers checked against their source papers, eight confirmed" is the output this suite
has been missing — a statement about what was verified, rather than silence that is
indistinguishable from a broken audit.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from keystone.audit.numbers import Number, rounds_to
from keystone.graph.models import Confidence, Evidence, Finding, Severity, Table
from keystone.ingest.bibliography import Reference

Outcome = Literal["confirmed", "not_found", "unavailable"]

#: A value needs decimals to be distinctive. Whole numbers coincide across unrelated
#: papers constantly — a "50" in one paper's table and another's means nothing — and an
#: integer match would be evidence of arithmetic, not of provenance.
MIN_DECIMALS = 1

#: Below this, the cited paper has too little in it to conclude anything from absence.
MIN_SOURCE_NUMBERS = 12


@dataclass(frozen=True, slots=True)
class BaselineCheck:
    """One reported baseline, and whether the cited paper reports the same figure."""

    table: str
    row: str
    column: str
    value: Number
    citation_key: str
    arxiv_id: str | None
    cited_title: str
    outcome: Outcome
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "table": self.table,
            "row": self.row,
            "column": self.column,
            "value": self.value.raw,
            "citationKey": self.citation_key,
            "arxivId": self.arxiv_id,
            "citedTitle": self.cited_title,
            "outcome": self.outcome,
            "note": self.note,
        }


#: Given an arXiv id, return every number that paper states, or None if unreadable.
Resolver = Callable[[str], set[Decimal] | None]


def verify(
    tables: tuple[Table, ...],
    references: list[Reference],
    resolve: Resolver,
    max_sources: int = 12,
) -> list[BaselineCheck]:
    """Check every attributable baseline figure against its source paper.

    ``max_sources`` caps how many cited papers are downloaded. A paper can cite a
    hundred works, and fetching every one of them on every build is both slow and an
    unreasonable amount of traffic to send arXiv's way. Comparison tables concentrate
    in the first few tables anyway, so the cap costs little coverage.
    """
    by_key = {reference.key: reference for reference in references}
    checks: list[BaselineCheck] = []
    cache: dict[str, set[Decimal] | None] = {}

    for table in tables:
        for row_index in sorted({cell.row for cell in table.cells}):
            row = table.row(row_index)

            # Exactly one citation in the row, or the attribution is ambiguous and
            # there is no way to know which paper a figure is supposed to come from.
            keys = {key for cell in row for key in cell.cites}
            if len(keys) != 1:
                continue
            key = next(iter(keys))

            reference = by_key.get(key)
            if reference is None or reference.arxiv_id is None:
                continue

            if reference.arxiv_id not in cache:
                if len(cache) >= max_sources:
                    continue
                cache[reference.arxiv_id] = resolve(reference.arxiv_id)
            source = cache[reference.arxiv_id]

            label = next((c.raw for c in row if c.row_header), "") or next(
                (c.raw for c in row if not c.is_numeric), ""
            )

            for cell in row:
                if cell.number is None or cell.number.decimals < MIN_DECIMALS:
                    continue

                if source is None:
                    checks.append(
                        _check(table, label, cell, key, reference, "unavailable",
                               "the cited paper's source could not be read")
                    )
                    continue
                if len(source) < MIN_SOURCE_NUMBERS:
                    checks.append(
                        _check(table, label, cell, key, reference, "unavailable",
                               "the cited paper states too few numbers to conclude from")
                    )
                    continue

                present = any(_confirms(value, cell.number) for value in source)
                checks.append(
                    _check(
                        table, label, cell, key, reference,
                        "confirmed" if present else "not_found",
                        "" if present
                        else "this figure appears nowhere in the paper it is attributed to",
                    )
                )

    return checks


def _confirms(value: Decimal, reported: Number) -> bool:
    """Whether the cited paper's value agrees with the figure attributed to it.

    At the *reported* precision, not exactly. A paper tabulating someone else's result
    rounds it: VGG writes GoogLeNet's 6.67% as 6.7, and demanding equality reported
    that as a figure GoogLeNet "does not report". Writing 6.7 is a claim that the true
    value lies within 0.05 of it, which 6.67 satisfies.

    Both scales are tried because a percent sign often lives in the column header
    rather than the cell, so the cited paper's 0.0667 and this paper's 6.7 are one
    measurement written twice.
    """
    return rounds_to(value, reported) or rounds_to(value / 100, reported)


def _check(table, label, cell, key, reference, outcome, note) -> BaselineCheck:
    assert cell.number is not None
    return BaselineCheck(
        table=table.name,
        row=label,
        column=cell.column_header,
        value=cell.number,
        citation_key=key,
        arxiv_id=reference.arxiv_id,
        cited_title=reference.title or reference.raw[:90],
        outcome=outcome,
        note=note,
    )


def findings(checks: list[BaselineCheck]) -> list[Finding]:
    """Turn the discrepancies into findings. Confirmations are reported separately."""
    out: list[Finding] = []
    for check in checks:
        if check.outcome != "not_found":
            continue
        out.append(
            Finding(
                check_id="cross_paper.baseline_not_in_source",
                title=(
                    f"{check.table} attributes {check.value.raw} to "
                    f"{check.cited_title[:60]}, which does not report it"
                ),
                severity=Severity.MEDIUM,
                # Likely rather than certain: the cited paper may state the figure in a
                # form this cannot read, or the citing paper may have recomputed it on
                # a different split. The absence is a fact; the explanation is not.
                confidence=Confidence.LIKELY,
                evidence=(
                    Evidence(
                        description=(
                            f"{check.table}, row '{check.row}'"
                            f"{f', column {check.column}' if check.column else ''}"
                        ),
                        quote=check.value.raw,
                    ),
                    Evidence(
                        description=f"cited as arXiv:{check.arxiv_id}",
                        quote=check.cited_title,
                    ),
                ),
                arithmetic={
                    "reported": check.value.value,
                    "citation": check.citation_key,
                    "arxivId": check.arxiv_id,
                },
                explanation=(
                    f"{check.table} reports {check.value.raw} for "
                    f"'{check.row}', attributed to {check.citation_key}. That figure "
                    f"does not appear anywhere in arXiv:{check.arxiv_id} — not in its "
                    f"tables and not in its prose. It may have been recomputed, taken "
                    f"from a different split, or mis-copied."
                ),
            )
        )
    return out
