"""The hand-labelled sample, and what it measures.

The cue classifier is a set of rules over prose, and rules over prose are a claim
about language that only labelled data can falsify. Three rounds of reading the output
by hand found four confidently wrong edges that 146 unit tests had passed, which is
the whole argument for this file existing: the tests check the rules, and only labels
check whether the rules are right.

Two things are measured here, and they need different data:

* **Precision** needs the system's own predictions judged right or wrong, so the
  sample is drawn from what it emitted.
* **Recall** needs the stances it *missed*, which only show up if citations it called
  ``background`` are labelled too. Sampling only the positives would report a
  flattering precision and no recall at all.

So the label is a *gold stance*, not a verdict, and the sample is stratified over what
the system predicted. A row where predicted and gold differ is a real error either
way round.

The baseline is deliberately weak and deliberately present. "The rules beat nothing"
is not a result; "the rules beat a bag-of-words classifier trained on the same
sentences" is one, and it is the comparison that says whether the linguistic work
earned its keep.
"""

from __future__ import annotations

import json
import math
import random
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

#: Every stance a citation can be labelled with, including the negative class.
STANCES = ("inherits", "extends", "contests", "compares", "background")

#: Cue words the rules key on. Stripped before the baseline sees a sentence, so the
#: baseline has to learn from the rest of the language rather than re-reading the
#: feature the rules already use. Without this it is not a baseline, it is the same
#: classifier with extra steps.
_CUE_WORDS = re.compile(
    r"\b(?:follow\w*|unlike|contrast|contrary|instead|rather|whereas|adopt\w*|"
    r"employ\w*|use[ds]?|using|extend\w*|build\w*|inspired|motivated|compare\w*|"
    r"outperform\w*|baseline\w*|versus|vs|differs?|depart\w*|same|identical|"
    r"based|standard|propose[ds]?)\b",
    re.IGNORECASE,
)

_WORD = re.compile(r"[a-z][a-z'-]+")


@dataclass(frozen=True, slots=True)
class Row:
    """One labelled citation site."""

    paper: str
    key: str
    predicted: str
    sentence: str
    cue: str
    section: str
    gold: str | None = None
    note: str = ""
    split: str = "tuned"
    """``tuned`` if the rules were changed after seeing this row, ``heldout`` if not.

    Kept because the difference matters and is easy to lose. The first sixty rows
    found a bad cue and the rules were fixed against them, so their score stopped
    being an estimate of anything the moment that happened. Only rows drawn afterwards
    measure the rules rather than the fitting.
    """

    @property
    def labelled(self) -> bool:
        return self.gold in STANCES

    def to_dict(self) -> dict:
        return {
            "paper": self.paper,
            "key": self.key,
            "predicted": self.predicted,
            "gold": self.gold,
            "cue": self.cue,
            "section": self.section,
            "sentence": self.sentence,
            "note": self.note,
            "split": self.split,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> Row:
        return cls(
            paper=raw["paper"],
            key=raw["key"],
            predicted=raw["predicted"],
            sentence=raw["sentence"],
            cue=raw.get("cue", ""),
            section=raw.get("section", ""),
            gold=raw.get("gold"),
            note=raw.get("note", ""),
            split=raw.get("split", "tuned"),
        )


def load(path: Path) -> list[Row]:
    """Read a JSONL label file, skipping blank lines and ``#`` comments."""
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        rows.append(Row.from_dict(json.loads(line)))
    return rows


def write(path: Path, rows: list[Row]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(row.to_dict(), ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def sample(
    pool: list[Row], per_stance: int, seed: int = 0, existing: list[Row] | None = None
) -> list[Row]:
    """A sample stratified over the predicted stance.

    Stratified because the classes are wildly unbalanced — 1,753 background citations
    against 323 stanced ones in the current library — so a uniform draw would be
    almost entirely background and measure nothing about the interesting classes.
    Stratifying costs the ability to read the numbers as corpus-wide rates, which is
    why ``report`` prints per-class counts rather than one headline accuracy.
    """
    already = {(row.paper, row.key) for row in (existing or [])}
    buckets: dict[str, list[Row]] = defaultdict(list)
    for row in pool:
        if (row.paper, row.key) not in already:
            buckets[row.predicted].append(row)

    rng = random.Random(seed)
    out: list[Row] = []
    for stance in STANCES:
        rows = sorted(buckets.get(stance, []), key=lambda r: (r.paper, r.key))
        rng.shuffle(rows)
        out.extend(rows[:per_stance])
    return out


# ----------------------------------------------------------------------- metrics


@dataclass
class ClassScore:
    stance: str
    support: int = 0       # gold instances
    predicted: int = 0     # times the system said this
    hits: int = 0          # both agree

    @property
    def precision(self) -> float | None:
        return None if self.predicted == 0 else self.hits / self.predicted

    @property
    def recall(self) -> float | None:
        return None if self.support == 0 else self.hits / self.support


def wilson(hits: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """A 95% interval on a proportion, by the Wilson score method.

    Reported because the point estimate on its own invites a claim the sample cannot
    support. At 80% on 30 rows the interval runs from about 60% to 88% — wide enough
    that "competitive with a trained classifier" and "barely beats bag-of-words" are
    both inside it. Wilson rather than the normal approximation because the normal one
    misbehaves at small n and near the ends, which is exactly this situation.
    """
    if n == 0:
        return (0.0, 0.0)
    p = hits / n
    denominator = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denominator
    spread = z / denominator * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2))
    return (max(0.0, centre - spread), min(1.0, centre + spread))


def macro_f1(classes: dict[str, ClassScore]) -> float:
    """Unweighted mean F1 over the classes that occur.

    The field reports macro-F1 for citation-intent work, not accuracy, because
    `background` is half of every corpus and accuracy flatters anything that predicts
    it well. Reported here so the number is comparable to published work at all.
    """
    scores = []
    for c in classes.values():
        if c.support == 0 and c.predicted == 0:
            continue
        precision, recall = c.precision or 0.0, c.recall or 0.0
        scores.append(
            0.0 if precision + recall == 0
            else 2 * precision * recall / (precision + recall)
        )
    return sum(scores) / len(scores) if scores else 0.0


@dataclass
class Report:
    rows: int
    classes: dict[str, ClassScore] = field(default_factory=dict)
    accuracy: float = 0.0
    interval: tuple[float, float] = (0.0, 0.0)
    macro_f1: float = 0.0
    baseline_accuracy: float = 0.0
    baseline_macro_f1: float = 0.0
    majority_accuracy: float = 0.0
    confusions: Counter = field(default_factory=Counter)


def score(rows: list[Row], predictions: list[str] | None = None) -> dict[str, ClassScore]:
    """Per-class precision and recall of ``predictions`` against the gold labels."""
    labelled = [row for row in rows if row.labelled]
    guesses = predictions if predictions is not None else [r.predicted for r in labelled]
    classes = {stance: ClassScore(stance) for stance in STANCES}

    for row, guess in zip(labelled, guesses, strict=True):
        assert row.gold is not None
        classes[row.gold].support += 1
        if guess in classes:
            classes[guess].predicted += 1
            if guess == row.gold:
                classes[guess].hits += 1
    return classes


def report(rows: list[Row]) -> Report:
    """Everything the pitch claims to measure, on whatever has been labelled."""
    labelled = [row for row in rows if row.labelled]
    out = Report(rows=len(labelled))
    if not labelled:
        return out

    out.classes = score(labelled)
    hits = sum(1 for r in labelled if r.predicted == r.gold)
    out.accuracy = hits / len(labelled)
    out.interval = wilson(hits, len(labelled))
    out.macro_f1 = macro_f1(out.classes)

    golds = [r.gold for r in labelled]
    majority = Counter(golds).most_common(1)[0][0]
    out.majority_accuracy = sum(1 for g in golds if g == majority) / len(golds)

    baseline = leave_one_out(labelled)
    out.baseline_accuracy = (
        sum(1 for guess, row in zip(baseline, labelled, strict=True) if guess == row.gold)
        / len(labelled)
    )
    out.baseline_macro_f1 = macro_f1(score(labelled, baseline))

    for row in labelled:
        if row.predicted != row.gold:
            out.confusions[(row.gold, row.predicted)] += 1
    return out


# ---------------------------------------------------------------------- baseline


def _features(sentence: str) -> list[str]:
    """Words of the sentence with the rules' own cue vocabulary removed."""
    return _WORD.findall(_CUE_WORDS.sub(" ", sentence.lower()))


def _train(rows: list[Row]) -> tuple[dict[str, Counter], Counter, set[str]]:
    counts: dict[str, Counter] = {stance: Counter() for stance in STANCES}
    priors: Counter = Counter()
    vocab: set[str] = set()
    for row in rows:
        assert row.gold is not None
        priors[row.gold] += 1
        words = _features(row.sentence)
        counts[row.gold].update(words)
        vocab.update(words)
    return counts, priors, vocab


def _predict(
    sentence: str, counts: dict[str, Counter], priors: Counter, vocab: set[str]
) -> str:
    """Multinomial naive Bayes with add-one smoothing."""
    words = _features(sentence)
    total = sum(priors.values()) or 1
    best, best_score = "background", -math.inf
    for stance in STANCES:
        if priors[stance] == 0:
            continue
        score_ = math.log(priors[stance] / total)
        denominator = sum(counts[stance].values()) + len(vocab) + 1
        for word in words:
            score_ += math.log((counts[stance][word] + 1) / denominator)
        if score_ > best_score:
            best, best_score = stance, score_
    return best


def leave_one_out(rows: list[Row]) -> list[str]:
    """Baseline predictions, each made without having seen its own row.

    Leave-one-out rather than a split: the sample is small enough that a held-out
    tenth would be a handful of rows and the number would be noise.
    """
    out = []
    for i in range(len(rows)):
        rest = rows[:i] + rows[i + 1 :]
        counts, priors, vocab = _train(rest)
        out.append(_predict(rows[i].sentence, counts, priors, vocab))
    return out
