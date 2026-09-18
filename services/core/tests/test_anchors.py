"""The Phase 0 gate: anchors must be trustworthy in both directions.

Positive — a quote lifted from a paper resolves to rectangles that provably sit on
that text, verified through MuPDF's geometry rather than through the matcher's own
index.

Negative — text that is not in the paper is rejected. This half matters as much as
the first: an anchor onto near-miss text would let the audit engine report a
discrepancy against a sentence that does not exist.
"""

from __future__ import annotations

import random

import pytest

from keystone.ingest import DocIndex, roundtrip, skeletonize
from keystone.ingest.sampling import sample_spans, spans_with_line_hyphens

from .conftest import requires_corpus

# Anchors reporting "tight" are the ones prose claims may cite, so they carry the
# gate. Set below 100% deliberately: MuPDF occasionally glues adjacent glyphs in dense
# maths ("ts√" for "√"), which no rectangle can separate. Blunting the check to reach
# a cosmetic 100% would cost more than it buys — a real regression shows up as a
# collapse, not as a fraction of a percent.
GATE_TIGHT_RATE = 99.0

SAMPLES_PER_DOC = 60
HYPHEN_SAMPLES_PER_DOC = 15


@requires_corpus
def test_tight_anchors_survive_geometric_roundtrip(corpus):
    """Every anchor claiming tight rectangles must actually have tight rectangles."""
    tight = passed = 0
    failures: list[str] = []

    for path, doc, index in corpus:
        spans = sample_spans(doc, SAMPLES_PER_DOC, seed=7) + spans_with_line_hyphens(
            doc, HYPHEN_SAMPLES_PER_DOC, seed=7
        )
        for span in spans:
            anchor = index.locate(span.quote).anchor
            assert anchor is not None, f"{path.name}: real text was rejected"
            if anchor.precision != "tight":
                continue
            tight += 1
            ok, why, _ = roundtrip(doc, anchor)
            if ok:
                passed += 1
            else:
                failures.append(f"{path.name}: {why} :: {span.quote[:60]!r}")

    assert tight > 500, "corpus too small to gate on"
    rate = 100.0 * passed / tight
    assert rate >= GATE_TIGHT_RATE, (
        f"tight anchor accuracy {rate:.2f}% below gate {GATE_TIGHT_RATE}%\n"
        + "\n".join(failures[:15])
    )


@requires_corpus
def test_real_spans_are_never_rejected(corpus):
    """Text lifted verbatim out of a paper must always be locatable in it."""
    for path, doc, index in corpus:
        for span in sample_spans(doc, 40, seed=13):
            result = index.locate(span.quote)
            assert result.anchor is not None, (
                f"{path.name}: rejected ({result.reason}) real text {span.quote[:70]!r}"
            )


@requires_corpus
def test_anchors_land_on_the_words_they_came_from(corpus):
    """Locating must be positionally right, not merely textually right.

    Rectangles covering the correct words somewhere else in the document would pass a
    text round-trip and still send the reader to the wrong place.
    """
    for path, doc, index in corpus:
        for span in sample_spans(doc, 40, seed=17):
            anchor = index.locate(span.quote).anchor
            assert anchor is not None
            if anchor.is_ambiguous:
                continue  # text genuinely repeats; first occurrence is a valid choice
            assert anchor.word_start == span.word_start, (
                f"{path.name}: expected word {span.word_start}, got {anchor.word_start}"
            )


@requires_corpus
def test_fabricated_quotes_are_rejected(corpus):
    """Plausible-but-absent text must not resolve. This is the hallucination gate.

    Fabrications are built by swapping words of a real span for other words from the
    same paper, which preserves its register and vocabulary while ensuring the
    sentence never occurs.
    """
    rng = random.Random(3)
    probes = 0
    accepted: list[str] = []

    for path, doc, index in corpus:
        vocabulary = [w.text for w in doc.words if w.text.isalpha() and len(w.text) > 4]
        for span in sample_spans(doc, 40, seed=5):
            tokens = span.quote.split()
            substantial = [i for i, t in enumerate(tokens) if t.isalpha() and len(t) > 3]
            if len(substantial) < 3:
                continue
            for i in rng.sample(substantial, max(1, int(len(substantial) * 0.4))):
                tokens[i] = rng.choice(vocabulary)
            fake = " ".join(tokens)
            if index.contains(fake):
                continue  # the substitution happened to reproduce real text
            probes += 1
            result = index.locate(fake)
            if result.anchor is not None:
                accepted.append(
                    f"{path.name} [{result.anchor.method} {result.anchor.score}] "
                    f"{fake[:70]!r} -> {result.anchor.matched_text[:70]!r}"
                )

    assert probes > 200, "not enough fabrications generated to be meaningful"
    assert not accepted, "fabricated text was anchored:\n" + "\n".join(accepted[:10])


@requires_corpus
def test_cross_paper_matches_are_genuine(corpus):
    """A span from one paper may only resolve in another if that text is really there.

    Papers share bibliography entries, so hits are expected and correct. What must
    never happen is a hit onto text the target document does not contain.
    """
    spans = {path.name: sample_spans(doc, 20, seed=11) for path, doc, _ in corpus}
    probes = 0

    for path, _doc, index in corpus:
        for source, source_spans in spans.items():
            if source == path.name:
                continue
            for span in source_spans:
                probes += 1
                anchor = index.locate(span.quote).anchor
                if anchor is None:
                    continue
                assert index.contains(anchor.matched_text), (
                    f"{source} -> {path.name}: anchored text absent from target: "
                    f"{anchor.matched_text[:80]!r}"
                )

    assert probes > 1000


@requires_corpus
def test_near_miss_is_reported_but_not_anchored(corpus):
    """A rejection should be diagnosable without being permissive.

    Alignment scores reward a long shared window, so a single substituted word barely
    moves the score. Such a quote must be rejected, while still reporting the closest
    text so a misquoted extraction can be explained.
    """
    _path, _doc, index = corpus[0]
    span = sample_spans(_doc, 1, seed=23)[0]

    tokens = span.quote.split()
    victim = max(range(len(tokens)), key=lambda i: len(tokens[i]))
    tokens[victim] = "kumquat"
    corrupted = " ".join(tokens)

    result = index.locate(corrupted)
    assert result.anchor is None
    assert result.reason == "not_found"
    assert result.near_miss is not None, "a near miss should be reported"

    # Even opting in, a substituted word must not be admitted: the guard requires
    # every substantial word of the quote to be present in the span.
    assert index.locate(corrupted, allow_fuzzy=True).anchor is None


@requires_corpus
def test_short_quotes_are_rejected_as_ambiguous(corpus):
    _path, _doc, index = corpus[0]
    result = index.locate("we find that")
    assert result.anchor is None
    assert result.reason == "too_short"


@requires_corpus
def test_precision_is_self_reported_accurately(corpus):
    """Whatever precision an anchor claims, verification holds it to that contract."""
    seen = set()
    for _path, doc, index in corpus:
        for span in sample_spans(doc, 30, seed=29):
            anchor = index.locate(span.quote).anchor
            assert anchor is not None
            seen.add(anchor.precision)
            ok, why, _ = roundtrip(doc, anchor)
            if anchor.precision == "approximate":
                assert ok, f"approximate contract violated: {why}"

    # Both levels must actually occur, or the distinction is untested.
    assert seen == {"tight", "approximate"}, f"only saw {seen}"


@requires_corpus
def test_rects_carry_their_own_text(corpus):
    """Each rectangle names the words it covers, for accessible highlight labels."""
    _path, doc, index = corpus[0]
    span = sample_spans(doc, 1, seed=31)[0]
    anchor = index.locate(span.quote).anchor
    assert anchor is not None
    joined = skeletonize(" ".join(r.text for r in anchor.rects), drop_hyphens=True)
    for word in doc.words[anchor.word_start : anchor.word_end + 1]:
        assert skeletonize(word.text, drop_hyphens=True) in joined


# ------------------------------------------------- narrowing to a verifiable span


@requires_corpus
def test_locate_longest_narrows_to_a_span_the_page_contains(corpus) -> None:
    """A claim's sentence reaches the anchor layer already stripped of its citations.

    "We employ a residual connection \\cite{he} around each of the two sub-layers"
    renders with "[11]" in the middle, so the stripped sentence matches nothing. By
    the time a claim gets here the hole is a single space and cannot be split at, so
    the longest verifiable prefix or suffix is anchored instead.
    """
    path, _doc, index = next(
        entry for entry in corpus if entry[0].stem == "1706.03762"
    )
    quote = (
        "We employ a residual connection around each of the two sub-layers, "
        "followed by layer normalization ."
    )
    assert index.locate(quote).anchor is None
    result = index.locate_longest(quote)
    assert result.anchor is not None
    assert result.reason == "exact_strict"


@requires_corpus
def test_locate_longest_still_refuses_text_that_is_not_there(corpus) -> None:
    """Narrowing must not become a way to anchor something the paper never said."""
    _path, _doc, index = corpus[0]
    assert index.locate_longest(
        "This sentence was fabricated and appears in no paper anywhere at all."
    ).anchor is None


@requires_corpus
def test_locate_longest_refuses_a_fragment_too_small_to_mean_anything(corpus) -> None:
    """Half a claim highlighted in the wrong place is worse than no highlight."""
    _path, _doc, index = corpus[0]
    # A real opening followed by a long invention: the verifiable part is a small
    # share of the whole, so no anchor should be offered.
    result = index.locate_longest(
        "In this work we "
        + "consider an entirely invented continuation that the paper does not contain "
        + "and which goes on for a considerable distance beyond any real text."
    )
    assert result.anchor is None
