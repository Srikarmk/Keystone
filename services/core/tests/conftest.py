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

#: The gate corpus, named explicitly.
#:
#: These were chosen for layout diversity — single and two column, dense display
#: maths, wide benchmark tables, rotated axis labels, ligatures and combining
#: diacritics — and the anchor gate's 99.94% is measured against exactly them.
#:
#: Globbing the directory instead was a mistake that took a while to surface: the
#: reader's library and the test corpus share a folder, so `keystone expand` silently
#: quadrupled what the gates measured, and a number reported as a regression threshold
#: changed meaning without anyone touching a test. A gate whose population moves is
#: not a gate.
GATE_PAPERS = (
    "1706.03762",  # Attention Is All You Need — single column, wide tables
    "1810.04805",  # BERT — two column, figure with rotated labels
    "1512.03385",  # ResNet — two column, dense benchmark tables
    "1412.6980",   # Adam — display maths throughout, stacked fractions
    "2010.11929",  # ViT — rotated axis labels, many plots
    "1409.1556",   # VGG — tight leading, long reference list
    "1502.03167",  # Batch Normalization — inline maths in prose
    "1810.00826",  # How Powerful are GNNs — theorem environments
    "2203.02155",  # InstructGPT — long appendices, verbatim transcripts
    "1607.06450",  # Layer Normalization — matrix displays, PUA delimiter glyphs
)


def corpus_paths() -> list[Path]:
    """The gate corpus, in a fixed order, skipping any that has not been fetched."""
    paths = [CORPUS / f"{ident}.pdf" for ident in GATE_PAPERS]
    return [path for path in paths if path.exists()]


def library_paths() -> list[Path]:
    """Every paper on disk, for measurements that should widen as the library grows."""
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
