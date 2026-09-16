"""Joining arXiv LaTeX source to PDF geometry.

Source gives exact equations, table numbers and citation keys; anchoring gives them
pixel coordinates. These tests gate the join between the two. They read the on-disk
e-print cache rather than the network, so they are reproducible and offline — run
``keystone source-audit`` once to populate it.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from keystone.ingest import Document, DocIndex
from keystone.ingest.arxiv_source import SourceUnavailable, unpack
from keystone.ingest.latex import anchorable_sentences, expand_inputs

from .conftest import CORPUS

CACHE = CORPUS.parent / "cache"

# Measured at 93.5% across the corpus. Gated below that so a real regression shows up
# without the suite failing on which sentences happen to be near the boundary.
GATE_ALIGNMENT_RATE = 90.0

requires_cache = pytest.mark.skipif(
    not (CACHE / "eprints").is_dir() or not list((CACHE / "eprints").glob("*.eprint")),
    reason=f"no e-print cache in {CACHE}; run `keystone source-audit`",
)


def _projects() -> list[tuple[str, str]]:
    """(identifier, expanded LaTeX) for every cached e-print that has real source."""
    out = []
    for archive in sorted((CACHE / "eprints").glob("*.eprint")):
        ident = archive.stem
        try:
            project = unpack(archive, CACHE / "unpacked" / ident)
        except SourceUnavailable:
            continue
        main = project.main.read_text(encoding="utf-8", errors="replace")
        if "\\includepdf" in main:
            continue
        out.append((ident, expand_inputs(main, project.read)))
    return out


@requires_cache
def test_source_sentences_anchor_into_the_pdf():
    total = anchored = 0

    for ident, latex in _projects():
        pdf = CORPUS / f"{ident}.pdf"
        if not pdf.exists():
            continue
        index = DocIndex(Document.open(pdf))
        for sentence in anchorable_sentences(latex):
            total += 1
            if index.locate(sentence).anchor is not None:
                anchored += 1

    assert total > 1000, "cache too small to gate on"
    rate = 100.0 * anchored / total
    assert rate >= GATE_ALIGNMENT_RATE, (
        f"source-to-PDF alignment {rate:.1f}% below gate {GATE_ALIGNMENT_RATE}% "
        f"({anchored}/{total})"
    )


@requires_cache
def test_source_yields_exact_equation_latex():
    """The whole point of reading source: equations no vision model has to guess at."""
    projects = dict(_projects())
    latex = projects.get("1706.03762")
    if latex is None:
        pytest.skip("Transformer paper not cached")

    from keystone.ingest.latex import TexDocument

    equations = TexDocument.parse(latex).equations
    assert equations, "expected display equations"
    attention = next(
        (e for e in equations if "softmax" in e.latex and "sqrt" in e.latex), None
    )
    assert attention is not None, "expected the scaled dot-product attention equation"
    assert "\\frac" in attention.latex and "d_k" in attention.latex


@requires_cache
def test_wrapper_submissions_are_reported_not_silently_empty():
    """A wrapper must raise, not return a document claiming the paper has no content."""
    wrapper = CACHE / "eprints" / "1412.6980.eprint"
    if not wrapper.exists():
        pytest.skip("Adam paper not cached")

    from keystone.ingest.arxiv_source import load

    with pytest.raises(SourceUnavailable):
        load("1412.6980", CACHE)
