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
    assert found["mikolov2013"] is Stance.CONTESTS
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
    """BERT's abstract contests ELMo and GPT in a single \\cite."""
    latex = r"""
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
