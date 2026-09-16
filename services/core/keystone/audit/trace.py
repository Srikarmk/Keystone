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

TraceStatus = Literal[
    # Verified: the number itself was found in a table cell.
    "exact",
    "rounded",
    # Checkable and wrong: close to a cell the sentence is clearly about.
    "mismatch",
    # Declared but not numerically checkable. The author says where the evidence is,
    # and it is a kind no arithmetic can confirm — a plot, a derivation, a theorem, or
    # somebody else's paper. Reporting these as "unsupported" was the flaw in treating
    # tables as the only evidence a paper can have: it made every theory paper and
    # every figure-driven result look unevidenced.
    "declared_table",
    "declared_figure",
    "declared_equation",
    "declared_theorem",
    "declared_algorithm",
    "citation",
    # Nothing at all points at anything.
    "untraced",
    # Indexed but deliberately not traced: a hyperparameter is not a claim.
    "configuration",
]

_DECLARED: dict[str, TraceStatus] = {
    "table": "declared_table",
    "figure": "declared_figure",
    "equation": "declared_equation",
    "theorem": "declared_theorem",
    "algorithm": "declared_algorithm",
}

#: Statuses where the paper points at evidence we cannot check by arithmetic.
DECLARED_STATUSES = frozenset(_DECLARED.values()) | {"citation"}

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
    evidence_label: str | None = None

    @property
    def is_supported(self) -> bool:
        """Verified by arithmetic — the number was found where it should be."""
        return self.status in ("exact", "rounded")

    @property
    def is_declared(self) -> bool:
        """The author names the evidence, but it is not a number we can recompute."""
        return self.status in DECLARED_STATUSES


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
    def declared(self) -> tuple[Trace, ...]:
        return tuple(t for t in self.claims if t.is_declared)

    @property
    def unsupported(self) -> tuple[Trace, ...]:
        return tuple(t for t in self.claims if t.status == "untraced")

    @property
    def mismatched(self) -> tuple[Trace, ...]:
        return tuple(t for t in self.claims if t.status == "mismatch")

    @property
    def rate(self) -> float:
        return len(self.supported) / len(self.claims) if self.claims else 0.0


# Words that turn a following number into a pointer rather than a measurement.
# "Table 3" and "Section 4.2" are navigation, and counting them as unverified claims
# buries the real coverage gap under cross-references.
_POINTER = re.compile(
    r"(?:table|tables|figure|figures|fig|section|sections|sec|equation|equations|eq"
    r"|eqn|algorithm|appendix|appendices|theorem|lemma|footnote|line|step|chapter)"
    r"\s*\.?\s*$",
    re.IGNORECASE,
)

NumberKind = Literal["result", "configuration", "reference", "structural"]


def classify_number(number: Number, sentence: str) -> NumberKind:
    """What role a number plays in its sentence.

    Indexing every number in a paper is only useful if they are separable. A results
    table's accuracy, a batch size, and the "3" in "Table 3" are three different kinds
    of thing, and showing them in one undifferentiated list is the same mistake as
    showing none of them.
    """
    if _POINTER.search(sentence[: number.start]):
        return "reference"
    if number.unit in CONFIG_UNITS:
        return "configuration"
    if number.is_percent or number.decimals > 0 or number.unit is not None:
        return "result"
    return "structural"


def all_mentions(sections: tuple[Section, ...]) -> tuple[NumericMention, ...]:
    """Every number in the paper, wherever it appears, with its role and references.

    The reader previously showed 28 of 1,554 numbers across nine papers — numeric
    claims in three sections only — which is why four of those papers had nothing to
    display at all.
    """
    from keystone.ingest.latex import source_sentences

    out: list[NumericMention] = []
    for section in sections:
        for sentence in source_sentences(section.source or section.text):
            for number in find_numbers(sentence.text):
                out.append(
                    NumericMention(
                        number=number,
                        sentence=sentence.text.strip(),
                        section=section.kind,
                        refs=sentence.refs,
                        cites=sentence.cites,
                        kind=classify_number(number, sentence.text),
                    )
                )
    return tuple(out)


def headline_mentions(sections: tuple[Section, ...]) -> tuple[NumericMention, ...]:
    """Every number stated in the sections where a paper makes its case."""
    from keystone.ingest.latex import source_sentences

    out: list[NumericMention] = []
    for section in sections:
        if not section.kind.is_headline:
            continue
        for sentence in source_sentences(section.source or section.text):
            for number in find_numbers(sentence.text):
                out.append(
                    NumericMention(
                        number=number,
                        sentence=sentence.text.strip(),
                        section=section.kind,
                        refs=sentence.refs,
                        cites=sentence.cites,
                    )
                )
    return tuple(out)


def trace_all(
    mentions: tuple[NumericMention, ...],
    tables: tuple[Table, ...],
    label_kinds: dict[str, str] | None = None,
    body_sentences: tuple = (),
) -> Coverage:
    """Tie each headline number to its evidence, of whatever kind that turns out to be."""
    kinds = label_kinds or {}
    traces = tuple(_trace_one(m, tables, kinds, body_sentences) for m in mentions)
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


def _declared_trace(mention: NumericMention, kinds: dict[str, str]) -> Trace | None:
    """Classify a claim by the evidence its own sentence points at.

    Ordered by how specific the evidence is. A sentence naming a figure is resting on
    that figure; one that only cites is resting on other work, which is a weaker but
    real answer to "what holds this up".
    """
    for ref in mention.refs:
        status = _DECLARED.get(kinds.get(ref, ""))
        if status is not None:
            return Trace(mention=mention, status=status, evidence_label=ref)
    if mention.cites:
        return Trace(mention=mention, status="citation", evidence_label=mention.cites[0])
    return None


def _restated_trace(
    mention: NumericMention, kinds: dict[str, str], body_sentences: tuple
) -> Trace | None:
    """Follow the paper's own chain from a headline number to its evidence.

    Abstracts do not cite. They are written to stand alone, so the ``\\ref`` that names
    the evidence is almost never in the same sentence as the claim — it is in the
    results section, where the number is stated again. Measured across nine papers,
    classifying only on a claim's own sentence found declared evidence for none of
    them, which is why tracing appeared to work for tables and nothing else.

    So: find where the body restates the number, and read *that* sentence's references.
    "The abstract's 88.5% is restated in the results beside Figure 4" is a real answer
    to what a claim rests on, and it is the paper's own answer.
    """
    target = mention.number
    for sentence in body_sentences:
        if not (sentence.refs or sentence.cites):
            continue
        if not any(
            _same_measurement(target, other) for other in find_numbers(sentence.text)
        ):
            continue
        for ref in sentence.refs:
            status = _DECLARED.get(kinds.get(ref, ""))
            if status is not None:
                return Trace(mention=mention, status=status, evidence_label=ref)
        if sentence.cites:
            return Trace(
                mention=mention, status="citation", evidence_label=sentence.cites[0]
            )
    return None


def _trace_one(
    mention: NumericMention,
    tables: tuple[Table, ...],
    kinds: dict[str, str],
    body_sentences: tuple = (),
) -> Trace:
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

    # Nothing verifiable. Before calling it unsupported, ask what the paper says it
    # rests on: a figure or a theorem is evidence we cannot recompute, not evidence
    # that is missing.
    declared = _declared_trace(mention, kinds) or _restated_trace(
        mention, kinds, body_sentences
    )
    return declared or Trace(mention=mention, status="untraced")


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
