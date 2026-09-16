"""Span sampling for anchor QA.

Generates realistic quotes by lifting contiguous word runs straight out of a
document, the way a model quoting the paper would. Used by the anchor audit and by
the test suite so both exercise the same span shapes.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from .normalize import skeletonize
from .pdf import Document, Word

MIN_WORDS = 8
MAX_WORDS = 25


@dataclass(frozen=True, slots=True)
class SampledSpan:
    quote: str
    word_start: int
    word_end: int
    crosses_line: bool
    crosses_page: bool
    has_line_hyphen: bool


def sample_spans(doc: Document, count: int, *, seed: int = 0) -> list[SampledSpan]:
    """Sample word runs long enough to be unambiguously locatable."""
    rng = random.Random(seed)
    spans: list[SampledSpan] = []
    attempts = 0
    seen: set[tuple[int, int]] = set()

    while len(spans) < count and attempts < count * 40:
        attempts += 1
        n = rng.randint(MIN_WORDS, MAX_WORDS)
        start = rng.randrange(0, max(1, len(doc.words) - n))
        end = start + n - 1
        if (start, end) in seen:
            continue
        seen.add((start, end))

        if any(i in doc.furniture for i in range(start, end + 1)):
            continue  # a quote never runs through a running head or the arXiv stamp
        span = _build(doc.words[start : end + 1])
        # Too-short skeletons are rejected by the matcher on purpose; sampling them
        # would measure that policy rather than the geometry.
        if span is None or len(skeletonize(span.quote)) < 24:
            continue
        spans.append(span)

    return spans


def spans_with_line_hyphens(doc: Document, count: int, *, seed: int = 0) -> list[SampledSpan]:
    """Spans that straddle a hyphenated line break — the hard de-hyphenation case."""
    rng = random.Random(seed)
    breaks = [
        w.idx for w in doc.words
        if w.is_line_end and w.text.endswith("-") and w.idx + 1 < len(doc.words)
    ]
    rng.shuffle(breaks)

    spans: list[SampledSpan] = []
    for idx in breaks:
        lead = rng.randint(3, 8)
        trail = rng.randint(3, 8)
        start = max(0, idx - lead)
        end = min(len(doc.words) - 1, idx + trail)
        if any(i in doc.furniture for i in range(start, end + 1)):
            continue  # a quote never runs through a running head or the arXiv stamp
        if any(i in doc.furniture for i in range(start, end + 1)):
            continue
        span = _build(doc.words[start : end + 1])
        if span is not None and len(skeletonize(span.quote)) >= 24:
            spans.append(span)
        if len(spans) >= count:
            break
    return spans


def _build(words: tuple[Word, ...]) -> SampledSpan | None:
    if not words:
        return None
    quote = " ".join(w.text for w in words)
    if not quote.strip():
        return None
    lines = {(w.page, w.block, w.line) for w in words}
    pages = {w.page for w in words}
    return SampledSpan(
        quote=quote,
        word_start=words[0].idx,
        word_end=words[-1].idx,
        crosses_line=len(lines) > 1,
        crosses_page=len(pages) > 1,
        has_line_hyphen=any(w.is_line_end and w.text.endswith("-") for w in words[:-1]),
    )
