"""PDF geometry extraction — the ground truth every anchor resolves against."""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

import pymupdf


@dataclass(frozen=True, slots=True)
class Word:
    """One positioned word, as MuPDF sees it."""

    idx: int  # index into Document.words, stable for the life of the document
    page: int  # 0-based
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    block: int
    line: int
    is_line_end: bool  # last word on its visual line -> a trailing hyphen is a break

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (self.x0, self.y0, self.x1, self.y1)


@dataclass(frozen=True, slots=True)
class PageGeom:
    number: int
    width: float
    height: float


@dataclass(frozen=True, slots=True)
class Document:
    path: Path
    pages: tuple[PageGeom, ...]
    words: tuple[Word, ...]
    furniture: frozenset[int] = frozenset()
    """Indices of words that are page furniture rather than body text.

    Running heads, page numbers, and the rotated arXiv stamp. Populated by
    :mod:`keystone.ingest.furniture`, which cannot be imported here without a cycle,
    so :meth:`open` fills it in after construction.
    """

    @classmethod
    def open(cls, path: str | Path) -> Document:
        path = Path(path)
        pages: list[PageGeom] = []
        words: list[Word] = []

        with pymupdf.open(path) as doc:
            for pno, page in enumerate(doc):
                rect = page.rect  # already accounts for /Rotate
                pages.append(PageGeom(number=pno, width=rect.width, height=rect.height))

                # Deliberately NOT sort=True. MuPDF returns words in block/line order,
                # which follows the content stream and therefore keeps multi-column
                # layouts intact. Sorting by (y, x) would interleave the columns of a
                # two-column paper and corrupt every span that crosses a line.
                raw = page.get_text("words")
                start = len(words)
                for x0, y0, x1, y1, text, block, line, _wno in raw:
                    words.append(
                        Word(
                            idx=len(words), page=pno,
                            x0=x0, y0=y0, x1=x1, y1=y1,
                            text=text, block=block, line=line,
                            is_line_end=False,  # patched below
                        )
                    )
                _mark_line_ends(words, start)

        doc = cls(path=path, pages=tuple(pages), words=tuple(words))

        from .furniture import detect  # deferred: furniture reads Document

        return replace(doc, furniture=detect(doc).word_indices)

    def is_body(self, word: Word) -> bool:
        return word.idx not in self.furniture

    def words_on(self, page: int) -> tuple[Word, ...]:
        return tuple(w for w in self.words if w.page == page)


def _mark_line_ends(words: list[Word], start: int) -> None:
    """Set is_line_end on the last word of each (block, line) run, in place."""
    for i in range(start, len(words)):
        w = words[i]
        nxt = words[i + 1] if i + 1 < len(words) else None
        last = (
            nxt is None
            or nxt.page != w.page
            or (nxt.block, nxt.line) != (w.block, w.line)
        )
        if last:
            words[i] = Word(
                idx=w.idx, page=w.page, x0=w.x0, y0=w.y0, x1=w.x1, y1=w.y1,
                text=w.text, block=w.block, line=w.line, is_line_end=True,
            )
