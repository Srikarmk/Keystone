"""What a paper says about the work it cites.

Every case here is either a real sentence from the corpus or the minimal shape of one
that the classifier got wrong. The failures are the point: a cue read out of position
does not produce a vague answer, it produces a confident opposite one.
"""

from __future__ import annotations

import pytest

from keystone.ingest.sections import extract_sections
from keystone.lineage.stance import Stance, classify, contexts, strongest
from keystone.lineage.stance import CitationContext
from keystone.graph.models import SectionKind


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        # --- straightforward, from the corpus ---
        ("Unlike recent language representation models ",
         " , BERT is designed to pre-train deep bidirectional representations.",
         Stance.CONTESTS),
        ("In contrast to denoising auto-encoders ",
         " , we only predict the masked words.",
         Stance.CONTESTS),
        ("Whereas Dropout ",
         " is typically used to reduce overfitting, we found it can be removed.",
         Stance.CONTESTS),
        ("In model design we follow the original Transformer ",
         " as closely as possible.",
         Stance.INHERITS),
        ("We adopt batch normalization right after each convolution ",
         " and before activation.",
         Stance.INHERITS),
        ("Following the protocol of ", " we report the median of five runs.",
         Stance.INHERITS),
        ("Our plain baselines are mainly inspired by the philosophy of ", " .",
         Stance.EXTENDS),
        ("We compare against the strongest published result ", " .",
         Stance.COMPARES),
        ("The dataset was released by ", " in 2015.", Stance.BACKGROUND),

        # --- a cue belonging to a different clause ---
        # Reading "unlike" as governing Kingma reverses the sentence: the paper is
        # adopting his optimiser, not disputing it.
        ("Unlike earlier heuristics, we use the optimiser of ", " .",
         Stance.INHERITS),

        # --- negation ---
        # VGG: "we did **not** depart from the classical ConvNet architecture of
        # [LeCun]". The naive reading makes a dispute out of an acknowledgement.
        ("Notably, we did not depart from the classical ConvNet architecture of ",
         " , but improved it by substantially increasing the depth.",
         Stance.BACKGROUND),

        # --- a contrast between two actions, not between two papers ---
        # GIN on PointNet: the sentence contrasts identifying elements with
        # distinguishing structure. PointNet is neither side of the argument.
        ("it is important to identify representative elements or the skeleton, "
         "rather than to distinguish the exact structure of ", " .",
         Stance.BACKGROUND),
        # The same cue when the citation really is the object of the contrast.
        ("We evaluate on the full benchmark rather than the subset of ", " .",
         Stance.CONTESTS),

        # --- a shortcoming named after the citation ---
        ("", " does not account for long-range dependencies.", Stance.CONTESTS),
        ("Prior work ", " fails to scale beyond a thousand nodes.", Stance.CONTESTS),
        # ...but "does not" alone states a property, not a deficiency.
        ("The Transformer ", " does not use recurrence.", Stance.BACKGROUND),
        # ...and where the subject is this paper, the shortcoming is this paper's.
        ("Our method ", " does not account for long-range dependencies.",
         Stance.BACKGROUND),
    ],
)
def test_classify(before: str, after: str, expected: Stance) -> None:
    stance, _ = classify(before, after)
    assert stance is expected


def test_cue_is_reported_verbatim() -> None:
    """The reader has to be able to see why, in the paper's own words."""
    stance, cue = classify("Unlike recent language representation models ", " , BERT")
    assert stance is Stance.CONTESTS
    assert cue == "Unlike"


def test_load_bearing() -> None:
    """Only inheritance makes the cited paper's correctness a precondition."""
    assert Stance.INHERITS.is_load_bearing
    assert Stance.EXTENDS.is_load_bearing
    assert not Stance.CONTESTS.is_load_bearing
    assert not Stance.COMPARES.is_load_bearing
    assert not Stance.BACKGROUND.is_load_bearing


def test_strongest_keeps_the_most_specific_mention() -> None:
    """A work cited four times, once meaningfully, is one row not four."""

    def context(stance: Stance) -> CitationContext:
        return CitationContext(
            key="vaswani2017",
            sentence="we follow the original Transformer as closely as possible",
            anchor_text="we follow the original Transformer as closely as possible",
            section="Method",
            section_kind=SectionKind.METHOD,
            stance=stance,
            cue="",
            ordinal=1,
        )

    best = strongest([
        context(Stance.BACKGROUND),
        context(Stance.COMPARES),
        context(Stance.INHERITS),
        context(Stance.BACKGROUND),
    ])
    assert best["vaswani2017"].stance is Stance.INHERITS


def test_a_contrastive_cue_is_spent_on_its_nearest_citation() -> None:
    r"""BERTScore was recorded as disputing the two papers it is built on.

    "In contrast to prior word embeddings \cite{mikolov}, contextual embeddings, such
    as BERT \cite{devlin} and ELMo \cite{peters}, can generate different vector
    representations" — the contrast is with the *first* citation. BERT and ELMo are
    examples of the favoured side, and they were inheriting a cue already spoken for.
    """
    latex = r"""
\section{BERTScore}
In contrast to prior word embeddings \cite{mikolov2013}, contextual embeddings, such as
BERT \cite{devlin2019} and ELMo \cite{peters2018}, can generate different vector
representations for the same word in different sentences depending on the context.
"""
    found = {c.key: c.stance for c in contexts(latex, extract_sections(latex))}
    # Mikolov is background, not contested. The sentence contrasts two *kinds* of
    # embedding and BERTScore is not a party to the contrast — it is laying out the
    # distinction its metric relies on. Scoring against SciCite showed how much of that
    # shape there is in real prose, and how confidently it used to be misread.
    assert found["mikolov2013"] is Stance.BACKGROUND
    assert found["devlin2019"] is Stance.BACKGROUND
    assert found["peters2018"] is Stance.BACKGROUND


def test_an_adopting_cue_still_distributes_over_a_list() -> None:
    """The counterpart. One sentence often adopts two things at once."""
    latex = r"""
\section{Encoder}
We employ a residual connection \cite{he2016} around each of the two sub-layers,
followed by layer normalization \cite{ba2016} in every block of the network.
"""
    found = {c.key: c.stance for c in contexts(latex, extract_sections(latex))}
    assert found["he2016"] is Stance.INHERITS
    assert found["ba2016"] is Stance.INHERITS


def test_one_citation_command_with_two_keys_shares_its_cue() -> None:
    """BERT's abstract contests ELMo and GPT in a single \\cite.

    Also the case for reading a paper's own name as first person: the sentence never
    says "we", it says "BERT", and the premise check has to recognise that the paper is
    talking about itself or the two edges BERT is best known for do not exist.
    """
    latex = r"""
\title{BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding}
\section{Abstract}
Unlike recent language representation models \cite{peters2018,radford2018}, BERT is
designed to pre-train deep bidirectional representations from unlabeled text.
"""
    found = {c.key: c.stance for c in contexts(latex, extract_sections(latex))}
    assert found["peters2018"] is Stance.CONTESTS
    assert found["radford2018"] is Stance.CONTESTS


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        # "following" is a noun here — the thing being studied, not a cue. InstructGPT
        # was recorded as adopting a navigation benchmark because of it.
        ("There is also a related line of work on instruction following for "
         "navigation, where models are trained to follow instructions ", " .",
         Stance.BACKGROUND),
        # ...and a participle in all of these, which must keep working.
        ("Following the procedure described in ", " , we reduce the corpus size.",
         Stance.INHERITS),
        ("Following ", " , our aim is to train models that act on user intentions.",
         Stance.INHERITS),
        ("We de-duplicate the pre-training datasets w.r.t. the test sets following ",
         " .", Stance.INHERITS),
    ],
)
def test_following_is_a_cue_only_as_a_participle(
    before: str, after: str, expected: Stance
) -> None:
    stance, _ = classify(before, after)
    assert stance is expected


def test_a_relative_clause_is_a_different_claim() -> None:
    """"where" was missing from the clause breaks, so a cue in the main clause reached
    a citation inside the relative one.

    The relative clause here carries no cue of its own, so the honest answer is
    background: "we adopt" is about the recipe, not about whoever reported the scores.
    """
    stance, _ = classify(
        "We adopt the standard recipe, where scores are reported for ", " ."
    )
    assert stance is Stance.BACKGROUND


def test_an_adoption_must_be_about_this_paper() -> None:
    r"""Chinchilla surveys the field; it is not adopting GPT-3's setup.

    "Following \cite{kaplan2020} and the training setup of GPT-3 \cite{brown2020}, many
    of the recently trained large models have been trained for approximately 300
    billion tokens" — the subject is other people's models.
    """
    latex = r"""
\section{Method}
Following \cite{kaplan2020} and the training setup of GPT-3 \cite{brown2020}, many of
the recently trained large models have been trained for approximately 300 billion tokens.
"""
    found = {c.key: c.stance for c in contexts(latex, extract_sections(latex))}
    assert found["kaplan2020"] is Stance.BACKGROUND
    assert found["brown2020"] is Stance.BACKGROUND


@pytest.mark.parametrize(
    "sentence",
    [
        r"Following recent work, our network is based on the transformer "
        r"architecture \cite{vaswani2017} throughout every layer.",
        r"Long-term decay: Following \cite{sukhbaatar2015}, we set the decay rate "
        r"accordingly for all of the reported experiments.",
        r"As in \cite{stiennon2020}, we collaborate closely with labelers over the "
        r"course of the whole project.",
    ],
)
def test_an_adoption_that_does_say_who_is_kept(sentence: str) -> None:
    latex = f"\\section{{Method}}\n{sentence}\n"
    found = [c.stance for c in contexts(latex, extract_sections(latex))]
    assert found and all(s is Stance.INHERITS for s in found)


# ------------------------------------------------- the sentence the reader is shown


def test_a_citation_never_vanishes_from_a_quoted_sentence() -> None:
    """A dropped citation leaves a sentence the paper does not contain.

    Stripping markup deletes `\\cite{...}` outright, so "As baselines we chose to use
    \\cite{mikolov2011}, and Interpolated KN 5-gram LMs" reached the reader as "we
    chose to use , and Interpolated KN 5-gram LMs" — quoted verbatim, with a hole where
    the attribution was. 120 of 498 published quotes read like that before this.
    """
    latex = (
        "\\section{Experiments}\n"
        "As baselines we chose to use \\cite{mikolov2011}, and Interpolated KN "
        "5-gram LMs, as they are the most prevalent.\n"
    )
    names = {"mikolov2011": "Mikolov et al. 2011"}
    site = contexts(latex, extract_sections(latex), names)[0]
    assert "Mikolov et al. 2011" in site.shown
    assert " ," not in site.shown
    # `sentence` is the site's identity and the rules' input, so it stays stripped
    # however the quote is rendered. The label file keys on it.
    assert "Mikolov" not in site.sentence


def test_an_unnamed_citation_becomes_a_marker_rather_than_a_hole() -> None:
    """Better anonymous than absent: the reader can see that a work was cited."""
    latex = (
        "\\section{Experiments}\n"
        "Following the procedure described in \\cite{unknown}, we reduce the size of "
        "the combined corpus to 348M words.\n"
    )
    shown = contexts(latex, extract_sections(latex), {})[0].shown
    assert "[ref]" in shown
    assert " ," not in shown


def test_rendering_cannot_move_a_reading() -> None:
    """Stance is decided on the stripped text, so names in the quote are inert.

    Worth holding explicitly: the cue tables were tuned against stripped sentences and
    the 90 hand labels were drawn from them. If resolving a citation could introduce a
    cue word — "Contrary" in a title, say — the display layer would silently retune the
    classifier.
    """
    latex = (
        "\\section{Method}\n"
        "We adopt the residual connections of \\cite{he2016} in every block of the "
        "network we train.\n"
    )
    plain = contexts(latex, extract_sections(latex))[0]
    named = contexts(
        latex, extract_sections(latex),
        {"he2016": "Contrary to Unlike He et al. 2016"},
    )[0]
    assert plain.stance is named.stance is Stance.INHERITS
    assert plain.cue == named.cue


# ------------------------------------------------- a stance needs two parties


def test_a_comparison_between_two_things_in_the_world_is_not_a_stance() -> None:
    r"""The defect SciCite exposed: 136 of 223 `result` readings were wrong.

    "women are disproportionately more frequently affected compared to men \cite{x}"
    compares two populations. "compared to" is a real cue and it is really there, but
    the citing paper is not on either side of the comparison, so there is no stance to
    report — only a source for the whole claim.
    """
    latex = (
        "\\section{Discussion}\n"
        "Symptoms appear earlier and women are disproportionately more frequently "
        "affected compared to men \\cite{ruhl2018}.\n"
    )
    found = {c.key: c.stance for c in contexts(latex, extract_sections(latex))}
    assert found["ruhl2018"] is Stance.BACKGROUND


def test_a_paper_comparing_itself_is_still_a_stance() -> None:
    """The same cue, with this paper on one side of it, must survive the check."""
    latex = (
        "\\section{Results}\n"
        "Our model reaches 28.4 BLEU, compared to the previous best ensemble "
        "\\cite{wu2016}.\n"
    )
    found = {c.key: c.stance for c in contexts(latex, extract_sections(latex))}
    assert found["wu2016"] is Stance.COMPARES


def test_a_paper_that_names_itself_counts_as_saying_who() -> None:
    """Papers with a coined name use it where other papers write "we"."""
    latex = (
        "\\title{LLaMA: Open and Efficient Foundation Language Models}\n"
        "\\section{Introduction}\n"
        "Unlike Chinchilla \\cite{hoffmann2022}, LLaMA is trained only on publicly "
        "available data.\n"
    )
    found = {c.key: c.stance for c in contexts(latex, extract_sections(latex))}
    assert found["hoffmann2022"] is Stance.CONTESTS


def test_a_title_word_that_is_not_a_name_is_not_taken_for_one() -> None:
    """"Attention: ..." must not make every sentence about attention self-referential."""
    from keystone.lineage.stance import self_name

    assert self_name("Attention: a survey of the literature") == ""
    assert self_name("Deep Residual Learning for Image Recognition") == ""
    assert self_name("BERT: Pre-training of Deep Bidirectional Transformers") == "BERT"


def test_a_papers_own_name_is_read_from_the_abstract_when_the_title_omits_it() -> None:
    """Most of the field's best-known papers have no colon in the title.

    "Attention Is All You Need" never names the Transformer, and without the name the
    paper loses "In contrast to RNN sequence-to-sequence models, the Transformer
    outperforms the BerkeleyParser" — as clear a comparison as it makes anywhere.
    """
    from keystone.lineage.stance import self_name

    body = (
        "We propose a new simple network architecture, the Transformer. "
        + "The Transformer achieves better BLEU. " * 9
    )
    assert self_name("Attention Is All You Need", body) == "Transformer"


def test_the_fields_own_vocabulary_is_not_taken_for_a_papers_name() -> None:
    """A false name loosens the premise check on the papers that discuss it most.

    "We train GNNs on nine benchmarks" names the subject matter. Reading GNNs as the
    paper's own name would make every sentence about graph networks read as a sentence
    about this paper, which is worse than having no name at all.
    """
    from keystone.lineage.stance import self_name

    for term in ("GNNs", "NMT", "CNNs", "LSTM"):
        body = f"We train {term} on nine benchmarks. " + f"The {term} results. " * 9
        assert self_name("How Powerful are Graph Neural Networks?", body) == ""


def test_a_multi_word_name_is_kept_whole() -> None:
    """"Batch Normalization" is the name; "Batch" is a word the paper uses constantly."""
    from keystone.lineage.stance import self_name

    assert (
        self_name("Batch Normalization: Accelerating Deep Network Training", "")
        == "Batch Normalization"
    )


def test_a_candidate_mentioned_once_is_not_a_name() -> None:
    """A model's name is on every page; a capitalised noun after "we propose" is not."""
    from keystone.lineage.stance import self_name

    assert self_name("Some Paper", "We propose a method for Image Recognition.") == ""
