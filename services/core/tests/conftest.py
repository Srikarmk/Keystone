"""Shared fixtures. The anchor gates run against real papers, not synthetic PDFs.

Synthetic fixtures would not exercise what actually breaks anchoring: ligatures,
hyphenated line breaks, two-column layouts, stacked maths, rotated axis labels,
combining diacritics. Those only show up in documents produced by real typesetting,
so the corpus is ten arXiv PDFs fetched by ``eval/fetch_corpus.sh``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from keystone.ingest import Document, DocIndex

CORPUS = Path(__file__).resolve().parents[3] / "eval" / "corpus" / "pdf"


def corpus_paths() -> list[Path]:
    return sorted(CORPUS.glob("*.pdf"))


requires_corpus = pytest.mark.skipif(
    not corpus_paths(),
    reason=f"no PDFs in {CORPUS}; run eval/fetch_corpus.sh",
)


@pytest.fixture(scope="session")
def corpus() -> list[tuple[Path, Document, DocIndex]]:
    """Every corpus paper, parsed and indexed once for the whole session."""
    out = []
    for path in corpus_paths():
        doc = Document.open(path)
        out.append((path, doc, DocIndex(doc)))
    return out
