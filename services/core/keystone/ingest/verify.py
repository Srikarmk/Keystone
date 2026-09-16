"""Independent verification that a resolved anchor really covers its quote.

The matcher works in skeleton space; this module goes back the other way and asks
whether the rectangles it produced actually sit on the right text. The failure this
defends against is concrete: a user clicks "prove it", and the highlight lands in the
wrong place or misses half the sentence.

An anchor declares its own precision, and each level carries a different contract.
Verification holds the anchor to the contract it claimed — so a ``tight`` anchor whose
rectangles are not tight is a hard failure, and the self-report cannot be used to
excuse a defect. What it can do is stop the checker from demanding the impossible: in
stacked geometry no axis-aligned rectangle separates a numerator from its denominator,
and an anchor that says ``approximate`` is telling the truth about that.

``tight`` must satisfy all of:

* clipping each rectangle returns that rectangle's own words, in order
* every matched word's centre lies inside some rectangle
* no word outside the span has its centre inside any rectangle

``approximate`` must satisfy:

* most of the matched words' glyphs appear somewhere in the clipped text
* every matched word's centre lies inside some rectangle

Per-rect ordering is asserted only for ``tight`` anchors. MuPDF returns words in
content-stream order but clipped text in geometric order, and for a span crossing a
column, a table row, or a figure those orders legitimately differ; within one visual
line, order is unambiguous.
"""

from __future__ import annotations

import pymupdf

from .anchors import Anchor
from .normalize import skeletonize
from .pdf import Document
from .regions import encloses_centre

# Fraction of an approximate anchor's words whose glyphs must survive clipping.
APPROXIMATE_COVERAGE = 0.8


def text_in_rects(pdf_path, rects) -> str:
    """Ask MuPDF for the text inside each rectangle, in reading order."""
    chunks: list[str] = []
    with pymupdf.open(pdf_path) as doc:
        for rect in rects:
            clip = pymupdf.Rect(rect.x0, rect.y0, rect.x1, rect.y1)
            chunks.append(doc[rect.page].get_text("text", clip=clip))
    return " ".join(chunks)


def tokenize(text: str) -> list[str]:
    """Whitespace tokens in canonical matching form, empties dropped."""
    return [s for s in (skeletonize(t) for t in text.split()) if s]


def _is_ordered_subsequence(want: list[str], got: list[str]) -> bool:
    it = iter(got)
    return all(token in it for token in want)


def roundtrip(doc: Document, anchor: Anchor) -> tuple[bool, str, str]:
    """Hold an anchor to the contract its precision claims. Returns (ok, why, text)."""
    clipped: list[str] = []
    with pymupdf.open(doc.path) as pdf:
        for rect in anchor.rects:
            clip = pymupdf.Rect(rect.x0, rect.y0, rect.x1, rect.y1)
            extracted = pdf[rect.page].get_text("text", clip=clip)
            clipped.append(extracted)

            if anchor.precision != "tight":
                continue
            want, got = tokenize(rect.text), tokenize(extracted)
            if not want:
                return False, "rect has no comparable tokens", extracted
            if not _is_ordered_subsequence(want, got):
                return False, (
                    f"rect on page {rect.page + 1} does not cover its words "
                    f"({want} vs {got})"
                ), extracted

    joined = " ".join(clipped)
    span = range(anchor.word_start, anchor.word_end + 1)

    for word in (doc.words[i] for i in span):
        if not any(encloses_centre(r, word) for r in anchor.rects):
            return False, f"matched word {word.text!r} lies outside every rect", joined

    if anchor.precision == "tight":
        intruders = [
            w.text
            for w in doc.words
            if w.idx not in span
            and w.page in anchor.pages
            and any(encloses_centre(r, w) for r in anchor.rects)
        ]
        if intruders:
            return False, (
                f"anchor claims tight but rects also enclose {intruders[:6]}"
            ), joined
    else:
        # Glyph-level containment rather than token equality: clipping stacked maths
        # glues neighbouring glyphs together, so MuPDF returns "β1" where the word
        # list has "β" and "1" as separate words.
        #
        # A proportion rather than every word, because "approximate" is a claim about
        # the neighbourhood, not about each glyph. A superscript can sit above the
        # line box and be clipped away; the guarantee that still holds — and is
        # checked above for every word without exception — is that each word's centre
        # lies inside a rectangle.
        haystack = skeletonize(joined, drop_hyphens=True)
        needles = [skeletonize(doc.words[i].text, drop_hyphens=True) for i in span]
        needles = [n for n in needles if n]
        found = sum(1 for n in needles if n in haystack)
        if needles and found / len(needles) < APPROXIMATE_COVERAGE:
            return False, (
                f"only {found}/{len(needles)} matched words appear in clipped text"
            ), joined

    return True, "ok", joined
