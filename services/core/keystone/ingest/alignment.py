"""Checking that a paper's source and its PDF are the same document.

Everything Keystone shows is a sentence taken from the LaTeX and pointed at a place on
the PDF page, which silently assumes the two files belong together. They do not always.

arXiv:1909.08593 is *Fine-Tuning Language Models from Human Preferences*, and its
e-print archive contains **GPT-2's** paper — a template the authors reused without
replacing the body. Nothing crashed. The dossier published seven citation stances and
quoted sentences like "On the WMT-14 English-French test set, GPT-2 gets 5 BLEU" under
the wrong paper's name, and a reader following any of them would have found the words
absent from the page they were sent to.

The tell was already in the data: not one of those sentences located in the PDF. So
the anchor layer, which exists to refuse rather than guess, can be pointed at this
question too — if almost none of a source's prose is findable in the PDF, the source is
not that PDF's source, and the honest output is no dossier at all.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from keystone.ingest.anchors import DocIndex
from keystone.ingest.latex import anchorable_sentences

#: Sentences to test. Enough to be decisive either way — a correctly paired paper sits
#: near 90% and a mismatched one near zero, so the two are never close — and few enough
#: that the check costs a second rather than a minute.
SAMPLE = 40

#: Below this the source does not belong to the PDF.
#:
#: Deliberately far from both outcomes. Measured across the corpus, correctly paired
#: papers locate 63-100% of their sampled sentences; the mismatched one located 0%.
#: A floor of 25% is nowhere near either, so it separates "wrong document" from "hard
#: document" rather than quietly rejecting papers with awkward typesetting.
FLOOR = 0.25

#: Fewer anchorable sentences than this and the sample says nothing either way, so no
#: conclusion is drawn.
MIN_SENTENCES = 10


@dataclass(frozen=True, slots=True)
class Alignment:
    """How much of the source could be found in the PDF."""

    sampled: int
    located: int

    @property
    def rate(self) -> float:
        return 0.0 if self.sampled == 0 else self.located / self.sampled

    @property
    def decidable(self) -> bool:
        """Whether the sample is large enough to conclude anything."""
        return self.sampled >= MIN_SENTENCES

    @property
    def mismatched(self) -> bool:
        """Whether the source is a different document from the PDF."""
        return self.decidable and self.rate < FLOOR

    def to_dict(self) -> dict:
        return {
            "sampled": self.sampled,
            "located": self.located,
            "rate": round(self.rate, 3),
        }


def measure(latex: str, index: DocIndex, *, sample: int = SAMPLE, seed: int = 0) -> Alignment:
    """What fraction of a random sample of source sentences the PDF contains.

    Sampled rather than taken from the front, because a paper's first page is its
    title and authors — the part most likely to survive a template reuse, and so the
    part least able to tell the two cases apart.
    """
    sentences = anchorable_sentences(latex)
    if not sentences:
        return Alignment(sampled=0, located=0)

    rng = random.Random(seed)
    chosen = sentences if len(sentences) <= sample else rng.sample(sentences, sample)
    located = sum(1 for sentence in chosen if index.locate(sentence).anchor is not None)
    return Alignment(sampled=len(chosen), located=located)
