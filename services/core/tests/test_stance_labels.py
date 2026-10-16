"""The hand-label sample: what a fresh draw is filed as.

The held-out accuracy is only an estimate of anything while the rows behind it are
ones the rules were never adjusted against. A draw that files itself as ``tuned``
quietly takes those rows out of the one number they were drawn to sharpen.
"""

from __future__ import annotations

from keystone.eval.stance_labels import Row, sample


def _row(paper: str, key: str, predicted: str) -> Row:
    return Row(paper=paper, key=key, predicted=predicted, sentence="s", cue="", section="")


def test_a_fresh_draw_is_held_out():
    pool = [_row("p", f"k{i}", stance) for i, stance in enumerate(
        ["inherits", "extends", "contests", "compares", "background"] * 3
    )]
    drawn = sample(pool, per_stance=2, seed=1)
    assert len(drawn) == 10
    assert {row.split for row in drawn} == {"heldout"}


def test_rows_already_labelled_are_not_drawn_again():
    labelled = _row("p", "k0", "inherits")
    pool = [labelled, _row("p", "k1", "inherits")]
    drawn = sample(pool, per_stance=5, seed=1, existing=[labelled])
    assert [(row.paper, row.key) for row in drawn] == [("p", "k1")]
