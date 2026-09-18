"""Growing the library along its own citations.

The ranking decides which papers get ingested next, and the whole value of the graph
is in *walkable* edges — both ends in the library — so picking badly costs an edge per
paper. These are pure functions over dossier payloads, so they need no network and no
corpus.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from keystone.cli import (
    _write_lineage_index,
    attested_titles,
    rank_candidates,
    resolve_titles,
    survey,
)
from keystone.ingest.latex import document_title, longest_anchorable_run


def _dossier(
    ident: str,
    *,
    title: str = "",
    references: list[dict] | None = None,
    edges: list[dict] | None = None,
) -> dict:
    return {
        "id": ident,
        "title": title or ident,
        "references": references or [],
        "lineage": {"tally": {}, "foundation": None, "edges": edges or []},
        "assumptionTally": {"total": 0, "cited": 0, "shown": 0, "bare": 0},
    }


def _reference(ident: str, title: str = "") -> dict:
    return {"arxivId": ident, "title": title, "raw": f"raw for {ident}"}


def _edge(ident: str, *, stance: str = "inherits", in_corpus: bool = False) -> dict:
    return {
        "arxivId": ident,
        "title": f"title for {ident}",
        "stance": stance,
        "cue": "we use",
        "sentence": f"we use the method of {ident} throughout",
        "section": "Method",
        "inCorpus": in_corpus,
        "anchor": None,
    }


# ------------------------------------------------------------------------ surveying


def test_a_work_cited_many_times_by_one_paper_is_one_vote() -> None:
    """Otherwise a paper that mentions the same work eight times decides the ranking."""
    payload = _dossier(
        "1706.03762",
        references=[_reference("1512.03385"), _reference("1512.03385")],
        edges=[_edge("1512.03385"), _edge("1512.03385")],
    )
    cited, _stanced, _titles = survey([payload], have={"1706.03762"})
    assert cited["1512.03385"] == 1


def test_papers_already_in_the_library_are_not_candidates() -> None:
    payload = _dossier(
        "1706.03762",
        references=[_reference("1512.03385"), _reference("1607.06450")],
    )
    cited, _stanced, _titles = survey([payload], have={"1706.03762", "1512.03385"})
    assert set(cited) == {"1607.06450"}


def test_a_title_is_recovered_for_every_candidate() -> None:
    """A citation key is not a title, and the ranking output has to be readable."""
    payload = _dossier(
        "1706.03762",
        references=[_reference("1512.03385", "Deep residual learning"), _reference("9999.99999")],
    )
    _cited, _stanced, titles = survey([payload], have={"1706.03762"})
    assert titles["1512.03385"] == "Deep residual learning"
    # No title in the bibliography entry, so the raw text stands in rather than nothing.
    assert titles["9999.99999"].startswith("raw for")


# ------------------------------------------------------------------------- ranking


def test_stanced_candidates_come_first() -> None:
    """A paper the library already says something about arrives with an edge attached."""
    payloads = [
        _dossier("1706.03762", references=[_reference("A"), _reference("B")],
                 edges=[_edge("B")]),
        _dossier("1810.04805", references=[_reference("A")]),
    ]
    cited, stanced, _titles = survey(payloads, have={"1706.03762", "1810.04805"})

    # A is cited twice but stanced never; B is cited once and stanced once.
    assert cited["A"] == 2
    assert stanced["A"] == 0
    assert rank_candidates(cited, stanced, stanced_only=False) == ["B", "A"]


def test_citation_count_breaks_ties_among_stanced_candidates() -> None:
    payloads = [
        _dossier("p1", references=[_reference("A"), _reference("B")], edges=[_edge("A"), _edge("B")]),
        _dossier("p2", references=[_reference("A")], edges=[_edge("A")]),
    ]
    cited, stanced, _titles = survey(payloads, have={"p1", "p2"})
    assert rank_candidates(cited, stanced) == ["A", "B"]


def test_stanced_only_excludes_merely_mentioned_work() -> None:
    payloads = [_dossier("p1", references=[_reference("A"), _reference("B")], edges=[_edge("B")])]
    cited, stanced, _titles = survey(payloads, have={"p1"})
    assert rank_candidates(cited, stanced, stanced_only=True) == ["B"]


def test_hand_picked_extras_are_appended_not_interleaved() -> None:
    """Hub papers densify the graph once in, but nothing stances them yet."""
    payloads = [_dossier("p1", references=[_reference("A")], edges=[_edge("A")])]
    cited, stanced, _titles = survey(payloads, have={"p1"})

    ranked = rank_candidates(cited, stanced, extra=["HUB1", "HUB2"])
    assert ranked[0] == "A"
    assert set(ranked[1:]) == {"HUB1", "HUB2"}


def test_an_extra_already_cited_is_not_duplicated() -> None:
    payloads = [_dossier("p1", references=[_reference("A")], edges=[_edge("A")])]
    cited, stanced, _titles = survey(payloads, have={"p1"})
    assert rank_candidates(cited, stanced, extra=["A"]) == ["A"]


# ------------------------------------------------------------------- library graph


def test_lineage_index_only_keeps_walkable_edges(tmp_path: Path) -> None:
    """An edge is drawable only when both ends have been ingested."""
    (tmp_path / "1706.03762.json").write_text(json.dumps(_dossier(
        "1706.03762",
        title="Attention Is All You Need",
        edges=[
            _edge("1607.06450", in_corpus=True),   # in the library
            _edge("1512.99999", in_corpus=False),  # not ingested
        ],
    )))
    (tmp_path / "1607.06450.json").write_text(json.dumps(
        _dossier("1607.06450", title="Layer Normalization")
    ))

    count = _write_lineage_index(tmp_path)
    graph = json.loads((tmp_path / "lineage.json").read_text())

    assert count == 1
    assert [e["to"] for e in graph["edges"]] == ["1607.06450"]
    assert {n["id"] for n in graph["nodes"]} == {"1706.03762", "1607.06450"}
    # The sentence travels with the edge: an edge the reader cannot check is a diagram.
    assert graph["edges"][0]["sentence"]


def test_lineage_index_ignores_library_level_files(tmp_path: Path) -> None:
    """index.json, lineage.json and the prose files share this directory.

    Reading one of them as a paper is how a junk /paper/lineage route got built once
    already.
    """
    (tmp_path / "1706.03762.json").write_text(json.dumps(_dossier("1706.03762")))
    (tmp_path / "index.json").write_text(json.dumps([{"id": "1706.03762"}]))
    (tmp_path / "1706.03762.context.json").write_text(json.dumps({"id": "1706.03762"}))

    _write_lineage_index(tmp_path)
    graph = json.loads((tmp_path / "lineage.json").read_text())
    assert [n["id"] for n in graph["nodes"]] == ["1706.03762"]


def test_lineage_index_drops_self_edges(tmp_path: Path) -> None:
    """A paper citing its own earlier version is not a relationship between papers."""
    (tmp_path / "1706.03762.json").write_text(json.dumps(_dossier(
        "1706.03762", edges=[_edge("1706.03762", in_corpus=True)]
    )))
    assert _write_lineage_index(tmp_path) == 0


# --------------------------------------------------------------- ingest primitives


def test_document_title_is_read_from_the_source() -> None:
    """Resolving a citation to an ingested paper is done on titles, so they must be exact."""
    latex = r"""
\documentclass{article}
\title{Attention Is All You Need\thanks{Equal contribution.}}
\author{Ashish Vaswani}
\begin{document}\maketitle\end{document}
"""
    assert document_title(latex) == "Attention Is All You Need"


def test_document_title_survives_a_line_break_and_markup() -> None:
    latex = r"\title{Deep Residual Learning\\ for \emph{Image} Recognition}"
    assert document_title(latex) == "Deep Residual Learning for Image Recognition"


def test_document_title_is_empty_when_there_is_none() -> None:
    assert document_title(r"\documentclass{article}\begin{document}hi\end{document}") == ""


def test_longest_anchorable_run_skips_the_citation() -> None:
    """A citation renders as "[11]" on the page, so the stripped sentence has a hole.

    Anchoring the whole sentence failed on sentences that are plainly present; taking
    the longest citation-free run matches the PDF character for character.
    """
    raw = (
        r"We employ a residual connection \cite{he2016resnet} around each of the two "
        r"sub-layers, followed by layer normalization \cite{ba2016layer}."
    )
    run = longest_anchorable_run(raw)
    assert run == "around each of the two sub-layers, followed by layer normalization"
    assert "cite" not in run


def test_longest_anchorable_run_refuses_when_there_is_no_prose() -> None:
    """A sentence that is mostly citations has nothing to anchor to."""
    assert longest_anchorable_run(r"See \cite{a}, \cite{b} and \cite{c}.") == ""


# --------------------------------------------------------- title attestation


def test_attested_titles_come_from_the_librarys_bibliographies() -> None:
    payloads = [
        _dossier("p1", references=[_reference("1607.06450", "Layer normalization")]),
        _dossier("p2", references=[_reference("1607.06450", "Layer Normalization")]),
    ]
    attested = attested_titles(payloads)
    assert sum(attested["1607.06450"].values()) == 2


def test_a_papers_own_title_is_not_evidence_about_itself() -> None:
    """arXiv:1909.08593 is "Fine-Tuning Language Models from Human Preferences".

    Its LaTeX says `\\icmltitle{Language Models are Unsupervised Multitask Learners}`
    — a stale ICML template copied from GPT-2. Resolving on that would point every
    citation of GPT-2 at the wrong paper.
    """
    payloads = [
        _dossier("p1", references=[
            _reference("1909.08593", "Fine-tuning language models from human preferences"),
            _reference("1902.99999", "Language models are unsupervised multitask learners"),
        ]),
    ]
    attested = attested_titles(payloads)

    # The stale title is attested for GPT-2's identifier, not for this one.
    assert "Fine-tuning language models from human preferences" in attested["1909.08593"]
    assert "Language models are unsupervised multitask learners" not in attested["1909.08593"]


def test_a_papers_name_is_often_a_macro() -> None:
    r"""\title{\bertscore: ...} strips to ": ..." unless the macro is expanded first."""
    latex = r"""
\newcommand{\bertscore}{BERTScore}
\title{\bertscore: Evaluating Text Generation with BERT}
"""
    assert document_title(latex) == "BERTScore: Evaluating Text Generation with BERT"


# ------------------------------------------------------------- title resolution


def test_attested_title_beats_the_papers_own_claim() -> None:
    """The stale-template case, which would otherwise mis-point every GPT-2 citation."""
    resolved = resolve_titles(
        library={"1909.08593"},
        own={"1909.08593": "Language Models are Unsupervised Multitask Learners"},
        attested={"1909.08593": Counter({"Fine-tuning language models from human preferences": 3})},
    )
    assert resolved["1909.08593"] == "Fine-tuning language models from human preferences"


def test_an_unattested_paper_still_resolves_by_its_own_title() -> None:
    """Requiring attestation outright cost nine real edges.

    A reference can only attest when it already carries an arXiv identifier, and those
    are exactly the references that never needed a title match — so the strict rule
    withheld resolution from the papers that depend on it.
    """
    resolved = resolve_titles(
        library={"1607.06450"},
        own={"1607.06450": "Layer Normalization"},
        attested={},
    )
    assert resolved["1607.06450"] == "Layer Normalization"


def test_a_self_claimed_title_owned_by_another_paper_is_refused() -> None:
    """The collision guard: ambiguity resolves to nothing, as everywhere else here."""
    stale = "Language Models are Unsupervised Multitask Learners"
    resolved = resolve_titles(
        library={"1909.08593"},
        own={"1909.08593": stale},
        # Some bibliography ties that name to a different identifier.
        attested={"1902.00001": Counter({stale: 2})},
    )
    assert "1909.08593" not in resolved


def test_two_library_papers_claiming_one_name_both_lose() -> None:
    resolved = resolve_titles(
        library={"A", "B"},
        own={"A": "Layer Normalization", "B": "layer normalization."},
        attested={},
    )
    assert resolved == {}


def test_resolution_never_covers_papers_outside_the_library() -> None:
    """`in_corpus` is read off these keys, so a stray entry becomes a dead link.

    Attestation spans every cited work — five hundred of them — and letting those in
    marked them all walkable.
    """
    resolved = resolve_titles(
        library={"1607.06450"},
        own={},
        attested={
            "1607.06450": Counter({"Layer normalization": 2}),
            "9999.12345": Counter({"Some paper nobody ingested": 5}),
        },
    )
    assert set(resolved) == {"1607.06450"}


def test_lineage_index_ignores_any_non_paper_file(tmp_path: Path) -> None:
    """Matched on the identifier's shape, not against a list of known names.

    The exclusion list was already one file behind: `accuracy.json` was added to the
    dossier directory and the next build read it as a paper and crashed.
    """
    (tmp_path / "1706.03762.json").write_text(json.dumps(_dossier("1706.03762")))
    (tmp_path / "accuracy.json").write_text(json.dumps({"labelled": 90}))
    (tmp_path / "index.json").write_text(json.dumps([{"id": "1706.03762"}]))
    (tmp_path / "some-notes.json").write_text(json.dumps({"anything": True}))

    _write_lineage_index(tmp_path)
    graph = json.loads((tmp_path / "lineage.json").read_text())
    assert [n["id"] for n in graph["nodes"]] == ["1706.03762"]
