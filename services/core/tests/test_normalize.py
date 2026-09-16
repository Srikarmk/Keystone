"""Invariants of the skeleton projection."""

from keystone.ingest.normalize import skeletonize, skeletonize_word


def test_distributes_over_whitespace_tokens():
    """The document skeleton is built word by word; a quote is projected in one pass.

    Those two must agree, or a quote could never be found in the index built from the
    same words.
    """
    words = ["The", "efﬁcient", "state-of-the-art", "method"]
    assert skeletonize(" ".join(words)) == "".join(skeletonize(w) for w in words)


def test_folds_ligatures_and_accents():
    assert skeletonize("efﬁcient") == "efficient"
    assert skeletonize("Schölkopf") == "scholkopf"
    assert skeletonize("naïve café") == "naivecafe"
    # A combining mark is a separate glyph positioned above the line, so extracting a
    # region can return the base letter alone. Both sides must fold to the same thing.
    assert skeletonize("f̄") == skeletonize("f")


def test_unifies_dashes_but_keeps_sign():
    assert skeletonize("state–of‑the‐art") == "state-of-the-art"
    # A minus sign must survive: this is a tool for checking numbers, and -3.2 is not
    # 3.2. Hyphen folding is available separately, as an explicitly looser tier.
    assert skeletonize("−3.2") == "-3.2"
    assert skeletonize("−3.2", drop_hyphens=True) == "3.2"


def test_drops_invisible_characters():
    assert skeletonize("The­effi​cient") == "theefficient"


def test_dehyphenates_only_word_fragments():
    assert skeletonize_word("foo-", line_end=True) == "foo"
    assert skeletonize_word("foo-", line_end=False) == "foo-"
    # A word that is nothing but a dash is a real token — a table's "not applicable"
    # marker. Erasing it would drop it from the index and shift every anchor after it.
    assert skeletonize_word("-", line_end=True) == "-"


def test_is_idempotent():
    text = "The efﬁcient state–of‑the‐art naïve café"
    assert skeletonize(skeletonize(text)) == skeletonize(text)
