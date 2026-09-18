"""Scoring the cue rules against labels somebody else wrote.

The harness is small, so these tests hold the two things that would silently corrupt
the published number rather than crash: a label mapping that loses a class, and a
metric that counts the wrong denominator.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from keystone.eval.external import (
    ACL_ARC_LABELS,
    SCICITE_LABELS,
    TO_ACL_ARC,
    TO_SCICITE,
    Instance,
    acl_arc,
    scicite,
    score,
)
from keystone.lineage.stance import Stance


# ------------------------------------------------------------------ the mappings


def test_every_stance_has_a_target_in_both_corpora() -> None:
    """A stance with no target would be scored against nothing and vanish quietly."""
    for mapping in (TO_SCICITE, TO_ACL_ARC):
        assert set(mapping) == set(Stance)


def test_targets_are_real_labels() -> None:
    assert set(TO_SCICITE.values()) <= set(SCICITE_LABELS)
    assert set(TO_ACL_ARC.values()) <= set(ACL_ARC_LABELS)


def test_scicite_is_fully_reachable_and_acl_arc_is_not() -> None:
    """The asymmetry is the point, and it is what caps ACL-ARC's macro-F1 at 0.667."""
    assert set(SCICITE_LABELS) == set(TO_SCICITE.values())
    assert set(ACL_ARC_LABELS) - set(TO_ACL_ARC.values()) == {"Motivation", "Future"}


# -------------------------------------------------------------------- the metrics


def _one(gold: str, before: str = "", after: str = "", sentence: str = "") -> Instance:
    return Instance(before=before, after=after, sentence=sentence or before + after, gold=gold)


def test_coverage_counts_only_what_was_read() -> None:
    """`read` is the share a stance was reported for, so background cannot inflate it."""
    got = score("t", [
        _one("method", "we use the optimiser of ", ""),
        _one("background", "an unremarkable mention of ", ""),
        _one("background", "another mention of ", ""),
        _one("background", "and another of ", ""),
    ], TO_SCICITE, SCICITE_LABELS)
    assert got.instances == 4
    assert got.spoken == 1
    assert got.coverage == pytest.approx(0.25)


def test_spoken_precision_ignores_the_silent_class() -> None:
    """Right-when-it-speaks must not be helped by getting background right."""
    got = score("t", [
        _one("method", "we use the optimiser of ", ""),
        _one("background", "we use the optimiser of ", ""),
        _one("background", "a plain mention of ", ""),
    ], TO_SCICITE, SCICITE_LABELS)
    assert got.spoken == 2
    assert got.spoken_precision == pytest.approx(0.5)
    # Accuracy, which does count the silent class, is higher. That gap is the reason
    # both numbers are published rather than either one alone.
    assert got.accuracy > got.spoken_precision


def test_a_corpus_read_as_silent_throughout_scores_no_precision_rather_than_full() -> None:
    got = score("t", [_one("background", "a plain mention of ")], TO_SCICITE, SCICITE_LABELS)
    assert got.spoken == 0
    assert got.spoken_precision == 0.0


def test_the_ceiling_reflects_classes_with_no_source() -> None:
    got = score("t", [
        _one("Background", "a plain mention of "),
        _one("Uses", "we use the parser of "),
        _one("Motivation", "a plain mention of "),
    ], TO_ACL_ARC, ACL_ARC_LABELS)
    # Two of the three classes present are reachable.
    assert got.ceiling == pytest.approx(2 / 3)


# --------------------------------------------------------------------- the loaders


def test_a_row_with_no_usable_offset_is_dropped_not_guessed(tmp_path: Path) -> None:
    """Without knowing where the citation is, "before" and "after" mean nothing.

    NaN in particular: it arrives as a float, compares false against every bound, and
    would slip past a range check straight into the cast.
    """
    directory = tmp_path / "scicite"
    directory.mkdir()
    rows = [
        {"string": "we use the parser of [1] here", "citeStart": 21, "citeEnd": 24,
         "label": "method"},
        {"string": "no offsets at all", "citeStart": None, "citeEnd": None,
         "label": "method"},
        {"string": "offsets are nan", "citeStart": float("nan"),
         "citeEnd": float("nan"), "label": "method"},
        {"string": "offsets past the end", "citeStart": 900, "citeEnd": 950,
         "label": "method"},
        {"string": "unknown label", "citeStart": 0, "citeEnd": 3, "label": "musing"},
    ]
    (directory / "test.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
    (directory / "train.jsonl").write_text("")
    (directory / "dev.jsonl").write_text("")

    got = scicite(directory)
    assert len(got) == 1
    assert got[0].before == "we use the parser of "
    assert got[0].gold == "method"


def test_acl_arc_splits_at_the_placeholder(tmp_path: Path) -> None:
    directory = tmp_path / "acl-arc"
    directory.mkdir()
    rows = [
        {"cleaned_cite_text": "We employ the head rules of @@CITATION for parsing .",
         "intent": "Uses"},
        {"cleaned_cite_text": "no placeholder here", "intent": "Uses"},
    ]
    (directory / "test.jsonl").write_text("\n".join(json.dumps(r) for r in rows))

    got = acl_arc(directory)
    assert len(got) == 1
    assert got[0].before == "We employ the head rules of "
    assert got[0].after == " for parsing ."
    assert "@@CITATION" not in got[0].sentence


def test_a_missing_corpus_yields_nothing_rather_than_failing(tmp_path: Path) -> None:
    """The evaluation is only as good as the data on disk; absence is not an error."""
    assert scicite(tmp_path / "nowhere") == []
    assert acl_arc(tmp_path / "nowhere") == []
