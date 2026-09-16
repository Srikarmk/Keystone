# Keystone

**What is this paper standing on?**

**Live:** https://keystone-seven-beta.vercel.app

No paper stands by itself. Each one adopts a method from somebody, argues with somebody
else, and takes a handful of things on faith without flagging them. Keystone reads all
three out of the paper's own LaTeX — not a summary, not a retrieval index, no model in
the loop — and pins each one to the pixels on the page where the paper says it.

The name is the thesis, and it took a pivot to earn it. A keystone is the one stone an
arch collapses without, and for almost every paper that stone belongs to somebody else.

Three things, all quoted rather than inferred:

- **What it stands on.** A citation is not a neutral pointer. "Following
  `\cite{ba2016layer}` we normalise each layer" and "Unlike `\cite{ba2016layer}`, we
  normalise across the batch" are opposite statements about the same paper, and the
  difference is written down. Every citation site is classified from its cue phrase,
  and the cue is shown, so the reading is something you can disagree with.
- **What it takes on faith.** Authors announce their assumptions because the genre
  requires it — "we hypothesize", "for simplicity", "it is well known that". Each is
  quoted next to what the paper offers in the same sentence: a citation, a pointer to
  its own evidence, or nothing at all.
- **The graph.** Where a cited paper is also in the library the edge is walkable in
  both directions, so a paper shows both what it stands on and who stands on it. The
  chain reconstructed from the papers' own sentences: VGG → ResNet → Transformer →
  BERT and ViT, with batch and layer normalisation feeding in.

The library grows along its own citations. `keystone expand` reads every reference the
library already resolves to arXiv, ranks them by how many papers take a stance on each,
and fetches the top of that list — so each new paper arrives with at least one edge
already attached rather than as an isolated node.

> ResNet's central hypothesis — that residual mappings are easier to optimise than
> unreferenced ones — is stated once, in the introduction, with nothing offered for it.
> Page 2.

**Why not audit the arithmetic?** That was the first version, and it shipped. A paper's
numbers can only be reported as an *absence* of errors, and careful papers have none:
across nine foundational papers the check suite correctly produced zero findings, so
its best possible output was a blank page. The numeric analysis is still here — claims
traced to table cells, every number indexed, baselines checked against the papers they
cite — but below the lineage, where a detail belongs. See `RELEASE.md` for the pivot.

Full design and roadmap: `~/.claude/plans/rosy-humming-avalanche.md`.

## Landscape

Two things are true and worth stating plainly.

The mainstream tools — SciSpace, ChatPDF, Elicit, Paperguide, NotebookLM — are all the
same pipeline: chunk, embed, retrieve, answer, cite a page number. They compete on
corpus size and polish, not capability.

But Keystone is *not* the first tool to pin paper criticism to the page.
[Loupe](https://github.com/AIScientists-Dev/loupe) (Apache 2.0) reviews scientific
papers in a cheap triage pass followed by an opt-in deep dive, and pins every finding
to a bounding box verified by a vision model. Someone converging independently on
pixel-pinned findings is evidence the direction is right. Where Keystone differs:

| | Loupe | Keystone |
|---|---|---|
| Verdicts | LLM judgement | **Deterministic code** — statcheck/GRIM recompute, arithmetic re-derivation, abstract↔table tracing |
| Localization | MinerU → markdown, vision pass confirms the box | **Word geometry**, measured: 99.94% verified, 0/359 fabrications anchored |
| Source of truth | OCR'd markdown | **arXiv LaTeX source** — exact equations, table numbers, `\cite` keys |
| Citations | flags "citation required" | **fetches the cited paper** and checks entailment |
| Finding structure | flat severity-ranked list | **claim DAG with load-bearing ranking** |
| Emphasis | proof and reasoning defects | **empirical defects** — baseline fairness, leakage, variance, SOTA scope |

Loupe's issue taxonomy (logic, quantifier scope, missing step) is oriented at proofs.
Keystone's is oriented at experiments, which is where ML/CS papers actually go wrong.

## Status

**Phase 0 (substrate) — anchor gate passed.** The trust primitive is built and
measured. Nothing here calls an LLM yet; it is all deterministic geometry and text.

| Metric | Result | Gate |
|---|---|---|
| Tight anchors surviving independent geometric round-trip | **99.94%** (1755/1756) | ≥ 99% |
| Approximate anchors meeting their weaker contract | **100%** (89/89) | — |
| Real spans wrongly rejected | **0** of 1845 | 0 |
| Anchors landing on the wrong words | **0** of 1845 | 0 |
| Fabricated quotes wrongly anchored | **0** of 359 | 0 |
| arXiv LaTeX source sentences anchored into the PDF | **93.5%** (2666/2852) | ≥ 90% |

Measured over ten arXiv papers spanning the layouts that actually break anchoring:
one and two column, dense display maths, wide benchmark tables, rotated axis labels,
ligatures and combining diacritics.

**Phase 1 (audit engine) — first deterministic checks landed.** Two checks run over
tables built from arXiv LaTeX source, with no model in the loop and no network:

| Metric | Result |
|---|---|
| Findings on nine unmodified, heavily reviewed papers | **0** |
| Recall on deliberately planted defects | **11%** (1/9) |
| Collateral findings caused by one planted defect | **0** |

The recall number is the honest one and the operating point is deliberate. A sweep of
the premise parameters showed the only configurations reaching 33% recall also produced
three or four false positives across the same nine papers. For a tool whose entire
claim is that its findings can be checked rather than trusted, that is the wrong trade.

**Not yet built:** the persistence layer (Postgres + pgvector, docker-compose), claim
and prose extraction, citation faithfulness, and the reader UI. Persistence is
deliberately deferred until there is extracted structure to store.

## Why the anchor layer got this much attention

Every downstream claim depends on it. A finding that says "the abstract reports 94.2%
but Table 3 says 93.8%" is worthless unless the reader can click it and land on both
numbers. Getting there took several rounds of measurement, and the interesting part
was that the first three failures were in the *test*, not the code:

- Round-trip started at **67.6%**. Cause: a tall `(` from a display formula
  legitimately clips into a body line, breaking exact string containment.
- Union bounding boxes let one tall glyph (`→∞`) stretch a line's highlight over the
  whole of the *next* line. Real defect; fixed with median line boxes.
- Content-stream word order and clipped-text order genuinely differ across columns
  and table rows, so any whole-span ordering assertion is invalid. Now checked per
  rectangle, where order is unambiguous — a stricter test, not a looser one.
- **Fuzzy matching accepted 5.9% of fabricated quotes** while matching zero of 1846
  real spans. `partial_ratio` scores the best window, so a single substituted word
  barely moves it: `"Trade, feature 9-50"` scored 93.6 against `"Trade, pages 9-50"`.
  For a tool whose job is verifying what a paper says, that is the worst possible
  failure mode. Fuzzy is now opt-in, with a word-substitution guard.

Anchors **self-report precision** (`tight` / `approximate`), and verification holds
each to its own contract. In stacked geometry — a fraction's numerator over its
denominator — no axis-aligned rectangle can be tight, so an anchor says so instead of
implying a precision it does not have.

## What the checks taught us

Every false positive the suite has ever produced was a *trigger* error, not an
arithmetic error — which is the specific danger of deterministic checking. A check
that computes correctly but fires on the wrong premise asserts nonsense with
certainty, and is worse than a model's hedged guess. The four that reached real
papers:

- **Substring label matching.** `"sum" in "summarization"` and `"avg" in "avg pool"`
  turned a method name and a layer name into aggregate rows, producing 21 high-severity
  findings on correct tables. Labels are now matched whole.
- **Assumed orientation.** Bold marks the best down a column in some tables and across
  a row in others. Assuming the first produced 31 confident findings on one correct
  InstructGPT table. Orientation is now inferred per table and validated.
- **Ignored band structure.** A results table is banded — prior work, a rule, then the
  authors' rows — and "best" is a claim about a band. Judging the Transformer's Table 2
  down the whole column reported the best *ensemble* as a middling value. `\midrule`
  is now kept as structure rather than stripped as formatting.
- **Comparing unlike quantities.** A ResNet row holding mAP@.5 and mAP@[.5,.95] for two
  datasets was compared end to end, reporting the smaller metric as failing to be best.
  Row comparisons now group by the innermost column header when those headers repeat.

The common remedy is the same in each case: **a check must validate its own premise
before stating its conclusion.** A total row is only reported as wrong if it adds up
correctly in some other column; emphasis is only read as "best" if that reading
explains the paper's other markers.

What limits recall is not the arithmetic but the *frame*: whether a table compares
down columns or across rows, and which rows are peers. That is exactly the kind of
judgement the plan assigns to the model — extraction and routing — while the verdict
stays arithmetic.

## Layout

```
services/core/keystone/ingest/
├── normalize.py      skeleton projection: ligatures, accents, dashes, hyphenation
├── pdf.py            MuPDF word geometry — the ground truth
├── anchors.py        quote -> rectangles, with the rejection path
├── verify.py         independent round-trip through MuPDF, per precision contract
├── regions.py        stacked geometry, rotated lines, maths classification
├── furniture.py      running heads, page numbers, the rotated arXiv stamp
├── latex.py          arXiv source: equations, tables, citations, sentence runs
├── arxiv_source.py   e-print fetch, unpack, main-file resolution
├── tables.py         LaTeX tabular -> typed cells, with emphasis and bands
├── assemble.py       ingested sources -> Paper
└── sampling.py       span sampling for the anchor audit

services/core/keystone/
├── audit/numbers.py        number parsing that preserves reported precision
├── audit/registry.py       check registration and the runner
├── audit/checks/tables.py  table consistency checks
├── graph/models.py         the typed structures checks reason over
└── eval/planted.py         planting known defects to measure detection
```

## Running it

```bash
cd services/core && uv sync
```

Fetch the test corpus (ten public arXiv PDFs):

```bash
./eval/fetch_corpus.sh
```

Run the gates:

```bash
cd services/core && uv run pytest -q
```

Audit anchor accuracy across the corpus:

```bash
cd services/core && uv run keystone audit ../../eval/corpus/pdf/*.pdf --samples 150 --hyphen-samples 40
```

Measure how much arXiv LaTeX source anchors back into each PDF:

```bash
cd services/core && uv run keystone source-audit ../../eval/corpus/pdf/*.pdf
```

Run the deterministic checks, and measure them against planted defects:

```bash
cd services/core && uv run keystone check 1706.03762 1810.04805
```

```bash
cd services/core && uv run keystone planted-audit 1706.03762 1512.03385 1810.04805 --verbose
```

Inspect one quote, and render its highlight to an image to eyeball:

```bash
cd services/core && uv run keystone probe ../../eval/corpus/pdf/1706.03762.pdf "The Transformer allows for significantly more parallelization"
```

## The arXiv source path

For any arXiv paper the actual LaTeX is available at `arxiv.org/e-print/{id}`, which
gives exact equations, table numbers as the author wrote them, and real `\cite` keys —
none of which are reliably recoverable from rendered glyphs. Source-derived text is
then anchored back into the PDF so those facts still have pixel coordinates.

Sentence-level alignment reached 93.5% through four fixes, each found by measurement:
expanding argument-less user macros (`\etal`, a method shorthand) that otherwise leave
holes where the PDF shows text; brace-matched removal of macro *definitions*, since
nested braces defeat a regex; excluding page furniture; and splitting runs into
sentences.

Submissions that wrap a pre-compiled PDF (`\includepdf`) raise `SourceUnavailable`
rather than returning an empty document — reporting "no equations, no tables" would be
a false statement about the paper rather than an absence of information about it.
