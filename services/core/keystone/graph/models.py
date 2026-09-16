"""The typed structures the audit engine reasons over.

Deliberately small, and deliberately not a database schema. Checks are pure functions
over these types, which is what makes them unit-testable against hand-built fixtures
with no PDF, no network, and no model in the loop. Persistence can be added underneath
later without any check knowing about it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum
from typing import Any

from keystone.audit.numbers import Number
from keystone.ingest.anchors import Anchor


class Severity(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    NOTE = "note"


class Confidence(StrEnum):
    """How sure the finding is, separately from how much it would matter.

    Kept distinct from severity because they answer different questions. A bolded
    value that is not the best in its column is certain and minor; a suspected
    leakage signal is uncertain and serious. Collapsing the two loses the
    distinction a reader needs to decide what to look at first.
    """

    CERTAIN = "certain"  # arithmetic; no judgement involved
    LIKELY = "likely"
    POSSIBLE = "possible"


class SectionKind(StrEnum):
    ABSTRACT = "abstract"
    INTRODUCTION = "introduction"
    RELATED = "related"
    METHOD = "method"
    EXPERIMENTS = "experiments"
    RESULTS = "results"
    DISCUSSION = "discussion"
    LIMITATIONS = "limitations"
    CONCLUSION = "conclusion"
    APPENDIX = "appendix"
    OTHER = "other"

    @property
    def is_headline(self) -> bool:
        """Sections where a number is a claim to the reader rather than a detail.

        A figure quoted in the abstract or the conclusion is what the paper is
        asserting; the same figure inside a results table is where it is evidenced.
        Checks that trace claims back to evidence start here.
        """
        return self in (
            SectionKind.ABSTRACT,
            SectionKind.INTRODUCTION,
            SectionKind.CONCLUSION,
        )


@dataclass(frozen=True, slots=True)
class Section:
    kind: SectionKind
    title: str
    text: str
    """Prose with markup stripped — what can be matched against the PDF."""
    source: str = ""
    """The section's own LaTeX.

    Kept because stripping is lossy in a way that matters: ``\\ref`` and ``\\cite``
    say what a claim rests on, and they are gone from ``text`` by construction.
    """
    anchor: Anchor | None = None


@dataclass(frozen=True, slots=True)
class TableCell:
    """One cell, with its position and whatever could be read from its formatting."""

    row: int
    column: int
    raw: str
    number: Number | None = None
    row_header: str = ""
    column_header: str = ""
    metric: str = ""
    """The innermost column header, which names what the cell measures.

    Distinct from ``column_header``, which joins every header level for display. In a
    banded header like "COCO test-dev / @[.5, .95]" it is the second part that says
    two cells hold the same kind of quantity and may be compared.
    """
    block: int = 0
    """Which horizontal band of the table the cell sits in.

    A "best result" marker is a claim about the band it is in — prior work, or the
    authors' own rows — not about the whole column.
    """
    is_emphasised: bool = False
    """Set when the source marked the cell bold or underlined.

    Authors use emphasis to mean "best in this column", which makes it a checkable
    assertion rather than decoration.
    """
    anchor: Anchor | None = None

    @property
    def is_numeric(self) -> bool:
        return self.number is not None


@dataclass(frozen=True, slots=True)
class Table:
    ordinal: int
    caption: str = ""
    label: str = ""
    cells: tuple[TableCell, ...] = ()
    anchor: Anchor | None = None

    @property
    def name(self) -> str:
        return f"Table {self.ordinal + 1}"

    def column(self, index: int) -> tuple[TableCell, ...]:
        return tuple(c for c in self.cells if c.column == index)

    def column_block(self, index: int, block: int) -> tuple[TableCell, ...]:
        return tuple(c for c in self.cells if c.column == index and c.block == block)

    def row(self, index: int) -> tuple[TableCell, ...]:
        return tuple(c for c in self.cells if c.row == index)

    @property
    def numeric_cells(self) -> tuple[TableCell, ...]:
        return tuple(c for c in self.cells if c.is_numeric)

    @property
    def column_indices(self) -> tuple[int, ...]:
        return tuple(sorted({c.column for c in self.cells}))


@dataclass(frozen=True, slots=True)
class NumericMention:
    """A number appearing in prose, with the sentence that gives it meaning."""

    number: Number
    sentence: str
    section: SectionKind
    anchor: Anchor | None = None
    refs: tuple[str, ...] = ()
    """Labels the sentence points at — what the author says the evidence is."""
    cites: tuple[str, ...] = ()
    """Citation keys in the sentence: the claim may rest on another paper."""


@dataclass(frozen=True, slots=True)
class Evidence:
    """One side of a finding: what was found where, and what it said."""

    description: str
    quote: str = ""
    anchor: Anchor | None = None


@dataclass(frozen=True, slots=True)
class Finding:
    """A defect, stated so a reader can check it rather than trust it.

    ``arithmetic`` is what separates this from an opinion: it holds the numbers that
    produced the verdict, so the interface can show the working. A finding whose
    verdict came from code should never need its ``explanation`` to be believed.
    """

    check_id: str
    title: str
    severity: Severity
    confidence: Confidence
    evidence: tuple[Evidence, ...] = ()
    arithmetic: dict[str, Any] = field(default_factory=dict)
    explanation: str = ""

    @property
    def anchors(self) -> tuple[Anchor, ...]:
        return tuple(e.anchor for e in self.evidence if e.anchor is not None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "check_id": self.check_id,
            "title": self.title,
            "severity": str(self.severity),
            "confidence": str(self.confidence),
            "explanation": self.explanation,
            "arithmetic": {k: _plain(v) for k, v in self.arithmetic.items()},
            "evidence": [
                {
                    "description": e.description,
                    "quote": e.quote,
                    "anchor": e.anchor.to_dict() if e.anchor else None,
                }
                for e in self.evidence
            ],
        }


def _plain(value: Any) -> Any:
    """Make arithmetic JSON-safe without losing the precision it was computed at."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Number):
        return value.raw
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


@dataclass(frozen=True, slots=True)
class Paper:
    """Everything a check may read. Assembled by ingest; never mutated by a check."""

    id: str
    title: str = ""
    sections: tuple[Section, ...] = ()
    tables: tuple[Table, ...] = ()
    mentions: tuple[NumericMention, ...] = ()
    notes: str = ""
    """Free text from the paper that checks may consult for stated conventions.

    Papers often say once, in prose rather than in any caption, what their emphasis
    means — "the best result on each dataset is highlighted in bold". That sentence
    turns an inference into a fact, so it is worth having available.
    """

    def sections_of(self, *kinds: SectionKind) -> tuple[Section, ...]:
        return tuple(s for s in self.sections if s.kind in kinds)

    @property
    def headline_mentions(self) -> tuple[NumericMention, ...]:
        return tuple(m for m in self.mentions if m.section.is_headline)
