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
tar xzf scicite.tar.gz && tar xzf acl-arc.tar.gz
```

Then, from `services/core`:

```bash
uv run keystone stance-eval --corpora ../../eval/corpora
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
