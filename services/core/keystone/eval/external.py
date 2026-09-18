"""Keystone's citation readings, scored against somebody else's labels.

Every accuracy figure this project has published so far came from ninety citations I
labelled myself, drawn from the same forty-one papers the cue tables were tuned on.
That is a closed loop. It cannot tell me whether the rules generalise, and at thirty
held-out rows the 95% interval runs from 63% to 90% — wide enough that "competitive
with a trained classifier" and "barely beats bag-of-words" are both inside it.

Two public corpora settle it. **SciCite** (Cohan et al. 2019) has 11,020 citation
contexts labelled *background* / *method* / *result*; **ACL-ARC** (Jurgens et al. 2018)
has 1,941 labelled across six intents. Neither was used to write a single cue phrase,
so both are genuinely held out, and both have a published leaderboard to stand next to:

    ACL-ARC, 6-class macro-F1     SciCite, 3-class macro-F1
      Teufel 2000 cues    0.273     SOTA (neural)   0.84-0.889
      Dong & Schäfer      0.233
      Jurgens random forest 0.530
      Falcon-7B (SOTA)    0.733

All three splits are scored, not just the test set. A rule system has nothing to train
on, so holding data back would only shrink the sample for no gain — and saying so is
more honest than quoting a number from 139 rows.

Where the label sets do not line up, the mapping is stated and the cost is counted
rather than hidden:

* SciCite absorbs Keystone cleanly. `inherits` and `extends` are both *method*;
  `contests` and `compares` are both *result*. Nothing is lost but granularity.
* ACL-ARC has *Motivation* and *Future*, and Keystone has no class that can express
  either. Those instances are wrong by construction, which caps six-class macro-F1 at
  0.667 however good the other four are. That cap is reported, not quietly dropped —
  a four-class score on a hand-picked subset would not be comparable to the table
  above, and comparability is the entire point of running this.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from keystone.eval.stance_labels import ClassScore, macro_f1, wilson
from keystone.lineage.stance import Stance, read

#: What a citation looks like once a corpus has flattened it out of LaTeX. One guard
#: needs to know where the *other* citations in a sentence are — a contrastive cue is
#: spent on the nearest one after it — and in these corpora they are bracket numbers,
#: author-year parentheses, or ACL-ARC's own placeholder rather than `\cite`.
_MARKER = re.compile(
    r"@@CITATION"
    r"|\[\s*\d+(?:\s*[,;]\s*\d+)*\s*\]"
    r"|\(\s*[^()]{0,60}?(?:19|20)\d{2}[a-z]?\s*\)"
)

_PLACEHOLDER = "@@CITATION"

#: Keystone's five stances onto SciCite's three. Total, and lossy only in granularity.
TO_SCICITE: dict[Stance, str] = {
    Stance.BACKGROUND: "background",
    Stance.INHERITS: "method",
    Stance.EXTENDS: "method",
    Stance.CONTESTS: "result",
    Stance.COMPARES: "result",
}

#: Keystone's five onto ACL-ARC's six. `Motivation` and `Future` have no source, so
#: no prediction can ever land on them.
TO_ACL_ARC: dict[Stance, str] = {
    Stance.BACKGROUND: "Background",
    Stance.INHERITS: "Uses",
    Stance.EXTENDS: "Extends",
    Stance.CONTESTS: "CompareOrContrast",
    Stance.COMPARES: "CompareOrContrast",
}

#: Labels in each corpus, so a class with no instances still appears in the report.
SCICITE_LABELS = ("background", "method", "result")
ACL_ARC_LABELS = (
    "Background", "Uses", "CompareOrContrast", "Extends", "Motivation", "Future",
)


@dataclass(frozen=True, slots=True)
class Instance:
    """One citation site from a public corpus, in the shape the classifier reads."""

    before: str
    """Text preceding the citation, markers intact."""
    after: str
    """Text following it."""
    sentence: str
    """The whole excerpt, for the guards that look at the subject of the sentence."""
    gold: str


@dataclass
class Result:
    """How Keystone read one corpus."""

    corpus: str
    labels: tuple[str, ...]
    instances: int = 0
    hits: int = 0
    skipped: int = 0
    """Rows with no usable citation offset. Counted so the sample is not overstated."""
    unreachable: tuple[str, ...] = ()
    """Gold classes Keystone has no way to predict."""
    silent: str = ""
    """The label Keystone's own `background` maps to — the one that says nothing."""
    classes: dict[str, ClassScore] = field(default_factory=dict)

    @property
    def accuracy(self) -> float:
        return 0.0 if self.instances == 0 else self.hits / self.instances

    @property
    def macro_f1(self) -> float:
        return macro_f1(self.classes)

    @property
    def ceiling(self) -> float:
        """The best macro-F1 reachable given classes Keystone cannot express."""
        present = [c for c in self.labels if self.classes[c].support > 0]
        if not present:
            return 0.0
        return sum(1 for c in present if c not in self.unreachable) / len(present)

    @property
    def interval(self) -> tuple[float, float]:
        return wilson(self.hits, self.instances)

    @property
    def spoken(self) -> int:
        """Citations Keystone read as something other than background.

        The number that describes this product, because the product is a reading aid
        and not a classifier. Keystone is built to refuse: if no cue phrase is written
        down, no stance is reported, and the reader sees nothing rather than a guess.
        On somebody else's corpus that means it declines most citations — the missed
        ones are things like "using CMet cardiac metric software [12]" and "the BitPar
        parser, which is a state-of-the-art parser of German [12]", where the adoption
        is real but the only evidence for it is knowing what BitPar is.
        """
        return sum(
            score.predicted for label, score in self.classes.items()
            if label != self.silent
        )

    @property
    def coverage(self) -> float:
        """Share of citations Keystone said anything about."""
        return 0.0 if self.instances == 0 else self.spoken / self.instances

    @property
    def spoken_precision(self) -> float:
        """How often a reading is right, counting only the ones it offered.

        Paired with :attr:`coverage`, this is the honest pair of numbers: macro-F1
        blends them into one figure that punishes silence as heavily as error, which
        describes a benchmark entry rather than a tool whose whole discipline is
        declining to answer.
        """
        hits = sum(
            score.hits for label, score in self.classes.items() if label != self.silent
        )
        return 0.0 if self.spoken == 0 else hits / self.spoken

    @property
    def spoken_interval(self) -> tuple[float, float]:
        hits = sum(
            score.hits for label, score in self.classes.items() if label != self.silent
        )
        return wilson(hits, self.spoken)

    def to_dict(self) -> dict:
        return {
            "corpus": self.corpus,
            "instances": self.instances,
            "skipped": self.skipped,
            "accuracy": round(self.accuracy, 4),
            "accuracyInterval": [round(v, 4) for v in self.interval],
            "macroF1": round(self.macro_f1, 4),
            "macroF1Ceiling": round(self.ceiling, 4),
            "spoken": self.spoken,
            "coverage": round(self.coverage, 4),
            "spokenPrecision": round(self.spoken_precision, 4),
            "spokenInterval": [round(v, 4) for v in self.spoken_interval],
            "unreachable": list(self.unreachable),
            "classes": {
                label: {
                    "support": score.support,
                    "predicted": score.predicted,
                    "precision": None if score.precision is None else round(score.precision, 4),
                    "recall": None if score.recall is None else round(score.recall, 4),
                }
                for label, score in self.classes.items()
            },
        }


# --------------------------------------------------------------------- loading


def _rows(directory: Path, name: str) -> list[dict]:
    path = directory / f"{name}.jsonl"
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def scicite(directory: Path) -> list[Instance]:
    """SciCite's excerpts, split at the character offsets the corpus provides.

    Rows whose offsets are missing or out of range are dropped rather than guessed at:
    without knowing where the citation is, "before" and "after" are meaningless and the
    cue tables would read the wrong half of the sentence.
    """
    out: list[Instance] = []
    for split in ("train", "dev", "test"):
        for row in _rows(directory, split):
            text, label = row.get("string") or "", row.get("label") or ""
            start, end = row.get("citeStart"), row.get("citeEnd")
            if not text or label not in SCICITE_LABELS:
                continue
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                continue
            # NaN reaches here as a float and compares false against everything, so it
            # would slip past the range check below and crash the cast.
            if start != start or end != end:
                continue
            start, end = int(start), int(end)
            if not 0 <= start < end <= len(text):
                continue
            out.append(Instance(
                before=text[:start], after=text[end:], sentence=text, gold=label,
            ))
    return out


def acl_arc(directory: Path) -> list[Instance]:
    """ACL-ARC's excerpts, split at the ``@@CITATION`` placeholder.

    ``cleaned_cite_text`` is the field with the marker in it; ``text`` is the raw
    excerpt where the citation is still spelled out, and splitting that would need the
    offsets to be trusted. Rows without the placeholder are dropped and counted.
    """
    out: list[Instance] = []
    for split in ("train", "dev", "test"):
        for row in _rows(directory, split):
            text = row.get("cleaned_cite_text") or ""
            label = row.get("intent") or ""
            at = text.find(_PLACEHOLDER)
            if at < 0 or label not in ACL_ARC_LABELS:
                continue
            out.append(Instance(
                before=text[:at],
                after=text[at + len(_PLACEHOLDER):],
                sentence=text.replace(_PLACEHOLDER, ""),
                gold=label,
            ))
    return out


# --------------------------------------------------------------------- scoring


def score(
    corpus: str,
    instances: list[Instance],
    mapping: dict[Stance, str],
    labels: tuple[str, ...],
    *,
    skipped: int = 0,
) -> Result:
    """Run the shipped classifier over a corpus and tally it per class.

    :func:`keystone.lineage.stance.read` is the same entry point the dossier builder
    uses, guards included, so this measures what a reader actually sees rather than a
    stripped-down version of it.
    """
    result = Result(
        corpus=corpus,
        labels=labels,
        skipped=skipped,
        unreachable=tuple(c for c in labels if c not in set(mapping.values())),
        silent=mapping[Stance.BACKGROUND],
        classes={label: ClassScore(stance=label) for label in labels},
    )
    for item in instances:
        stance, _cue = read(
            item.before, item.after, item.sentence,
            marked_before=item.before, sites=_MARKER,
        )
        predicted = mapping[stance]
        result.instances += 1
        result.classes[item.gold].support += 1
        if predicted in result.classes:
            result.classes[predicted].predicted += 1
        if predicted == item.gold:
            result.hits += 1
            result.classes[item.gold].hits += 1
    return result


def evaluate(directory: Path) -> list[Result]:
    """Every corpus found under ``directory``, scored.

    Missing corpora are skipped silently: the evaluation is only as good as the data
    on disk, and the caller reports what it got rather than failing on what it did not.
    """
    out: list[Result] = []
    for name, loader, mapping, labels in (
        ("SciCite", scicite, TO_SCICITE, SCICITE_LABELS),
        ("ACL-ARC", acl_arc, TO_ACL_ARC, ACL_ARC_LABELS),
    ):
        root = directory / ("scicite" if name == "SciCite" else "acl-arc")
        instances = loader(root)
        if not instances:
            continue
        total = sum(len(_rows(root, split)) for split in ("train", "dev", "test"))
        out.append(score(
            name, instances, mapping, labels, skipped=total - len(instances),
        ))
    return out
