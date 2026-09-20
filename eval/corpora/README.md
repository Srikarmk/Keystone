# Public citation-intent corpora

Keystone's cue rules were written against forty-one papers and measured against ninety
citations from those same forty-one papers. That is a closed loop, and a closed loop
cannot tell you whether rules generalise — so the rules are also scored against two
corpora labelled by other people, neither of which contributed a single cue phrase.

Nothing here is committed. The corpora are not mine to redistribute, and the derived
numbers live in `apps/web/public/dossiers/accuracy.json`, which is. Fetch them once:

```bash
mkdir -p eval/corpora && cd eval/corpora
curl -LO https://s3-us-west-2.amazonaws.com/ai2-s2-research/scicite/scicite.tar.gz
curl -LO https://s3-us-west-2.amazonaws.com/ai2-s2-research/scicite/acl-arc.tar.gz
curl -L -o bioscope.zip https://rgai.inf.u-szeged.hu/sites/rgai.inf.u-szeged.hu/files/bioscope.zip
tar xzf scicite.tar.gz && tar xzf acl-arc.tar.gz && unzip -q bioscope.zip -d bioscope
```

Then, from `services/core`:

```bash
uv run keystone stance-eval --corpora ../../eval/corpora
uv run keystone assumption-eval
```

## What is in them

| | instances | classes | source |
|---|---|---|---|
| **SciCite** | 11,020 | background / method / result | Cohan et al. 2019, Semantic Scholar, biomedicine-heavy |
| **ACL-ARC** | 1,941 | Background / Uses / CompareOrContrast / Extends / Motivation / Future | Jurgens et al. 2018, ACL Anthology |

All three splits of each are scored, not just the test set. Keystone has nothing to
train on, so holding data back would shrink the sample for no gain — and ACL-ARC's test
split is 139 rows, which is the same unfalsifiable size the whole exercise exists to
get away from.

## How the labels line up

SciCite absorbs Keystone's five stances with nothing lost but granularity: `inherits`
and `extends` are both *method*, `contests` and `compares` are both *result*.

ACL-ARC does not. It has *Motivation* and *Future*, and Keystone has no class that can
express either, so those 157 instances are wrong by construction and six-class macro-F1
is capped at 0.667 however good the other four get. The cap is reported rather than
worked around; a four-class score on a hand-picked subset would not be comparable to
anything published, and comparability is the whole reason for running this.

## Published reference points

ACL-ARC, six-class macro-F1:

| | |
|---|---|
| Dong & Schäfer 2011 | 0.233 |
| Teufel 2000, cue phrases + kNN | 0.273 |
| Jurgens 2018, random forest | 0.530 |
| Falcon-7B | 0.733 |

SciCite, three-class macro-F1: neural state of the art 0.84–0.889.

## What the numbers say

Keystone's macro-F1 is **0.325** on SciCite and **0.204** on ACL-ARC — under the
cue-phrase floor from 2000 on the second one. That is the real result and it is not
flattering.

It is also not the number that describes the tool. macro-F1 punishes silence exactly as
hard as error, and Keystone is built to be silent: no cue phrase written down, no stance
reported, nothing shown to the reader. Counting only the citations it did speak about:

| | reads | of those, right |
|---|---|---|
| SciCite | 4.0% | 80.0% [76–84%] |
| ACL-ARC | 8.3% | 68.9% [61–76%] |

So the claim the site makes is that pair, not a macro-F1. The 80% on 11,014 citations
from papers outside the library is the same 80% the ninety hand labels gave, which is
the part of the closed loop that survived contact with somebody else's data. The
coverage is the part that did not: on a broad corpus most citations carry no cue at all
("using CMet cardiac metric software [12]", "the BitPar parser, which is a
state-of-the-art parser of German [12]") and reading those needs a model, not a table.

## What scoring these actually fixed

Both corpora were used once as diagnostics, and both found real defects rather than
just producing a number:

* **136 of 223 `result` readings were wrong**, and they looked like "women are
  disproportionately more frequently affected compared to men [12]" — a comparison
  between two things in the world, with the citing paper on neither side of it.
  Adoption cues had always had to prove the sentence was about this paper; comparative
  cues had not. Now they do, and `result` precision went 0.39 → 0.49, ACL-ARC's
  `CompareOrContrast` 0.56 → 0.78.
* **280 of 364 `Uses` instances were missed** because every adoption cue demanded a
  first-person subject in the same clause, and NLP papers write "employ Collins head
  rules (Collins 1999)". Bare participials now count, subject to the same premise
  check: `Uses` recall 0.22 → 0.28.
* **A paper's own name counts as saying who.** BERT writes "Unlike recent language
  representation models (Peters 2018; Radford 2018), BERT is designed to..." and the
  premise check saw no first person, which cost BERT the two edges it is best known
  for.

None of the three moved the ninety hand labels, which held at 87% accuracy and 0.86
macro-F1 throughout.

---

# The assumption layer, against BioScope

The stance rules were the closed loop that got measured. The assumption layer was in
the same one, so **BioScope** (Vincze et al. 2008) gets pointed at it: 2,566 sentences
of biomedical full papers and 11,858 abstracts, every speculation cue marked by hand.
It is the corpus behind CoNLL-2010, whose Task 1 is sentence-level hedge detection.

| | sentences | flagged | of those, right |
|---|---|---|---|
| BioScope full papers | 2,566 | 19 (0.7%) | **68.4%** [46–85%] |
| BioScope abstracts | 11,858 | 36 (0.3%) | **86.1%** [71–94%] |

**These are not comparable to CoNLL-2010's ~85% F1, and quoting them as if they were
would be dishonest.** BioScope marks every sentence whose claim is qualified — "these
results may indicate a role for X" is hedging and is annotated. Keystone looks for the
narrower case of a paper announcing something it is *taking as given* and moving past.
Hedged reporting of a finding is not that. Recall against BioScope is 2.5% and 1.5%,
and that is the design showing up in the measurement rather than a defect.

What the comparison is genuinely for is the disagreements, and they earned their keep.

**One real defect, now fixed.** "as long as" takes a quantity as readily as a
condition, and the two mean opposite things: *"retained the virus in the latent state
for as long as 45 days"* is a duration, and reading it as a precondition invents an
assumption the paper never made. Guarded, and abstracts precision went 83.8% → 86.1%.

**One fix that looked obvious and measured worse.** The stance rules gained a lot from
requiring a comparative cue to prove the citing paper was a party to the comparison,
and BioScope has a clean case for the same idea on preconditions: *"Productive
infection of T cells with HIV-1 typically requires that the T cells be stimulated"* is
a fact about immunology with no "we" anywhere in it. Applying the check dropped **13 of
the library's 23 conditional assumptions to remove that one false positive**, because a
paper states its preconditions *about its subject matter*, not about itself — Batch
Normalization's is *"the distributions of values of any x has the expected value of 0
and the variance of 1, as long as the elements of each mini-batch are sampled from the
same distribution"*, and AI safety via debate's is *"Debate only works if this revealed
context cannot be a lie"*. Both mention nobody. The check is not in the code, and
`tests/test_hedging.py` holds those two sentences so it does not get added back.

**The remaining ten disagreements are not errors.** "We hypothesize that a mutation of
the hGR glucocorticoid-binding domain is the cause", "It is generally accepted that
Bcl-2 exerts its antiapoptotic effects", "Several steps are omitted for simplicity" —
all assumptions, none of them speculation under BioScope's scheme. So 68.4% and 86.1%
understate the detector against its own task; they are the floor, not the estimate.

Because of that mismatch, **no number from this is published on the site.** The
assumption panel shows counts and quotes and claims no accuracy, which is the honest
state until the actual task has labels of its own.
