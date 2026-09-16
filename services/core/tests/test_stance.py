"""What a paper says about the work it cites.

Every case here is either a real sentence from the corpus or the minimal shape of one
that the classifier got wrong. The failures are the point: a cue read out of position
does not produce a vague answer, it produces a confident opposite one.
"""

from __future__ import annotations

import pytest

from keystone.lineage.stance import Stance, classify, strongest
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
        )

    best = strongest([
        context(Stance.BACKGROUND),
        context(Stance.COMPARES),
        context(Stance.INHERITS),
        context(Stance.BACKGROUND),
    ])
    assert best["vaswani2017"].stance is Stance.INHERITS
