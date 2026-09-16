"""Classifying what kind of region a span of words sits in.

Anchor reliability is not uniform across a paper. Body prose anchors essentially
perfectly; display math does not, because MuPDF's word segmentation and its clipped
text extraction disagree at the glyph level once boxes start overlapping (stacked
fractions, big delimiters, sub- and superscripts). Rotated text — a figure's vertical
axis label — has the same problem for a different reason: an axis-aligned rectangle
cannot tightly bound a line running bottom-to-top.

Both facts matter beyond QA. Claim extraction must not try to anchor a claim inside
display math, and equations are recovered from arXiv LaTeX source rather than from
PDF glyphs precisely because this layer is unreliable there.
"""

from __future__ import annotations

import unicodedata

from .pdf import Word

# Codepoint ranges that only appear in mathematical typesetting. The Private Use Area
# matters more than it looks: TeX math fonts emit PUA codepoints for the pieces of
# large delimiters and radicals, so a stretched bracket arrives as an unmapped glyph.
_MATH_RANGES = (
    (0x0370, 0x03FF),  # Greek
    (0x1D400, 0x1D7FF),  # mathematical alphanumeric symbols
    (0x2100, 0x214F),  # letterlike symbols
    (0x2190, 0x21FF),  # arrows
    (0x2200, 0x22FF),  # mathematical operators
    (0x2300, 0x23FF),  # miscellaneous technical
    (0x27C0, 0x27EF),  # miscellaneous mathematical symbols A
    (0x2980, 0x29FF),  # miscellaneous mathematical symbols B
    (0x2A00, 0x2AFF),  # supplemental mathematical operators
    (0xE000, 0xF8FF),  # private use — TeX delimiter and radical fragments
)

# A span this mathematical is treated as an equation rather than prose. Chosen to sit
# well clear of prose that merely mentions a symbol: an inline "β" in a sentence
# leaves mathiness near 0.05, while a display equation runs above 0.4.
MATH_SPAN_THRESHOLD = 0.15


def is_math_char(ch: str) -> bool:
    code = ord(ch)
    if any(low <= code <= high for low, high in _MATH_RANGES):
        return True
    return unicodedata.category(ch) == "Sm"


def is_math_word(word: Word) -> bool:
    return any(is_math_char(ch) for ch in word.text)


def mathiness(words: tuple[Word, ...] | list[Word]) -> float:
    """Fraction of words carrying mathematical glyphs. 0.0 for an empty span."""
    if not words:
        return 0.0
    return sum(1 for w in words if is_math_word(w)) / len(words)


def is_math_span(words: tuple[Word, ...] | list[Word]) -> bool:
    return mathiness(words) >= MATH_SPAN_THRESHOLD


def is_vertical_line(words: list[Word]) -> bool:
    """True when a line of words runs vertically — a rotated figure axis label.

    Detected from how the line advances: horizontal text spreads its words across x
    at a near-constant y, rotated text does the reverse. Single-word lines are never
    reported as vertical; one word carries no direction.
    """
    if len(words) < 2:
        return False
    xs = [(w.x0 + w.x1) / 2 for w in words]
    ys = [(w.y0 + w.y1) / 2 for w in words]
    return (max(ys) - min(ys)) > (max(xs) - min(xs))


def _area(w: Word) -> float:
    return max(0.0, w.x1 - w.x0) * max(0.0, w.y1 - w.y0)


def _overlap_area(a: Word, b: Word) -> float:
    dx = min(a.x1, b.x1) - max(a.x0, b.x0)
    dy = min(a.y1, b.y1) - max(a.y0, b.y0)
    return dx * dy if dx > 0 and dy > 0 else 0.0


# Two word boxes sharing this much of the smaller box are genuinely stacked rather
# than merely adjacent with touching bounds.
_SIGNIFICANT_OVERLAP = 0.2


def overlap_fraction(words: list[Word], page_words: dict[int, list[Word]]) -> float:
    """Fraction of a span's words whose box significantly overlaps another word's box.

    This is the structural precondition for unreliable anchoring, and it is measured
    rather than inferred. In body prose, word boxes are disjoint: they sit side by
    side on a line and lines sit above one another. In display math they are stacked —
    numerator over denominator, a subscript tucked beside its symbol, a delimiter
    stretched across several rows — and no axis-aligned rectangle can tightly bound
    one word without catching its neighbours.

    Preferred over detecting "maths" by its characters, which misses the common case:
    TeX maps many maths glyphs onto ASCII codepoints, so a summation sign arrives
    indistinguishable from a capital X.
    """
    if not words:
        return 0.0

    overlapping = 0
    for w in words:
        area = _area(w)
        if area <= 0:
            continue
        for other in page_words.get(w.page, ()):
            if other.idx == w.idx:
                continue
            if _overlap_area(w, other) > _SIGNIFICANT_OVERLAP * min(area, _area(other)):
                overlapping += 1
                break
    return overlapping / len(words)


def page_word_map(words: tuple[Word, ...]) -> dict[int, list[Word]]:
    """Group a document's words by page, for repeated overlap queries."""
    out: dict[int, list[Word]] = {}
    for w in words:
        out.setdefault(w.page, []).append(w)
    return out


# Word boxes and rectangle bounds derive from the same glyph metrics, so centre
# containment needs only enough tolerance to absorb floating-point error.
_CENTRE_EPSILON = 0.5


def encloses_centre(rect, word: Word) -> bool:
    """Whether a rectangle contains a word's centre point.

    Centre containment rather than intersection: MuPDF's boxes include ascenders and
    descenders, so adjacent lines' boxes routinely touch even when the text does not.
    A word's centre is inside the rectangle that visually covers it, and no other.
    """
    if rect.page != word.page:
        return False
    cx = (word.x0 + word.x1) / 2
    cy = (word.y0 + word.y1) / 2
    return (
        rect.x0 - _CENTRE_EPSILON <= cx <= rect.x1 + _CENTRE_EPSILON
        and rect.y0 - _CENTRE_EPSILON <= cy <= rect.y1 + _CENTRE_EPSILON
    )
