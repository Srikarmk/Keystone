"""Text normalization for anchor resolution.

Everything downstream of this module trusts that a verbatim quote from a model can
be located in the PDF's own text. PDFs make that hard: ligatures are single glyphs,
words break across lines with hyphens, whitespace is arbitrary, and dashes/quotes
come in a dozen Unicode flavours.

The approach is a *skeleton* stream: a lossy, canonical projection of the page text
in which the unreliable characters are gone. Quotes are projected the same way and
matched against it. Skeleton characters map back to the word that produced them, so
a match resolves to word geometry.

Two skeletons are built per document:

- ``strict`` keeps hyphens (but drops a hyphen at end-of-line, which is real
  de-hyphenation). Preserves the minus sign, so ``-3.2`` and ``3.2`` stay distinct.
- ``loose`` drops every hyphen. Catches quotes where a hyphenated compound was
  broken across a line and the model reproduced it unbroken.
"""

from __future__ import annotations

import unicodedata

# NFKC already expands the standard ligatures (ﬁ -> fi). These are listed
# explicitly for the handful of fonts that emit private-use or non-decomposing
# variants, and to make the intent legible.
_LIGATURES = {
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi",
    "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st", "œ": "oe",
    "æ": "ae",
}

# Every Unicode dash-like codepoint folds to ASCII hyphen before the
# hyphen-handling policy is applied.
_DASHES = dict.fromkeys(
    "‐‑‒–—―−⁃﹣－", "-"
)

_QUOTES = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "′": "'", "″": '"', "«": '"', "»": '"',
}

# Zero-width and formatting characters that carry no meaning for matching.
# Written as escapes on purpose: these are invisible in an editor, and a stray
# literal copy-paste of one is impossible to review. U+00AD (soft hyphen) is a
# discretionary line-break marker rather than a dash, so it is deleted here.
_INVISIBLE = dict.fromkeys(
    "\u00ad\u200b\u200c\u200d\u2060\ufeff\u00a0\u202f\u2007\u2009", ""
)

_TRANSLATION = str.maketrans({**_LIGATURES, **_DASHES, **_QUOTES, **_INVISIBLE})


def skeletonize(text: str, *, drop_hyphens: bool = False) -> str:
    """Project text into the canonical matching space.

    Deletes all whitespace, folds case, expands ligatures, and unifies dashes and
    quotes. With ``drop_hyphens`` every hyphen is deleted too.

    The projection is idempotent and distributes over concatenation of
    whitespace-separated tokens, which is what lets a document skeleton be built
    word-by-word while a quote is projected in one pass:

        skeletonize(" ".join(words)) == "".join(skeletonize(w) for w in words)
    """
    # NFKD rather than NFKC: it expands ligatures like NFKC does, and additionally
    # decomposes accented characters into a base letter plus a combining mark, which
    # the loop below then drops. That folding matters more than it sounds. A PDF may
    # render the same accent precomposed in one place and as base-plus-mark in
    # another, and a combining mark is a separate glyph positioned above the line, so
    # extracting a region can return the base letter without its accent. Folding both
    # sides to the bare letter makes "f̄" and "f", or "ö" and "o", compare equal —
    # exactly what is wanted when locating text rather than interpreting it.
    folded = unicodedata.normalize("NFKD", text).translate(_TRANSLATION)
    out = []
    for ch in folded:
        if ch.isspace():
            continue
        if ch == "-" and drop_hyphens:
            continue
        if unicodedata.combining(ch):
            continue
        out.append(ch)
    return "".join(out).casefold()


def skeletonize_word(text: str, *, drop_hyphens: bool = False, line_end: bool = False) -> str:
    """Skeletonize a single PDF word.

    ``line_end`` marks the last word on a visual line: a trailing hyphen there is
    a typesetting artifact rather than part of the word, so it is dropped. This is
    the one place real de-hyphenation happens in ``strict`` mode.
    """
    skel = skeletonize(text, drop_hyphens=drop_hyphens)
    # De-hyphenation joins word *fragments*, so it only applies when something is left
    # to join. A word that is nothing but a dash is a real token — a table's "not
    # applicable" marker, a minus sign, an en-dash range — and erasing it would drop
    # it out of the index entirely, shifting every anchor that begins there.
    if line_end and not drop_hyphens and skel.endswith("-") and len(skel) > 1:
        skel = skel[:-1]
    return skel
