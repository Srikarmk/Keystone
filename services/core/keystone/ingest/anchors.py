"""Quote -> pixel geometry. The trust primitive for the whole system.

A model extraction is only admitted into the paper graph if the verbatim text it
quoted can be found in the PDF's own words. That check happens here, in code, and a
quote that cannot be located is *rejected* rather than stored with a vague page
reference. The rejection rate is therefore a direct measurement of extraction
hallucination.

Matching runs in three tiers, most trustworthy first:

1. ``exact_strict``  — hyphens preserved, so ``-3.2`` never matches ``3.2``.
2. ``exact_loose``   — hyphens dropped, for compounds broken across a line and
                       reproduced unbroken by the model.
3. ``fuzzy``         — alignment over the strict skeleton. **Off by default**, and
                       for good reason (see below).

Fuzzy matching is not admitted unless a caller explicitly asks for it. Measured on a
corpus of ten arXiv papers, the two exact tiers located 1846 of 1846 real spans, so
fuzzy earned nothing on the positive side — while accepting 5.9% of deliberately
fabricated quotes on the negative side. ``partial_ratio`` scores the best-matching
window, which makes it structurally insensitive to exactly the corruption that
matters most here: a single substituted word. "Trade, feature 9-50" scored 93.6
against "Trade, pages 9-50".

For a tool whose purpose is verifying what a paper says, that trade is unacceptable.
An anchor onto near-miss text would let the audit report a discrepancy against a
sentence that does not exist. So a near miss is *reported* — ``LocateResult`` carries
it, so a rejection can be explained and a UI can show what the closest text was — but
it is not an anchor. Callers that genuinely need it (scanned or OCR'd sources) opt in
with ``allow_fuzzy=True``, which additionally requires that every substantial word of
the quote actually appear in the matched span.
"""

from __future__ import annotations

from array import array
from dataclasses import dataclass, field
from statistics import median
from typing import Literal

from rapidfuzz import fuzz

from .normalize import skeletonize, skeletonize_word
from .pdf import Document, Word
from .regions import encloses_centre, is_vertical_line, page_word_map

Method = Literal["exact_strict", "exact_loose", "fuzzy"]
Precision = Literal["tight", "approximate"]
Reason = Literal["exact_strict", "exact_loose", "fuzzy", "too_short", "not_found"]

# A quote shorter than this (in skeleton characters) cannot be located with any
# confidence — "we find that" occurs on every other page. Reject rather than guess.
MIN_SKELETON_CHARS = 16

# Opt-in fuzzy matching only. The threshold is far above the conventional ~90 because
# the tier exists for glyph-level noise, not for paraphrase.
FUZZY_MIN_SCORE = 97.0

# Words at least this long must all be present in the span for a fuzzy match to be
# admitted. Short function words are skipped: they are the tokens most likely to be
# mangled by extraction noise, and their absence says least about whether the
# substance of the quote is really there.
FUZZY_REQUIRED_WORD_LENGTH = 4


@dataclass(frozen=True, slots=True)
class Rect:
    """A highlight rectangle in PDF points, one per visual line of a match.

    Carries the text of the words that produced it. That makes each rectangle
    independently checkable, and gives the frontend something to put in the
    highlight's accessible label instead of an unlabelled coloured box.
    """

    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    vertical: bool = False  # rotated line, e.g. a figure's y-axis label

    def to_dict(self) -> dict[str, float | int | str | bool]:
        return {
            "page": self.page, "x0": self.x0, "y0": self.y0,
            "x1": self.x1, "y1": self.y1, "text": self.text,
            "vertical": self.vertical,
        }


@dataclass(frozen=True, slots=True)
class Anchor:
    """A located span: what was asked for, what was found, and where it is."""

    quote: str  # as supplied by the caller
    matched_text: str  # the PDF's own words for this span, verbatim
    word_start: int
    word_end: int  # inclusive
    rects: tuple[Rect, ...]
    pages: tuple[int, ...]
    method: Method
    score: float  # 100.0 for exact tiers
    occurrences: int  # skeleton matches found document-wide; > 1 means ambiguous
    precision: Precision
    """Whether the rectangles bound only this span's own words.

    ``tight`` means they do, and a highlight drawn from them is exact. ``approximate``
    means they unavoidably enclose neighbouring words, because the span sits in
    stacked geometry — a fraction's numerator and denominator, a subscript beside its
    symbol, a stretched delimiter. No axis-aligned rectangle can separate those, so
    the anchor says so rather than implying a precision it does not have.

    Downstream this is a routing signal, not a warning to ignore: prose claims must
    carry ``tight`` anchors, and equations are recovered from arXiv LaTeX source
    instead of being anchored through PDF glyphs.
    """

    @property
    def is_ambiguous(self) -> bool:
        return self.occurrences > 1

    @property
    def has_rotated_text(self) -> bool:
        """Rotated lines cannot be tightly bounded by an axis-aligned rectangle."""
        return any(r.vertical for r in self.rects)

    def to_dict(self) -> dict:
        return {
            "quote": self.quote,
            "matched_text": self.matched_text,
            "word_start": self.word_start,
            "word_end": self.word_end,
            "pages": list(self.pages),
            "rects": [r.to_dict() for r in self.rects],
            "method": self.method,
            "score": self.score,
            "occurrences": self.occurrences,
            "precision": self.precision,
        }


@dataclass(frozen=True, slots=True)
class LocateResult:
    anchor: Anchor | None
    reason: Reason
    near_miss: Anchor | None = None
    """The best fuzzy candidate, when one was found but not admitted.

    Present so a rejection can be explained rather than merely reported — "closest
    text in the document was X, at 93% similarity" tells a caller far more than
    "not found", and makes a misquoted extraction diagnosable.
    """

    def __bool__(self) -> bool:
        return self.anchor is not None


@dataclass
class _Skeleton:
    text: str
    owner: array  # owner[i] = index into Document.words for skeleton char i


@dataclass
class DocIndex:
    """Searchable projection of a document. Build once, locate many."""

    doc: Document
    _strict: _Skeleton = field(init=False, repr=False)
    _loose: _Skeleton = field(init=False, repr=False)
    _page_words: dict[int, list[Word]] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        # Furniture is excluded, which closes the gap it opens in the body text. A
        # sentence interrupted by a running head or the arXiv stamp is contiguous
        # again, and therefore locatable.
        self._strict = _build_skeleton(self.doc.words, drop_hyphens=False, skip=self.doc.furniture)
        self._loose = _build_skeleton(self.doc.words, drop_hyphens=True, skip=self.doc.furniture)
        self._page_words = page_word_map(self.doc.words)

    # ------------------------------------------------------------------ locate

    def locate(
        self,
        quote: str,
        *,
        allow_fuzzy: bool = False,
        min_score: float = FUZZY_MIN_SCORE,
        page_hint: int | None = None,
    ) -> LocateResult:
        """Find ``quote`` in the document. Never guesses: returns why it failed."""
        strict_q = skeletonize(quote)
        if len(strict_q) < MIN_SKELETON_CHARS:
            return LocateResult(None, "too_short")

        for method, skel, q in (
            ("exact_strict", self._strict, strict_q),
            ("exact_loose", self._loose, skeletonize(quote, drop_hyphens=True)),
        ):
            positions = _find_all(skel.text, q)
            if positions:
                pos = _pick_position(positions, len(q), skel, self.doc, page_hint)
                return LocateResult(
                    self._anchor(quote, skel, pos, pos + len(q), method, 100.0, len(positions)),
                    method,  # type: ignore[arg-type]
                )

        alignment = fuzz.partial_ratio_alignment(strict_q, self._strict.text)
        if alignment is None:
            return LocateResult(None, "not_found")

        candidate = self._anchor(
            quote, self._strict, alignment.dest_start, alignment.dest_end,
            "fuzzy", float(alignment.score), 1,
        )
        admissible = (
            allow_fuzzy
            and alignment.score >= min_score
            and _span_contains_substantial_words(quote, candidate.matched_text)
        )
        if admissible:
            return LocateResult(candidate, "fuzzy")
        return LocateResult(None, "not_found", near_miss=candidate)

    def contains(self, text: str, *, drop_hyphens: bool = True) -> bool:
        """Whether text occurs in the document at all, ignoring layout and casing."""
        skeleton = self._loose if drop_hyphens else self._strict
        needle = skeletonize(text, drop_hyphens=drop_hyphens)
        return bool(needle) and needle in skeleton.text

    # ------------------------------------------------------------------ helpers

    def _anchor(
        self, quote: str, skel: _Skeleton, start: int, end: int,
        method: Method, score: float, occurrences: int,
    ) -> Anchor:
        owners = skel.owner[start:end]
        # Span the full contiguous word range rather than only the words that
        # contributed skeleton characters: a word whose skeleton is empty (a stray
        # soft hyphen, say) sits inside the match and must not leave a visual gap.
        w_start, w_end = min(owners), max(owners)
        words = self.doc.words[w_start : w_end + 1]
        lines = _rects_for(words)
        rects = tuple(rect for rect, _members in lines)
        return Anchor(
            quote=quote,
            matched_text=" ".join(w.text for w in words),
            word_start=w_start,
            word_end=w_end,
            rects=rects,
            pages=tuple(sorted({w.page for w in words})),
            method=method,
            score=score,
            occurrences=occurrences,
            precision=self._precision(lines),
        )

    def _precision(self, lines: tuple[tuple[Rect, tuple[int, ...]], ...]) -> Precision:
        """Report ``tight`` only if every rectangle bounds exactly its own words.

        Checked per rectangle against its own line's words, not against the span as a
        whole. A span's rectangles can overlap each *other* — a fraction's numerator
        rectangle reaching over its denominator — and clipping either one then returns
        the other's glyphs even though both words belong to the span. Testing only for
        words foreign to the span would call that tight, and it is not.
        """
        for rect, members in lines:
            for word in self._page_words.get(rect.page, ()):
                if word.idx in members:
                    continue
                if encloses_centre(rect, word):
                    return "approximate"
        return "tight"


def _build_skeleton(
    words: tuple[Word, ...], *, drop_hyphens: bool, skip: frozenset[int] = frozenset()
) -> _Skeleton:
    parts: list[str] = []
    owner = array("i")
    for w in words:
        if w.idx in skip:
            continue
        skel = skeletonize_word(w.text, drop_hyphens=drop_hyphens, line_end=w.is_line_end)
        if not skel:
            continue
        parts.append(skel)
        owner.extend([w.idx] * len(skel))
    return _Skeleton(text="".join(parts), owner=owner)


def _find_all(haystack: str, needle: str, *, limit: int = 64) -> list[int]:
    """All occurrences of needle, capped — the cap only affects ambiguity counting."""
    out: list[int] = []
    pos = haystack.find(needle)
    while pos != -1 and len(out) < limit:
        out.append(pos)
        pos = haystack.find(needle, pos + 1)
    return out


def _pick_position(
    positions: list[int], length: int, skel: _Skeleton,
    doc: Document, page_hint: int | None,
) -> int:
    """Disambiguate repeated text using the caller's page hint when it has one."""
    if page_hint is None or len(positions) == 1:
        return positions[0]
    for pos in positions:
        if doc.words[skel.owner[pos]].page == page_hint:
            return pos
    return positions[0]


def _rects_for(words: tuple[Word, ...]) -> tuple[tuple[Rect, tuple[int, ...]], ...]:
    """One rectangle per visual line, paired with the words that produced it.

    Highlights follow the text's own wrapping, and the membership list lets callers
    ask what a given rectangle is supposed to contain.
    """
    lines: dict[tuple[int, int, int], list[Word]] = {}
    for w in words:
        lines.setdefault((w.page, w.block, w.line), []).append(w)

    built = [
        (_rect_for_line(page, group), tuple(w.idx for w in group))
        for (page, _block, _line), group in lines.items()
    ]
    return tuple(sorted(built, key=lambda pair: (pair[0].page, pair[0].y0, pair[0].x0)))


def _rect_for_line(page: int, group: list[Word]) -> Rect:
    text = " ".join(w.text for w in group)

    if is_vertical_line(group):
        # A rotated line has no tall-glyph hazard to guard against, and its extent is
        # genuinely the union of its words. Flagged so callers know the rectangle is a
        # loose bound rather than a tight one.
        return Rect(
            page=page,
            x0=min(w.x0 for w in group), y0=min(w.y0 for w in group),
            x1=max(w.x1 for w in group), y1=max(w.y1 for w in group),
            text=text, vertical=True,
        )

    # Vertical extent is the median of the line's words rather than their union. A
    # single tall glyph — an integral sign, a stacked fraction, "→∞" — has a bounding
    # box far deeper than the line it sits on, and a union would stretch the highlight
    # across the whole of the following line.
    centres = [(w.y0 + w.y1) / 2 for w in group]
    y0 = min(median([w.y0 for w in group]), min(centres))
    y1 = max(median([w.y1 for w in group]), max(centres))

    # Horizontal extent stays a union: lines do not overlap left to right, so there is
    # no equivalent hazard. Every word's centre is inside by construction.
    return Rect(
        page=page,
        x0=min(w.x0 for w in group), y0=y0,
        x1=max(w.x1 for w in group), y1=y1,
        text=text,
    )


def _span_contains_substantial_words(quote: str, matched_text: str) -> bool:
    """Guard a fuzzy match against word substitution.

    Alignment scores reward a long shared window, so replacing one word inside an
    otherwise identical sentence barely moves the score. Requiring every substantial
    word of the quote to actually appear in the span catches that directly.
    """
    haystack = skeletonize(matched_text, drop_hyphens=True)
    for token in quote.split():
        needle = skeletonize(token, drop_hyphens=True)
        if len(needle) >= FUZZY_REQUIRED_WORD_LENGTH and needle not in haystack:
            return False
    return True
