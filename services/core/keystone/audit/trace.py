"""Tracing the numbers a paper asserts back to the evidence that supports them.

This is the analysis the product is named after. A paper's abstract, introduction and
conclusion are where it makes its case; its tables are where the case is evidenced.
Joining the two gives three things, none of which needs a model:

* **Coverage** — how many of the paper's headline numbers can be tied to a table cell,
  and which cannot. Stating what was *not* verified is only possible for a tool that
  verifies, and it is the honest half of any audit.
* **The keystone** — the table the most headline claims rest on. Every paper has one,
  whether or not it contains an error, which is what makes it something to show a
  reader on every paper rather than only on a flawed one.
* **Mismatches** — a headline number that is close to a table cell but not equal to it,
  in a context that ties the two together. The classic late-edit defect: the table was
  updated and the abstract was not.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from keystone.audit.numbers import (
    CONFIG_UNITS,
    Number,
    find_numbers,
    rounds_to,
    same_quantity,
)
from keystone.graph.models import (
    Confidence,
    Evidence,
    Finding,
    NumericMention,
    Paper,
    Section,
    SectionKind,
    Severity,
    Table,
    TableCell,
)

TraceStatus = Literal["exact", "rounded", "mismatch", "untraced"]

# A headline number this far from a cell, in a linked context, reads as the same
# measurement recorded twice and updated once. Nearer than the lower bound and it is
# rounding; further than the upper and the two are simply different numbers.
_MISMATCH_MIN_RELATIVE = Decimal("0.0005")
_MISMATCH_MAX_RELATIVE = Decimal("0.05")

# Distinctive terms a sentence and a table must share before a near-match between them
# is treated as being about the same measurement. One shared word paired "73.4" in a
# sentence about FLAN and T0 with a "74" sitting in an unrelated percentile column.
_MISMATCH_MIN_CONTEXT = 2

# Tokens too common to tie a sentence to a table. Without this, "the" and "on" link
# every sentence to every table and the context test stops meaning anything.
_STOPWORDS = frozenset("""
the a an and or but of in on for to with from by at as is are was were be been being
we our us it its this that these those than then so such can may might will would
show shows shown report reports reported use uses used using also more most other
results result model models method methods dataset datasets test train set sets
performance accuracy score scores table figure section all both each new best
""".split())

_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9+/\-]{2,}")


@dataclass(frozen=True, slots=True)
class Trace:
    """One headline number, and the evidence it does or does not rest on."""

    mention: NumericMention
    status: TraceStatus
    table: Table | None = None
    cell: TableCell | None = None
    context_score: int = 0

    @property
    def is_supported(self) -> bool:
        return self.status in ("exact", "rounded")


@dataclass(frozen=True, slots=True)
class Keystone:
    """The table the most headline claims rest on."""

    table: Table
    supported: int
    share: float

    @property
    def summary(self) -> str:
        return (
            f"{self.supported} of the paper's headline numbers trace to "
            f"{self.table.name}"
        )


@dataclass(frozen=True, slots=True)
class Coverage:
    """What could and could not be tied to evidence."""

    traces: tuple[Trace, ...]
    keystone: Keystone | None

    @property
    def claims(self) -> tuple[Trace, ...]:
        return tuple(t for t in self.traces if _is_claim_like(t.mention.number))

    @property
    def supported(self) -> tuple[Trace, ...]:
        return tuple(t for t in self.claims if t.is_supported)

    @property
    def unsupported(self) -> tuple[Trace, ...]:
        return tuple(t for t in self.claims if t.status == "untraced")

    @property
    def mismatched(self) -> tuple[Trace, ...]:
        return tuple(t for t in self.claims if t.status == "mismatch")

    @property
    def rate(self) -> float:
        return len(self.supported) / len(self.claims) if self.claims else 0.0


def headline_mentions(sections: tuple[Section, ...]) -> tuple[NumericMention, ...]:
    """Every number stated in the sections where a paper makes its case."""
    from keystone.ingest.latex import split_sentences

    out: list[NumericMention] = []
    for section in sections:
        if not section.kind.is_headline:
            continue
        for sentence in split_sentences(section.text):
            for number in find_numbers(sentence):
                out.append(
                    NumericMention(number=number, sentence=sentence.strip(), section=section.kind)
                )
    return tuple(out)


def trace_all(mentions: tuple[NumericMention, ...], tables: tuple[Table, ...]) -> Coverage:
    """Tie each headline number to a table cell, or record that it could not be."""
    traces = tuple(_trace_one(m, tables) for m in mentions)
    traces = _drop_accounted_mismatches(traces)

    counts = Counter(
        t.table.ordinal for t in traces
        if t.is_supported and t.table is not None and _is_claim_like(t.mention.number)
    )
    keystone = None
    if counts:
        ordinal, supported = counts.most_common(1)[0]
        table = next(t for t in tables if t.ordinal == ordinal)
        total = max(1, sum(1 for t in traces if _is_claim_like(t.mention.number)))
        keystone = Keystone(table=table, supported=supported, share=supported / total)

    return Coverage(traces=traces, keystone=keystone)


def mismatch_findings(coverage: Coverage) -> list[Finding]:
    """Headline numbers that nearly, but do not, match the cell they refer to."""
    findings: list[Finding] = []
    for trace in coverage.mismatched:
        assert trace.cell is not None and trace.table is not None and trace.cell.number is not None
        stated = trace.mention.number
        found = trace.cell.number
        delta = abs(stated.as_fraction - found.as_fraction)

        findings.append(
            Finding(
                check_id="reporting.headline_table_mismatch",
                title=(
                    f"{trace.mention.section.value.title()} states {stated.raw}, "
                    f"{trace.table.name} gives {found.raw}"
                ),
                severity=Severity.HIGH,
                confidence=Confidence.LIKELY,
                evidence=(
                    Evidence(
                        description=f"{trace.mention.section.value.title()}",
                        quote=trace.mention.sentence,
                        anchor=trace.mention.anchor,
                    ),
                    Evidence(
                        description=(
                            f"{trace.table.name}, row '{trace.cell.row_header}', "
                            f"column '{trace.cell.column_header}'"
                        ),
                        quote=trace.cell.raw,
                        anchor=trace.cell.anchor,
                    ),
                ),
                arithmetic={
                    "stated": stated.value,
                    "found": found.value,
                    "difference": delta,
                    "table": trace.table.name,
                    "row": trace.cell.row_header,
                    "column": trace.cell.column_header,
                    "context_terms_shared": trace.context_score,
                },
                explanation=(
                    f"The {trace.mention.section.value} reports {stated.raw}, but the "
                    f"closest matching cell in {trace.table.name} holds {found.raw}. "
                    f"The two are linked by {trace.context_score} shared term(s) "
                    f"between the sentence and the table, and the gap is larger than "
                    f"rounding at the stated precision."
                ),
            )
        )
    return findings


def analyse(paper: Paper) -> Coverage:
    coverage = trace_all(paper.mentions, paper.tables)
    return coverage


# ------------------------------------------------------------------ internals


def _trace_one(mention: NumericMention, tables: tuple[Table, ...]) -> Trace:
    exact: list[tuple[Table, TableCell]] = []
    rounded: list[tuple[Table, TableCell]] = []
    near: list[tuple[int, Decimal, Table, TableCell]] = []

    for table in tables:
        for cell in table.numeric_cells:
            assert cell.number is not None
            if _same_measurement(mention.number, cell.number):
                # A whole number matches a cell holding the same whole number all the
                # time — "improving by over 2 BLEU" is not evidenced by a cell that
                # happens to read 2. Small integers need the sentence and the table to
                # be talking about the same thing before the match means anything.
                if mention.number.decimals == 0 and abs(mention.number.value) < 100:
                    if not _context_score(mention, table, cell):
                        continue
                exact.append((table, cell))
                continue
            # A cell carrying more precision than the abstract quotes is the same
            # measurement, not a discrepancy.
            if rounds_to(cell.number.as_fraction, mention.number) or rounds_to(
                cell.number.value, mention.number
            ):
                rounded.append((table, cell))
                continue

            # A late edit preserves precision: a table updated from 94.2 to 93.8
            # still reads to one decimal. A stated 73.4 beside a cell holding 74 is
            # two different quantities, not one that was left stale.
            if mention.number.decimals != cell.number.decimals:
                continue

            relative = _relative_gap(mention.number, cell.number)
            if relative is None or not (_MISMATCH_MIN_RELATIVE <= relative <= _MISMATCH_MAX_RELATIVE):
                continue
            score = _context_score(mention, table, cell)
            if score >= _MISMATCH_MIN_CONTEXT:
                near.append((score, relative, table, cell))

    if exact:
        table, cell = exact[0]
        return Trace(mention=mention, status="exact", table=table, cell=cell)
    if rounded:
        table, cell = rounded[0]
        return Trace(mention=mention, status="rounded", table=table, cell=cell)
    if near:
        # Strongest contextual link first, then the closest value: the cell the
        # sentence is most plausibly talking about.
        score, _relative, table, cell = max(near, key=lambda item: (item[0], -item[1]))
        return Trace(
            mention=mention, status="mismatch", table=table, cell=cell, context_score=score
        )
    return Trace(mention=mention, status="untraced")


def _same_measurement(stated: Number, found: Number) -> bool:
    """Whether two numbers are the same measurement, under either reading of scale.

    A percent sign is often carried by the column header rather than by the cell, so
    an abstract's "3.57%" and a table's bare "3.57" under a "top-5 err. (%)" heading
    are one measurement written twice. Comparing only on the 0–1 fraction scale misses
    every such pair — which on ResNet meant the paper's single most quoted number was
    reported as untraceable.

    Both readings are tried: equal as written, or equal once percent scaling is
    applied. Either is enough, because the question is whether the paper evidenced the
    number, not which convention it used to write it down.
    """
    return stated.value == found.value or same_quantity(stated, found)


def _drop_accounted_mismatches(traces: tuple[Trace, ...]) -> tuple[Trace, ...]:
    """Discard near-matches against cells that some other number already accounts for.

    A stale value is one *nothing* matches. Where a sentence reads "reaching 4.9%
    top-5 validation error (and 4.8% test error)", both numbers sit beside the same
    table and the cell holding 4.9% is exactly matched by the first of them. The 4.8%
    is then a different quantity stated alongside, not a version of the cell that was
    never updated — and reporting it would be confidently wrong about a correct paper.
    """
    accounted = {
        (t.table.ordinal, t.cell.row, t.cell.column)
        for t in traces
        if t.is_supported and t.table is not None and t.cell is not None
    }
    return tuple(
        Trace(mention=t.mention, status="untraced")
        if (
            t.status == "mismatch"
            and t.table is not None
            and t.cell is not None
            and (t.table.ordinal, t.cell.row, t.cell.column) in accounted
        )
        else t
        for t in traces
    )


def _relative_gap(stated: Number, found: Number) -> Decimal | None:
    scale = max(abs(stated.as_fraction), abs(found.as_fraction))
    if scale == 0:
        return None
    return abs(stated.as_fraction - found.as_fraction) / scale


def _context_score(mention: NumericMention, table: Table, cell: TableCell) -> int:
    """Distinctive terms shared between the sentence and the cell's table.

    Without this the check would pair any abstract number with any table cell of a
    similar magnitude — and on a paper full of accuracies in the nineties, that is
    every cell. Requiring a shared term is what makes a near-match evidence of the
    *same* measurement rather than a coincidence of scale.
    """
    sentence = _terms(mention.sentence)
    if not sentence:
        return 0
    table_terms = _terms(
        " ".join([table.caption, cell.row_header, cell.column_header, cell.metric])
    )
    return len(sentence & table_terms)


def _terms(text: str) -> set[str]:
    return {
        token.casefold()
        for token in _TOKEN.findall(text)
        if token.casefold() not in _STOPWORDS
    }


def _is_claim_like(number: Number) -> bool:
    """Whether a number is a result being asserted rather than a configuration.

    "94.2%" and "28.4" are claims that should trace to evidence. "8 GPUs", "3 days"
    and "12 layers" are setup, and counting them as unverified would bury the real
    coverage gap under noise about hardware.
    """
    if number.unit in CONFIG_UNITS:
        return False
    if number.unit is not None:
        return True  # a metric unit: BLEU, mAP, perplexity
    return number.is_percent or number.decimals > 0
