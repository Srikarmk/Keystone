"""The lineage layer: assumptions a paper states, and edges to papers it leans on."""

from __future__ import annotations

import pytest

from keystone.graph.models import Section, SectionKind
from keystone.ingest.bibliography import Reference
from keystone.ingest.sections import extract_sections
from keystone.lineage import assumptions as A
from keystone.lineage import graph as G
from keystone.lineage.stance import Stance


# --------------------------------------------------------------------------- titles


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("Attention Is All You Need", "Attention is all you need"),
        ("Layer Normalization", "Layer normalization."),
        ("BERT: Pre-training of Deep Bidirectional Transformers",
         "BERT: pre-training of deep bidirectional transformers"),
        ("Deep residual learning for image\nrecognition",
         "Deep Residual Learning for Image Recognition"),
    ],
)
def test_titles_fold_together(left: str, right: str) -> None:
    """Styles disagree about case and punctuation; they agree about the words."""
    assert G.fold(left) == G.fold(right)


def test_folding_does_not_merge_different_papers() -> None:
    """An exact match on the folded form, not a similarity score."""
    assert G.fold("Layer normalization") != G.fold("Recurrent batch normalization")
    assert G.fold("Attention is all you need") != G.fold("Attention is not all you need")


# ----------------------------------------------------------------------- assumptions


@pytest.mark.parametrize(
    ("sentence", "kind"),
    [
        (r"We hypothesize that it is easier to optimize the residual mapping than to "
         r"optimize the original, unreferenced mapping.", A.Kind.STATED),
        (r"If we assume that $x$ and $u$ are Gaussian and uncorrelated, then both "
         r"quantities coincide.", A.Kind.STATED),
        (r"Without loss of generality, we denote $F$ as the Fisher information matrix "
         r"of the normalized model.", A.Kind.SIMPLIFYING),
        (r"We focus on transforms that consist of an affine transformation followed by "
         r"an element-wise nonlinearity.", A.Kind.SIMPLIFYING),
        (r"It is well known that deeper networks are harder to optimize than shallow "
         r"ones of equal width.", A.Kind.CONVENTIONAL),
        (r"We conjecture that the deep plain nets may have exponentially low "
         r"convergence rates.", A.Kind.CONJECTURAL),
        (r"The estimator is unbiased provided that the elements of each mini-batch are "
         r"sampled independently.", A.Kind.CONDITIONAL),
    ],
)
def test_identifies_stated_assumptions(sentence: str, kind: A.Kind) -> None:
    found = A.identify(sentence, {})
    assert found is not None
    assert found[0] is kind


@pytest.mark.parametrize(
    "sentence",
    [
        # Removing an assumption is not making one.
        r"We do not assume that the data is independent and identically distributed.",
        # Ordinary prose that happens to contain the vocabulary.
        r"The independence assumption of prior work is violated in this setting, which "
        r"we demonstrate in our ablation study over four datasets.",
        # A biconditional inside a lemma is the theorem's statement, not a precondition
        # the paper is taking on; including these made every lemma an assumption.
        r"There exists a function $f$ such that $h(X) = h(Y)$ if and only if the "
        r"multisets $X$ and $Y$ have the same distribution.",
    ],
)
def test_does_not_invent_assumptions(sentence: str) -> None:
    assert A.identify(sentence, {}) is None


def test_support_is_what_the_sentence_offers() -> None:
    kinds = {"tab:main": "table", "fig:loss": "figure", "sec:method": "section"}

    assert A.support_for(r"We assume this holds \cite{ba2016layer}.", kinds) is A.Support.CITED
    assert A.support_for(r"We assume this holds, as Table~\ref{tab:main} shows.", kinds) is A.Support.SHOWN
    assert A.support_for(r"We assume this holds, see Figure~\ref{fig:loss}.", kinds) is A.Support.SHOWN
    # A reference to a section is navigation, not evidence.
    assert A.support_for(r"We assume this holds; see Section~\ref{sec:method}.", kinds) is A.Support.BARE
    assert A.support_for(r"We assume this holds.", kinds) is A.Support.BARE


def test_extract_reports_the_cue_and_tallies() -> None:
    latex = r"""
\section{Method}
We hypothesize that residual mappings are easier to optimize than unreferenced ones,
which is the central premise of this paper's design.
For simplicity, we present the argument for fully-connected layers only, though it
applies equally to convolutional ones as stated here.
We assume the inputs are whitened, which Table~\ref{tab:stats} establishes for every
dataset we evaluate on in this work.
"""
    sections = extract_sections(latex)
    got = A.extract(latex, sections, {"tab:stats": "table"})
    tally = A.tally(got)

    assert tally["total"] == 3
    assert tally["bare"] == 2
    assert tally["shown"] == 1
    assert {a.kind for a in got} == {A.Kind.STATED, A.Kind.SIMPLIFYING}
    # The cue is reported verbatim so the reader can judge the call themselves.
    assert any(a.cue.lower() == "we hypothesize" for a in got)


# ----------------------------------------------------------------------------- edges


def _paper() -> tuple[str, tuple[Section, ...]]:
    latex = r"""
\section{Introduction}
Unlike recurrent architectures \cite{hochreiter1997lstm}, our model dispenses with
recurrence entirely and relies on attention alone throughout the network.
\section{Our Architecture}
We employ a residual connection \cite{he2016resnet} around each of the two
sub-layers, followed by layer normalization \cite{ba2016layer}.
\section{Experiments}
We compare against the strongest published result \cite{wu2016gnmt} on the same split.
"""
    return latex, extract_sections(latex)


_REFERENCES = [
    Reference(key="he2016resnet", raw="K. He et al.",
              title="Deep residual learning for image recognition", year=2016),
    Reference(key="ba2016layer", raw="J. Ba et al.", title="Layer normalization",
              year=2016, arxiv_id="1607.06450"),
    Reference(key="hochreiter1997lstm", raw="S. Hochreiter et al.",
              title="Long short-term memory", year=1997),
    Reference(key="wu2016gnmt", raw="Y. Wu et al.",
              title="Google's neural machine translation system", year=2016),
]

_CORPUS_TITLES = {
    "1512.03385": "Deep Residual Learning for Image Recognition",
    "1607.06450": "Layer Normalization",
}


def test_edges_carry_stance_and_quote() -> None:
    latex, sections = _paper()
    lineage = G.build(latex, sections, _REFERENCES, corpus=frozenset(_CORPUS_TITLES),
                      corpus_titles=_CORPUS_TITLES)

    by_key = {edge.key: edge for edge in lineage.edges}
    assert by_key["he2016resnet"].stance is Stance.INHERITS
    assert by_key["ba2016layer"].stance is Stance.INHERITS
    assert by_key["hochreiter1997lstm"].stance is Stance.CONTESTS
    assert by_key["wu2016gnmt"].stance is Stance.COMPARES
    assert "residual connection" in by_key["he2016resnet"].sentence


def test_a_cited_work_resolves_by_title_when_it_has_no_arxiv_id() -> None:
    """The reason the graph was empty: these papers cite conference versions.

    ResNet's entry in the Transformer's bibliography carries no arXiv identifier, so
    keying traversability off identifiers alone found one edge in the whole library.
    """
    latex, sections = _paper()
    lineage = G.build(latex, sections, _REFERENCES, corpus=frozenset(_CORPUS_TITLES),
                      corpus_titles=_CORPUS_TITLES)

    resnet = next(e for e in lineage.edges if e.key == "he2016resnet")
    assert resnet.arxiv_id == "1512.03385"
    assert resnet.in_corpus

    # An uncited-by-the-corpus work stays exactly as the bibliography had it.
    lstm = next(e for e in lineage.edges if e.key == "hochreiter1997lstm")
    assert lstm.arxiv_id is None
    assert not lstm.in_corpus


def test_foundation_prefers_the_method_section() -> None:
    """Where a dependency is admitted says what kind of dependency it is."""
    latex, sections = _paper()
    lineage = G.build(latex, sections, _REFERENCES, corpus=frozenset(_CORPUS_TITLES),
                      corpus_titles=_CORPUS_TITLES)

    foundation = lineage.foundation
    assert foundation is not None
    assert foundation.section_kind is SectionKind.METHOD
    assert foundation.stance.is_load_bearing


def test_background_is_counted_not_listed() -> None:
    latex = r"""
\section{Related Work}
Transformers have been applied to many tasks \cite{vaswani2017}.
The dataset was released in 2015 \cite{russakovsky2015}.
"""
    sections = extract_sections(latex)
    lineage = G.build(latex, sections, [])
    assert lineage.edges == ()
    assert lineage.background == 2


def test_cross_edges_only_returns_walkable_ones() -> None:
    latex, sections = _paper()
    lineage = G.build(latex, sections, _REFERENCES, corpus=frozenset(_CORPUS_TITLES),
                      corpus_titles=_CORPUS_TITLES)

    edges = G.cross_edges({"1706.03762": lineage}, {"1706.03762": "Transformer"})
    assert {e["to"] for e in edges} == {"1512.03385", "1607.06450"}
    assert all(e["from"] == "1706.03762" for e in edges)
    assert all(e["sentence"] for e in edges)


def test_positional_method_inference() -> None:
    """A section titled after its own contribution still has to type as the method."""
    latex = r"""
\section{Introduction}
Deeper networks are harder to train than shallow ones of comparable width.
\section{Deep Residual Learning}
We adopt batch normalization right after each convolution and before activation.
\section{Experiments}
We evaluate on ImageNet and report top-one error.
"""
    kinds = {s.title: s.kind for s in extract_sections(latex)}
    assert kinds["Deep Residual Learning"] is SectionKind.METHOD
    assert kinds["Introduction"] is SectionKind.INTRODUCTION
    assert kinds["Experiments"] is SectionKind.EXPERIMENTS


def test_foundation_breaks_a_tie_by_first_mention() -> None:
    """The Transformer's headline was decided by alphabetical order of citation key.

    Four of its adoptions sit in the method section, all anchored and all in the
    library, so every other test came out level and "stands on" landed on Inception —
    cited once, for label smoothing. A paper describes what its architecture is built
    from before it reaches training details, so first mention is the discriminator.
    """
    latex = r"""
\section{Introduction}
Deeper networks are harder to train than shallow ones of comparable width.
\section{Our Architecture}
We employ a residual connection \cite{he2016resnet} around each of the two
sub-layers, followed by layer normalization \cite{ba2016layer}.
\subsection{Regularization}
During training we employed label smoothing \cite{szegedy2015rethinking} of value 0.1.
\section{Experiments}
We evaluate on WMT and report BLEU.
"""
    references = [
        Reference(key="he2016resnet", raw="K. He", title="Deep Residual Learning",
                  year=2016, arxiv_id="1512.03385"),
        Reference(key="ba2016layer", raw="J. Ba", title="Layer Normalization",
                  year=2016, arxiv_id="1607.06450"),
        Reference(key="szegedy2015rethinking", raw="C. Szegedy",
                  title="Rethinking the Inception Architecture", year=2015,
                  arxiv_id="1512.00567"),
    ]
    corpus = {
        "1512.03385": "Deep Residual Learning",
        "1607.06450": "Layer Normalization",
        "1512.00567": "Rethinking the Inception Architecture",
    }
    lineage = G.build(latex, extract_sections(latex), references,
                      corpus=frozenset(corpus), corpus_titles=corpus)

    # All three are method-section adoptions in the library, so only position separates
    # them — and the residual connection is named first.
    assert {e.section_kind for e in lineage.edges} == {SectionKind.METHOD}
    foundation = lineage.foundation
    assert foundation is not None
    assert foundation.key == "he2016resnet", foundation.title


def test_the_strongest_mention_keeps_the_earliest_position() -> None:
    """A work cited in the method and again in the appendix is placed at the first."""
    latex = r"""
\section{Our Method}
We adopt batch normalization \cite{ioffe2015} after every convolution.
\section{Appendix}
We repeat the ablation of \cite{ioffe2015} on a second dataset.
"""
    lineage = G.build(latex, extract_sections(latex), [
        Reference(key="ioffe2015", raw="S. Ioffe", title="Batch Normalization"),
    ])
    edge = next(e for e in lineage.edges if e.key == "ioffe2015")
    assert edge.section_kind is SectionKind.METHOD
    assert edge.ordinal == 1
