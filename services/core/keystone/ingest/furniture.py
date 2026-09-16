"""Identifying page furniture — text that is on the page but not of the document.

Running headers, page numbers, and the rotated arXiv stamp down the margin of page
one are all emitted by MuPDF as blocks interleaved with the body text. That breaks
contiguity: on the BERT paper the stamp lands between "masked" and "word", so the
sentence

    "...predict the original vocabulary id of the masked word based only on its
    context."

does not occur as a contiguous run of words anywhere in the document, and cannot be
located however good the matcher is.

Excluding furniture from the search index closes the gap either side of it, which
makes such sentences locatable again. The words stay in the document — their geometry
is still needed, and a caller can still ask what is on the page — they are simply not
part of the text the document is considered to *say*. Claim extraction wants the same
distinction: a running header is not a claim.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass

from .normalize import skeletonize
from .pdf import Document, Word
from .regions import is_vertical_line

# The arXiv stamp, printed rotated down the margin of the first page.
_ARXIV_STAMP = re.compile(r"^arxiv:\d{4}\.\d{4,5}", re.IGNORECASE)

# Fraction of page height at the top and bottom treated as header/footer bands.
_BAND = 0.07

# Fraction of page width at each side treated as margin.
_MARGIN = 0.08

# A header must recur to be a header; a one-off line in the top band is just the
# first line of the page.
_MIN_REPEATS = 3

_DIGITS = re.compile(r"\d+")
_PAGE_NUMBER = re.compile(r"^(?:\d{1,4}|[ivxlcdm]{1,7})$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class FurnitureReport:
    """Which words are furniture, and why — the reasons are for auditability."""

    word_indices: frozenset[int]
    reasons: dict[str, int]

    def __contains__(self, word_index: int) -> bool:
        return word_index in self.word_indices


def detect(doc: Document) -> FurnitureReport:
    """Find every word belonging to page furniture rather than body text."""
    lines = _group_lines(doc)
    heights = {page.number: page.height for page in doc.pages}
    widths = {page.number: page.width for page in doc.pages}

    furniture: set[int] = set()
    reasons: dict[str, int] = defaultdict(int)

    def mark(group: list[Word], reason: str) -> None:
        for word in group:
            furniture.add(word.idx)
        reasons[reason] += 1

    # Pass one: rules that need only the line itself.
    banded: dict[str, list[tuple[int, list[Word]]]] = defaultdict(list)
    for (page, _block, _line), group in lines.items():
        text = " ".join(w.text for w in group)
        height = heights.get(page, 1.0)
        width = widths.get(page, 1.0)

        # The stamp is rotated. Requiring that is what separates it from a
        # bibliography entry citing an arXiv preprint, which matches the same pattern
        # but is ordinary horizontal body text — and which citation checks need to be
        # able to anchor.
        if _ARXIV_STAMP.match(skeletonize(text)) and is_vertical_line(group):
            mark(group, "arxiv_stamp")
            continue

        # Rotated text pinned to a side margin is a stamp or a spine label. Rotated
        # text elsewhere is a figure's axis label, which is content.
        if is_vertical_line(group):
            centre_x = sum((w.x0 + w.x1) / 2 for w in group) / len(group)
            if centre_x < width * _MARGIN or centre_x > width * (1 - _MARGIN):
                mark(group, "margin_rotated")
                continue

        top = min(w.y0 for w in group)
        bottom = max(w.y1 for w in group)
        in_band = bottom <= height * _BAND or top >= height * (1 - _BAND)
        if not in_band:
            continue

        if _PAGE_NUMBER.match(text.strip()):
            mark(group, "page_number")
            continue

        # Defer: a line in a band is only furniture if it recurs across pages. Digits
        # are normalised so "Page 3 of 12" and "Page 4 of 12" count as the same line.
        banded[_DIGITS.sub("#", skeletonize(text))].append((page, group))

    # Pass two: lines in a header or footer band that recur across pages.
    for signature, occurrences in banded.items():
        if not signature:
            continue
        if len({page for page, _ in occurrences}) < _MIN_REPEATS:
            continue
        for _page, group in occurrences:
            mark(group, "running_head")

    return FurnitureReport(frozenset(furniture), dict(reasons))


def _group_lines(doc: Document) -> dict[tuple[int, int, int], list[Word]]:
    lines: dict[tuple[int, int, int], list[Word]] = defaultdict(list)
    for word in doc.words:
        lines[(word.page, word.block, word.line)].append(word)
    return lines
