"""The assumption detector against BioScope, and the guard that came out of it.

Scoring against an outside corpus is only worth doing if the findings come back into
the code. These tests hold the one defect it found — and, just as importantly, the
shape of the fix that was tried and measured *worse*, so it does not get tried again.
"""

from __future__ import annotations

from pathlib import Path

from keystone.eval.hedging import Report, Sentence, load, score
from keystone.lineage.assumptions import Kind, identify

BIOSCOPE = """<?xml version="1.0" encoding="utf-8"?>
<Annotation>
  <DocumentSet><Document>
    <DocumentPart type="Text">
      <sentence id="S1.1">Abstract</sentence>
      <sentence id="S1.2">Selenocysteine is genetically encoded by a stop codon in these organisms.</sentence>
      <sentence id="S1.3">It is tempting to ask <xcope id="X1"><cue type="speculation" ref="X1">whether</cue> the 23rd amino acid is left undiscovered</xcope>.</sentence>
      <sentence id="S1.4">The effect was <xcope id="X2"><cue type="negation" ref="X2">not</cue> observed</xcope> in the control group of this study.</sentence>
    </DocumentPart>
  </Document></DocumentSet>
</Annotation>
"""


# -------------------------------------------------------------------- the corpus


def test_a_sentence_keeps_its_cue_words_when_the_markup_is_removed(tmp_path: Path) -> None:
    """The cue is an inline element, so naive text extraction loses the word itself."""
    path = tmp_path / "b.xml"
    path.write_text(BIOSCOPE)
    got = {s.sentence_id: s for s in load(path)}
    assert "whether the 23rd amino acid" in got["S1.3"].text


def test_only_speculation_counts_as_uncertain(tmp_path: Path) -> None:
    """BioScope marks negation too, and negation is not hedging."""
    path = tmp_path / "b.xml"
    path.write_text(BIOSCOPE)
    got = {s.sentence_id: s for s in load(path)}
    assert got["S1.3"].uncertain
    assert not got["S1.4"].uncertain
    assert not got["S1.2"].uncertain


def test_headings_are_dropped(tmp_path: Path) -> None:
    """"Abstract" carries no claim, and counting it flatters both sides."""
    path = tmp_path / "b.xml"
    path.write_text(BIOSCOPE)
    assert "S1.1" not in {s.sentence_id for s in load(path)}


def test_a_missing_corpus_is_empty_rather_than_fatal(tmp_path: Path) -> None:
    assert load(tmp_path / "nowhere.xml") == []


# -------------------------------------------------------------------- the metrics


def test_precision_counts_only_what_was_flagged() -> None:
    got = score("t", [
        Sentence("1", "We assume the data is independent and identically distributed.", True, ("assume",)),
        Sentence("2", "The temperature was measured at three points along the axis.", False, ()),
    ])
    assert got.flagged == 1
    assert got.precision == 1.0
    # Recall is over BioScope's speculative sentences, not over the corpus.
    assert got.gold == 1


def test_a_corpus_nothing_is_flagged_in_scores_zero_not_one() -> None:
    got = score("t", [Sentence("1", "The temperature was measured along the axis.", True, ("may",))])
    assert got.flagged == 0
    assert got.precision == 0.0
    assert got.f1 == 0.0


# ---------------------------------------------------- what the corpus found


def test_a_duration_is_not_a_precondition() -> None:
    r"""BioScope's abstracts: "retained the virus in the latent state for as long as
    45 days". "as long as" takes a quantity as readily as a condition and the two mean
    opposite things; reading this one as a precondition invents an assumption.
    """
    assert identify(
        "The combined use of the two inhibitors retained the virus in the latent "
        "state for as long as 45 days.",
        {},
    ) is None


def test_a_real_precondition_still_registers() -> None:
    found = identify(
        "The method is consistent as long as the noise is independent of the input.",
        {},
    )
    assert found is not None and found[0] is Kind.CONDITIONAL


def test_a_precondition_stated_about_the_subject_matter_is_kept() -> None:
    """The fix that was tried and measured worse.

    Requiring a conditional cue to sit near a first-person subject — the check that
    works so well for comparative cues in the stance rules — drops 13 of the library's
    23 conditional assumptions to remove one false positive, because a paper states
    its preconditions about its subject matter and not about itself. These two are
    from Batch Normalization and from AI safety via debate, and both mention nobody.
    """
    for sentence in (
        "The distributions of values of any x has the expected value of 0 and the "
        "variance of 1, as long as the elements of each mini-batch are sampled from "
        "the same distribution.",
        "Debate only works if this revealed context cannot be a lie.",
    ):
        found = identify(sentence, {})
        assert found is not None and found[0] is Kind.CONDITIONAL, sentence


def test_the_report_survives_an_empty_corpus() -> None:
    got = Report(corpus="t")
    assert got.precision == 0.0
    assert got.recall == 0.0
    assert got.coverage == 0.0
