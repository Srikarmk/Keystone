"""Page furniture: text on the page that is not part of what the document says."""

from __future__ import annotations

from keystone.ingest import Document, DocIndex
from keystone.ingest.furniture import detect

from .conftest import corpus_paths, requires_corpus

# The BERT paper's page one carries the rotated arXiv stamp, and its bibliography
# cites several arXiv preprints — so it exercises both the rule and its false positive.
BERT = "1810.04805.pdf"


def _load(name: str) -> Document:
    path = next(p for p in corpus_paths() if p.name == name)
    return Document.open(path)


@requires_corpus
def test_detects_the_rotated_arxiv_stamp():
    doc = _load(BERT)
    report = detect(doc)
    stamped = {doc.words[i].text for i in report.word_indices}
    assert any(t.startswith("arXiv:1810.04805") for t in stamped)
    assert report.reasons.get("arxiv_stamp")


@requires_corpus
def test_bibliography_arxiv_ids_are_not_furniture():
    """A reference citing an arXiv preprint matches the stamp pattern but is content.

    Excluding it would make bibliography entries unanchorable, and citation
    faithfulness checks need to anchor exactly those.
    """
    doc = _load(BERT)
    furniture = {doc.words[i].text for i in detect(doc).word_indices}
    bibliography_ids = {
        w.text for w in doc.words
        if w.text.startswith("arXiv:") and not w.text.startswith("arXiv:1810.04805")
    }
    assert bibliography_ids, "expected the reference list to cite arXiv preprints"
    assert not (bibliography_ids & furniture)


@requires_corpus
def test_excluding_furniture_makes_interrupted_prose_locatable():
    """The stamp lands mid-sentence in BERT's word stream.

    With it in the index, this sentence does not occur as a contiguous run of words
    anywhere in the document and no matcher could find it.
    """
    doc = _load(BERT)
    index = DocIndex(doc)
    sentence = (
        "The masked language model randomly masks some of the tokens from the input, "
        "and the objective is to predict the original vocabulary id of the masked "
        "word based only on its context."
    )
    assert index.locate(sentence).anchor is not None

    # Demonstrate the causal link rather than asserting it: with furniture retained,
    # the same sentence is unfindable.
    from dataclasses import replace

    assert DocIndex(replace(doc, furniture=frozenset())).locate(sentence).anchor is None


@requires_corpus
def test_furniture_is_a_small_fraction_of_a_document():
    """A rule that swallowed body text would quietly destroy recall everywhere."""
    for path in corpus_paths():
        doc = Document.open(path)
        share = len(doc.furniture) / max(1, len(doc.words))
        assert share < 0.05, f"{path.name}: {share:.1%} of words marked furniture"
