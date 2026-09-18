"""Checking that a paper's source and its PDF are the same document.

The gate exists because of one paper. arXiv:1909.08593 is *Fine-Tuning Language Models
from Human Preferences* and its e-print archive contains GPT-2's paper — a template the
authors reused without replacing the body. Nothing crashed: the dossier published seven
citation stances quoting sentences that appear nowhere in the PDF they pointed at.

These tests hold two properties. The obvious one is that a mismatch is caught. The one
that matters more is that a *correctly paired* paper is never rejected — a gate that
sometimes refuses real papers is worse than no gate, because the failure is silent.
"""

from __future__ import annotations

import pytest

from keystone.ingest.alignment import FLOOR, MIN_SENTENCES, Alignment, measure
from keystone.ingest.anchors import DocIndex
from keystone.ingest.pdf import Document

from .conftest import GATE_PAPERS, corpus_paths, requires_corpus


# ------------------------------------------------------------------ the verdict


def test_a_mismatched_source_is_flagged() -> None:
    got = Alignment(sampled=40, located=0)
    assert got.rate == 0.0
    assert got.decidable
    assert got.mismatched


def test_a_matching_source_is_not_flagged() -> None:
    assert not Alignment(sampled=40, located=31).mismatched  # the corpus's worst


def test_a_sample_too_small_to_judge_concludes_nothing() -> None:
    """A short paper is not a wrong paper, and must not be rejected as one."""
    got = Alignment(sampled=MIN_SENTENCES - 1, located=0)
    assert not got.decidable
    assert not got.mismatched


def test_no_anchorable_prose_at_all_concludes_nothing() -> None:
    got = Alignment(sampled=0, located=0)
    assert got.rate == 0.0
    assert not got.mismatched


# --------------------------------------------------------------- against the corpus


@requires_corpus
def test_every_gate_paper_passes(corpus) -> None:
    """The property that matters: no correctly paired paper is refused.

    Run over the gate corpus rather than a fixture, because the whole question is
    whether real typesetting — two columns, ligatures, stacked maths — can drag a
    genuine paper below the floor. Measured, the worst of them sits at 78% against a
    floor of 25%.
    """
    worst = 1.0
    for path, _doc, index in corpus:
        from keystone.ingest.arxiv_source import SourceUnavailable, load_project
        from .test_source_alignment import CACHE

        try:
            document, _project = load_project(path.stem, CACHE)
        except SourceUnavailable:
            continue  # no LaTeX to compare against; a different failure mode
        got = measure(document.text, index)
        assert not got.mismatched, f"{path.stem} refused at {got.rate:.0%}"
        worst = min(worst, got.rate)

    # A margin, not a hair: if this ever drops near the floor the gate has become a
    # coin toss and the floor needs revisiting rather than the papers.
    assert worst > FLOOR * 2, f"closest passing paper was {worst:.0%}, floor {FLOOR:.0%}"


@requires_corpus
def test_a_paper_measured_against_the_wrong_pdf_is_caught(corpus) -> None:
    """The real failure, reconstructed: one paper's source against another's PDF.

    This is exactly what arXiv:1909.08593 shipped, and it is the case no amount of
    unit testing of the extractors would have found.
    """
    from keystone.ingest.arxiv_source import load_project
    from .test_source_alignment import CACHE

    available = [path.stem for path in corpus_paths()]
    source_id = next(p for p in GATE_PAPERS if p in available)
    other_id = next(p for p in GATE_PAPERS if p in available and p != source_id)

    document, _project = load_project(source_id, CACHE)
    wrong_pdf = DocIndex(Document.open(next(
        path for path in corpus_paths() if path.stem == other_id
    )))

    got = measure(document.text, wrong_pdf)
    assert got.mismatched, (
        f"{source_id}'s source scored {got.rate:.0%} against {other_id}'s PDF"
    )


@requires_corpus
def test_the_sample_is_reproducible(corpus) -> None:
    """A gate whose verdict moves between runs is not a gate."""
    from keystone.ingest.arxiv_source import load_project
    from .test_source_alignment import CACHE

    path, _doc, index = corpus[0]
    document, _project = load_project(path.stem, CACHE)
    first = measure(document.text, index, seed=1)
    second = measure(document.text, index, seed=1)
    assert (first.sampled, first.located) == (second.sampled, second.located)
