"""The assumption detector, scored against somebody else's labels.

The stance rules were measured against SciCite and ACL-ARC and the result was
uncomfortable and useful: they did not travel nearly as well as ninety hand labels from
the tuning corpus had suggested. The assumption layer is in exactly the loop the stance
layer just came out of — every figure about it comes from reading its own output on the
same papers its cues were written against — so it gets the same treatment.

**BioScope** (Vincze et al. 2008) is the corpus. Its full-paper set marks every
speculation cue in 2,670 sentences of biomedical research writing, and it is the data
behind the CoNLL-2010 shared task, whose Task 1 is exactly this: given a sentence, does
it hedge? Published systems reach roughly 85-86% F1 on the biological subset.

One thing has to be said before any number is quoted, because it decides how to read
them. **Keystone is not a hedge detector, and this is not the task it is trying to do.**
BioScope marks every sentence whose claim is qualified — "these results may indicate a
role for X" hedges, and is annotated. Keystone looks for something narrower: a sentence
where the paper announces something it is *taking as given* and moving past. Hedged
reporting of a finding is not that. So low recall here is the design showing up in the
measurement, not a defect, and the number that describes the detector is precision on
the sentences it does flag — the same pair the stance work settled on.

What the comparison is genuinely good for is the opposite direction: a sentence Keystone
calls an assumption that BioScope marks as carrying no speculation at all is worth
reading, because one of the two is wrong and it is not obviously BioScope.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from keystone.eval.stance_labels import wilson
from keystone.lineage.assumptions import Kind, identify

#: Sentences shorter than this are titles and headings — "Abstract", "Background" —
#: which carry no claim to hedge and would flatter both sides of the comparison.
MIN_CHARS = 25


@dataclass(frozen=True, slots=True)
class Sentence:
    """One BioScope sentence and whether it was annotated as speculative."""

    sentence_id: str
    text: str
    """Plain text, with the cue markup removed but the cue words kept in place."""
    uncertain: bool
    cues: tuple[str, ...]
    """The exact words BioScope marked, for reading the disagreements."""


def load(path: Path) -> list[Sentence]:
    """Every sentence in a BioScope file, with its speculation annotation.

    A cue is an inline element, so the sentence's text is the concatenation of its own
    text and all its descendants'. `itertext` does that; what it does not do is tell
    you which parts were cues, hence the separate walk.
    """
    if not path.exists():
        return []
    root = ET.parse(path).getroot()
    out: list[Sentence] = []
    for node in root.iter("sentence"):
        text = re.sub(r"\s+", " ", "".join(node.itertext())).strip()
        if len(text) < MIN_CHARS:
            continue
        cues = tuple(
            re.sub(r"\s+", " ", "".join(cue.itertext())).strip()
            for cue in node.iter("cue")
            if cue.get("type") == "speculation"
        )
        out.append(Sentence(
            sentence_id=node.get("id", ""),
            text=text,
            uncertain=bool(cues),
            cues=cues,
        ))
    return out


@dataclass
class Report:
    """How Keystone's assumption cues line up with BioScope's speculation cues."""

    corpus: str
    sentences: int = 0
    #: BioScope says speculative.
    gold: int = 0
    #: Keystone announced an assumption.
    flagged: int = 0
    #: Both.
    agreed: int = 0
    kinds: dict[str, int] = field(default_factory=dict)
    #: Flagged sentences BioScope marked as carrying no speculation, kept for reading.
    unshared: list[tuple[str, str, str]] = field(default_factory=list)

    @property
    def precision(self) -> float:
        """Of the sentences Keystone flagged, how many BioScope also marks."""
        return 0.0 if self.flagged == 0 else self.agreed / self.flagged

    @property
    def recall(self) -> float:
        """Of BioScope's speculative sentences, how many Keystone flags.

        Expected to be low and not a defect: see the module docstring. Reported anyway,
        because a metric left out because it is unflattering is the reason the earlier
        numbers on this project were worth so little.
        """
        return 0.0 if self.gold == 0 else self.agreed / self.gold

    @property
    def f1(self) -> float:
        total = self.precision + self.recall
        return 0.0 if total == 0 else 2 * self.precision * self.recall / total

    @property
    def coverage(self) -> float:
        return 0.0 if self.sentences == 0 else self.flagged / self.sentences

    @property
    def precision_interval(self) -> tuple[float, float]:
        return wilson(self.agreed, self.flagged)

    def to_dict(self) -> dict:
        return {
            "corpus": self.corpus,
            "sentences": self.sentences,
            "gold": self.gold,
            "flagged": self.flagged,
            "agreed": self.agreed,
            "coverage": round(self.coverage, 4),
            "precision": round(self.precision, 4),
            "precisionInterval": [round(v, 4) for v in self.precision_interval],
            "recall": round(self.recall, 4),
            "f1": round(self.f1, 4),
            "kinds": dict(sorted(self.kinds.items())),
        }


def score(corpus: str, sentences: list[Sentence]) -> Report:
    """Run the shipped assumption cues over a corpus and tally the agreement."""
    report = Report(corpus=corpus)
    for item in sentences:
        report.sentences += 1
        if item.uncertain:
            report.gold += 1
        found = identify(item.text, {})
        if found is None:
            continue
        kind, cue = found
        report.flagged += 1
        report.kinds[str(kind)] = report.kinds.get(str(kind), 0) + 1
        if item.uncertain:
            report.agreed += 1
        elif len(report.unshared) < 40:
            report.unshared.append((item.sentence_id, cue, item.text))
    return report


def evaluate(directory: Path) -> list[Report]:
    """Both BioScope subsets, scored separately.

    Kept apart because they are different registers. Full papers are the closer match
    to what Keystone reads; abstracts compress and hedge differently, and averaging the
    two would hide whichever is worse.
    """
    out: list[Report] = []
    for name, filename in (
        ("BioScope full papers", "full_papers.xml"),
        ("BioScope abstracts", "abstracts.xml"),
    ):
        sentences = load(directory / filename)
        if sentences:
            out.append(score(name, sentences))
    return out


#: Kinds whose cues are claims about certainty, so BioScope ought to mark them too.
#: The other kinds — a simplification, a stated precondition — are not hedges at all,
#: and a disagreement there says nothing about either annotator.
HEDGE_LIKE = frozenset({str(Kind.CONJECTURAL), str(Kind.CONVENTIONAL)})
