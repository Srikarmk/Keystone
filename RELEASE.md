# Keystone — release tracker

Working document. Every claim of status here is either measured or marked as not
started; nothing is marked done on the strength of intent.

**Last updated:** 2026-09-16
**Current stage:** pre-alpha — pivoted from auditing numbers to reading lineage; reader
and library graph shipped; no persistence, no credentials configured

---

## The pivot (2026-09-16)

**The numeric audit was structurally a dead end, and shipping it proved it.**

A paper's arithmetic can only be reported as an *absence* of errors, and careful papers
have none. Across nine foundational papers the check suite produced **zero findings** —
correctly. Its best possible output was a blank page. No amount of extra checks fixes
that, because the thing being measured is usually fine.

What replaced it asks a question that has a real answer on a correct paper: **what does
this paper stand on, what does it argue with, and what does it take on faith?**

| | Numeric audit | Lineage |
|---|---|---|
| Output on a good paper | nothing | 48 dependencies, 13 disputes, 40 assumptions |
| Evidence shown | arithmetic | the paper's own sentence, with the cue that placed it |
| Failure mode | silence indistinguishable from a bug | a reading you can disagree with, quoted |
| Cross-paper | one check, needs a comparison table | the whole model |

Three things are read straight out of the LaTeX, no model in the loop:

1. **Stance per citation.** A citation is not a neutral pointer. "Following
   `\cite{ba2016layer}` we normalise each layer" and "Unlike `\cite{ba2016layer}`, we
   normalise across the batch" are opposite statements about the same paper, and the
   difference is *written down*. `lineage/stance.py` classifies each citation site as
   inherits / extends / contests / compares / background from cue phrases, and reports
   the cue verbatim so the reading is arguable.
2. **Assumptions.** Authors announce them, because the genre requires it — "we
   hypothesize", "for simplicity", "it is well known that". Each is quoted with what
   the paper offers in the same sentence: a citation, a pointer to its own evidence, or
   nothing. `lineage/assumptions.py`.
3. **The graph.** Stanced citations resolve to real papers, and where the cited paper
   is in the library the edge is walkable in both directions. `lineage/graph.py`.

**Measured, 42 papers:** 168 load-bearing dependencies · **175 bare
assumptions** · **52 edges run between papers in the library**, each one
carrying the sentence that placed it. The chain is the real one: VGG → ResNet →
Transformer → BERT / ViT / LLaMA, with batch and layer normalisation feeding in, and
Attention Is All You Need the most connected node at degree 14.

What this makes possible that the audit could not: *"ResNet's central hypothesis — that
residual mappings are easier to optimise than unreferenced ones — is stated once, in the
introduction, with nothing offered for it."* True, quoted, anchored to page 2, and about
one of the most-cited papers in the field.

### What the pivot cost

- **The 3D arch is gone.** It encoded numeric coverage, which no longer exists, so it
  could not survive the pivot. `components/Arch.tsx` and the three.js dependencies are
  removed. The hero is now the library graph — SVG, for the reason the reader already
  learned: this thing's job is to be hovered, and canvas picking against a drifting
  camera loses the raycast.
- **The numeric analysis is kept, demoted.** Claims, numbers, tables, equations and the
  cross-paper baseline check all still work and are all still in the reader — below the
  lineage, where a detail belongs.

---

## Platform audit (2026-09-17)

An audit across all 42 papers of what the reader actually shows and how much of it is
anchored. Three defects, in descending severity.

### A published paper was the wrong paper

arXiv:1909.08593 is *Fine-Tuning Language Models from Human Preferences*. Its e-print
archive contains **GPT-2's paper** — a template the authors reused without replacing
the body. Nothing crashed, and the dossier published seven citation stances quoting
sentences like *"On the WMT-14 English-French test set, GPT-2 gets 5 BLEU"* under the
wrong paper's name.

The tell was in the audit before the cause was: **0 of 7** of that paper's edges
anchored, against 91% across the library. Everything Keystone shows assumes the source
and the PDF are the same document, and that assumption had never been checked.

`ingest/alignment.py` now checks it before anything is extracted: a random sample of
40 source sentences is located in the PDF, and below 25% the build refuses with
`SourceUnavailable` rather than publishing. The gate is decisive rather than marginal —
across the corpus the lowest *passing* paper locates **78%** of its sample and the
mismatched one located **0%**, a 53-point gap. The rate is published in each dossier,
because it is the number that decides whether anything else there can be trusted.

Sampled rather than taken from the front, deliberately: a paper's first page is its
title and authors, which is exactly the part that survives a template reuse.

### Claims anchored at 63% where everything else was at 91%

A lineage edge keeps its LaTeX, so it can be split at the citation *before* stripping
and anchored on the longest clean run. A claim's sentence arrives already stripped, so
the citation is a single space by then and there is nothing to split at — 37% of claims
had no anchor and no "show on page" at all.

`DocIndex.locate_longest` narrows to the longest prefix or suffix the page actually
contains, found by bisection on the cheap membership test and then verified through the
ordinary `locate`. It only ever narrows, and refuses below 40% of the sentence, so a
highlight is never offered on a fragment that misrepresents where the claim is.

### Quotations with holes in them

Twelve assumption quotes were displayed with their inline maths deleted. Batch
Normalization's read *"If we assume that and are Gaussian and uncorrelated, and that is
a linear transformation"*. `strip_markup` removes `$...$` because rendered maths cannot
be reconstructed from source — correct for text that has to appear verbatim on a page,
wrong for text a human reads. `readable_prose` keeps maths that is only a number and
turns the rest into an ellipsis, so the sentence reads correctly and is honest about
what was elided. Anchoring still uses the exact text.

---

## Auditing the pitch's claims against the demo (2026-09-17)

Every claim on the submitted pitch slide was checked against what a visitor actually
sees. Three held, three needed work, and one number moved.

**Held.** The slide's headline row — *"In contrast to prior embeddings [A], BERT
[B] … ARGUES WITH [A] · not [B]"* — is live and correct: BERTScore's dispute resolves
to GloVe and word2vec, and BERT is not in that list. The Transformer's page shows
*"We employ a residual connection … followed by layer normalization"* as an adoption
of Layer Normalization, anchored to page 3. Both are the examples the slide names.

**The "stands on" headline was arbitrary.** Four of the Transformer's adoptions sit in
its method section, all anchored and all in the library, so every tiebreak came out
level and `min()` returned whichever citation key sorted first: *Rethinking the
Inception Architecture*, cited once for label smoothing. Order of first mention now
breaks the tie, on the principle that a paper describes what its architecture is built
from before it reaches training details. Every headline in the library changed for the
better — Transformer → ResNet, BERT / ViT / LLaMA → Transformer, ResNet → Batch
Normalization, BERTScore → BERT.

**The measurement the pitch promises now exists.** `keystone stance-sample`,
`stance-refresh` and `stance-eval`, with 90 citation sites labelled by hand in
`eval/labels/stance.jsonl`:

| | rows | accuracy |
|---|---|---|
| Cue rules, **held out** | 30 | **80%** |
| Cue rules, tuned on | 60 | 90% |
| Bag-of-words naive Bayes, leave-one-out, cue words stripped | 90 | 64% |
| Majority class | 90 | 32% |

The two splits are reported separately because the first sixty found a bad cue and the
rules were fixed against them, which is exactly when a number stops estimating
anything. Per class, on all 90: `extends` 100% precision, `background` 92%, `inherits`
90%, `compares` 73%, `contests` 69%.

The first run scored **72%** overall with `compares` at **25% precision**, and one cue
was responsible for 8 of the 17 errors: `state of the art`. "LSTMs have been firmly
established as state of the art approaches" describes the field's status quo, it does
not measure this paper against anything. Removing it, treating a colon as part of a
clause rather than a break, and refusing a contrastive cue that has an adoption cue
between it and the citation took the suite to 87% overall.

**The site now publishes its own error rate.** A tool whose claim is that its readings
are checkable should say how often they are wrong, so the home page and every paper's
report state the figure and its interval, read from a file `stance-eval` writes so the
published number cannot drift from the labels.

---

## Scored against somebody else's labels

Everything above was measured on ninety citations drawn from the same forty-one papers
the cue rules were written against. That is a closed loop, and a closed loop cannot say
whether rules generalise. Two public corpora can: **SciCite** (11,014 contexts, Cohan
et al. 2019) and **ACL-ARC** (1,941, Jurgens et al. 2018), neither of which contributed
a cue phrase. All three splits of each are scored — Keystone has nothing to train on,
and ACL-ARC's test split is 139 rows, the same unfalsifiable size this exercise exists
to escape.

| | citations | read | of those, right | macro-F1 |
|---|---|---|---|---|
| SciCite | 11,014 | 4.0% | **80.0%** [76–84%] | 0.325 |
| ACL-ARC | 1,941 | 8.3% | **68.9%** [61–76%] | 0.204 |

Published reference points on ACL-ARC: cue phrases (Teufel 2000) 0.273, random forest
(Jurgens 2018) 0.530, Falcon-7B 0.733. On SciCite, neural state of the art is
0.84–0.889. **Keystone's macro-F1 is below the 2000-era cue-phrase floor on ACL-ARC**,
and that is the honest result. It is also the wrong metric for this tool: macro-F1
punishes silence exactly as hard as error, and silence is the design. The pair that
describes it is coverage and precision-when-it-speaks, so the site quotes that pair and
reports the macro-F1 next to it rather than instead of it.

The 80% on 11,014 citations from papers outside the library is the same 80% the ninety
hand labels gave — the part of the closed loop that survived contact with other
people's data. The coverage is the part that did not.

**Three real defects, found by scoring rather than by reading.**

1. **136 of 223 `result` readings were wrong**, and they looked like "women are
   disproportionately more frequently affected compared to men [12]" and "15 of 50 SspA
   orthologs contain either Asp or Glu at position 92 instead of Tyr [12]" — comparisons
   between two things in the subject matter, with the citing paper on neither side.
   Adoption cues had always had to prove the sentence was about this paper; comparative
   ones had not. Now every cue in front of a citation does. `result` precision 0.39 →
   0.49, ACL-ARC's `CompareOrContrast` 0.56 → 0.78, and on the hand labels `compares`
   went from 73% precision to 100%.
2. **280 of 364 `Uses` instances were missed** because every adoption cue demanded a
   first-person subject in the same clause, and NLP papers write "employ Collins head
   rules (Collins 1999)". Bare participials now count, subject to the same premise
   check. `Uses` recall 0.22 → 0.28.
3. **A paper's own name counts as saying who.** BERT writes "Unlike recent language
   representation models (Peters 2018; Radford 2018), BERT is designed to..." and the
   premise check saw no first person, which cost BERT the two edges it is best known
   for. The name comes from the title where there is one ("BERT:", "LLaMA:") and
   otherwise from the abstract's own introduction of it — "we propose a new simple
   network architecture, the Transformer" — held to a mention count and a blocklist of
   the field's own vocabulary, because reading "GNNs" or "MNIST" as a paper's name
   loosens the check on exactly the papers that discuss them most. Twenty of the
   forty-one papers name themselves; none of the twenty is wrong.

**And one bug the same work exposed in the harness itself.** `stance-refresh` keyed its
lookup on the rendered sentence, so improving how a citation reads for a reader made
every labelled row stop matching — and a row that does not match keeps its old
prediction. The first run after that reported 59% accuracy where the true figure was
83%, all of the difference being sites re-measured at the wrong sentence. The identity
of a labelled site is now the stripped text the rules actually read, held apart from
the display text, and a row that fails to match is a loud non-zero exit rather than a
line of output. A stale prediction reported as a fresh measurement is the exact failure
that command exists to prevent.

### The number on the slide moved: 52 -> 46

Six of the 52 walkable edges were `state of the art` false positives. Removing that cue
removed them, so the library now shows **46**. The slide's 52 was an over-count, and
correcting it was the right call: keeping known-false edges to protect a figure would
invert the product's entire argument.

### A false finding from a parsing gap

Restoring the cross-paper baseline check surfaced three findings on VGG — "Table 7
attributes 7.9 to *Going deeper with convolutions*, which does not report it". GoogLeNet
reports **7.89%**. Two separate defects had to combine to produce that:

* **Maths-mode cells were being dropped.** `strip_markup` deletes `$...$` because
  rendered maths cannot be reconstructed from source — right for prose, wrong for a
  table cell, where the common case is a number someone typeset in maths mode.
  GoogLeNet writes its entire top-5 error column as `$7.89\%$`, so every value in it
  vanished. Cells whose maths is *just a number* are now unwrapped; anything with
  structure is still stripped.
* **The comparison demanded exact equality.** A paper tabulating someone else's result
  rounds it, so VGG's 6.7 never matched GoogLeNet's 6.67. It now compares at the
  reported precision using `rounds_to`, which was already in the codebase for exactly
  this reason and simply was not being used here.

A false finding produced by a parsing gap is the worst output this system can emit, and
it was only caught by following one implausible number back to its source.

---

## Resolving a citation to a paper (2026-09-16)

An edge exists when a cited work turns out to be a paper the library has ingested, and
these papers cite each other's *conference* versions — so matching on arXiv identifiers
alone found one edge in the whole library. Matching on titles finds the real lineage,
and it is also the one place this system can produce a confidently wrong answer, so the
rule took three attempts:

1. **The paper's own title.** Broke on arXiv:1909.08593, whose LaTeX carries
   `\icmltitle{Language Models are Unsupervised Multitask Learners}` — a stale ICML
   template copied from GPT-2. Every citation of GPT-2 would have pointed at the RLHF
   paper instead.
2. **Attestation required** — a title only counts if some bibliography prints it
   alongside that same arXiv identifier. Correct, and too strict: a reference can only
   attest when it *already* carries an identifier, and those are exactly the references
   that never needed a title match. Cost nine real edges.
3. **Attested first, own title with a collision guard.** Independent evidence wins where
   it exists; otherwise a paper resolves by its own title unless that name is already
   claimed — by another paper's attestation, or by another library paper. Ambiguity
   resolves to nothing, which is the answer the anchor layer gives too.

### A contrastive cue takes one object; an adopting cue takes a list

Reading the four cross-library disputes the graph produced found two of them false, and
both the same shape. BERTScore writes:

> "In contrast to prior word embeddings [cite], contextual embeddings, such as **BERT**
> [cite] and **ELMo** [cite], can generate different vector representations..."

The contrast is with the *first* citation. BERT and ELMo are examples of the favoured
side, and they were inheriting a cue already spoken for — so Keystone recorded BERTScore
as disputing the two papers it is built on.

The rule now: a contrastive cue is spent on the nearest citation after it, so a later
citation in the same clause gets nothing. Adopting cues are untouched and still
distribute — "We employ a residual connection [cite] ... followed by layer
normalization [cite]" adopts both, which is what the sentence says. This is the fourth
instance of one pattern, and it is worth naming: **a cue read out of position does not
produce a vague answer, it produces a confident opposite one.**

### Reading the output found what the tests could not

Both of the false disputes above, and two more in the dominant `inherits` category,
were found by **reading a random sample of the sentences the system produced** — not by
a test. The audit is worth running by hand after any change to the cue rules:

| Sampled | Found wrong | Cause |
|---|---|---|
| 4 of 4 contests | 2 | contrastive cue reaching past its object |
| 9 of 42 inherits | 1 | "instruction **following** for navigation" — a gerund, not a cue |
| 10 of 41 inherits | 1 | *"Following [X], many recently trained models have..."* — a survey of the field, not an adoption |

The third one produced a new rule: **an adoption is a claim about this paper, so the
sentence has to be about this paper.** A cue that is already first-person ("we follow")
carries its own subject; "Following", "As in" and "based on" do not, and now require a
`we`/`our`/`this paper` somewhere in the sentence. It costs passive constructions —
"the weights are initialised as in [cite]" is a real adoption this will miss — which is
the trade made everywhere here: a missed edge over a wrong one.

This is also the design's saving grace. Every row shows the sentence and the cue that
placed it, so a wrong reading is visible rather than hidden behind a verdict.

Two smaller ones fell out of the same work. A paper's name is often a macro
(`\title{\bertscore: Evaluating...}`), and stripping it unexpanded left three titles
beginning with a colon. And `display` seeded from the committed index *before* a fresh
reading, so a title that was misread once survived every later rebuild.

Six tests cover the rule directly, including the GPT-2 collision.

---

## What growing the corpus broke (2026-09-16)

Expanding from 9 papers to 35 was the first real test the check suite had, and it
failed it. `table.emphasis_not_best` went from **0 findings to 69**, and not one of
them is verifiable as real:

- **57 came from a single CLIP table** whose caption says outright that it highlights
  "Scores within the 99.5% Clopper-Pearson confidence interval of each dataset's best
  score" — statistical *ties*, not the single best. A new premise test reads that class
  of caption and drops those tables, which removed 56 of the 69.
- **The remaining 13 cannot be dismissed or confirmed without reading six papers.**
  Several captions declare a best scoped to a group ("we bold the best task-specific
  and task-agnostic metrics"); one bolds correlations in a column whose values straddle
  zero. In every case the premise is a convention the check cannot establish.

**So the check is retired** — not deleted. Its rule is sound: a cell that is neither
the largest nor smallest of its group cannot be best under either polarity. Soundness
was never the problem; the premise was, and on nine hand-picked papers it happened to
hold. A check whose findings cannot be vouched for must not ship, because the suite's
precision is the product's entire claim.

Two tests now hold that decision in place rather than a comment: one asserts the
arithmetic still catches planted defects, and one asserts that it *does* fire on
unmodified papers. If a future premise fix makes the second test fail, the check has
earned its place back and the test should be deleted with it.

**The gate corpus is now named explicitly.** It was a directory glob, and the reader's
library shares that directory — so `keystone expand` silently quadrupled what every
gate measured and a regression threshold changed meaning without anyone touching a
test. A gate whose population moves is not a gate.

---

## Where we actually are

| Area | Status | Evidence |
|---|---|---|
| PDF anchoring (quote → pixel rects) | **Done, gated** | tight anchors 99.94% (1755/1756); 0 real spans rejected; 0 fabrications anchored of 359 |
| arXiv LaTeX source ingest | **Done** | 93.5% of source sentences anchor into the PDF (2666/2852) |
| Typed tables from source | **Done** | emphasis, band structure, spanning headers, 9 papers parsed |
| Number parsing with precision | **Done** | `Decimal` + written quantum; unit/percent/scale handling |
| Deterministic check suite | **1 check** | `table.aggregate_mismatch` only; 0 findings on 35 unmodified papers. `emphasis_not_best` retired — see below |
| Library expansion | **Done** | `keystone expand`; library grew 9 -> 42 papers, walkable edges 7 -> 52 |
| Title resolution | **Done, guarded** | attested-first with a collision guard; a paper's own source is not evidence about itself |
| Dark pages | **Done** | opt-in per paper, hue-rotated so figure colours survive; highlights switch to `screen` blending |
| Reverse lineage | **Done** | "what stands on this" — the inbound edges, which only become useful as the corpus grows |
| Citation stance (inherits/contests/…) | **Done, tested** | 87 stanced of 386 citations across 9 papers; 43 tests incl. negation, clause scope, first-person subject |
| Assumption ledger | **Done, tested** | 40 assumptions, 30 bare; each quoted with what the sentence offers |
| Lineage graph across the library | **Done** | 7 walkable edges from 9 papers, every one carrying its sentence |
| Cross-paper baseline check | **Done** | 11 baseline figures confirmed against their source papers; catches a planted mis-copy; 0 false positives |
| Citation index | **Done** | 427 references parsed offline from 9/9 papers; 144 carry an arXiv id |
| Ask the paper | **Built, needs a key** | grounded on the paper's prose + traced numbers; streams; 1h cached prefix |
| Dark mode | **Done** | follows system preference, no first-paint flash |
| Planted-error harness | **Done** | `keystone planted-audit`, regression-tested |
| Section segmentation | **Done** | abstract / intro / conclusion typed from LaTeX, bibliography excluded |
| Claim tracing + coverage map | **Done** | 9 papers; 15/30 headline claims traced to a table cell |
| Keystone (load-bearing table) | **Done** | computed deterministically; no model involved |
| Reader UI | **Done, runnable** | Next.js, builds static, 151 kB first load |
| Persistence (Postgres, pgvector) | **Not started** | `infra/` is empty |
| Prose *claim* extraction (beyond numbers) | **Not started** | needs credentials |
| Citation faithfulness | **Not started** | |
| Auth, accounts, metering | **Not started** | |

Test suite: **158 passing**, ~27s, no network, no API key.

---

## Positioning decision (2026-09-15)

Reviewed alphaXiv ($7M seed, Menlo + Haystack). It is a **comprehension and discovery**
layer over arXiv: AI Overview, Ask AI grounded in the paper, line-by-line comments,
Deep Research lit review, follow graph, browser extension, MCP server, URL swap.
Its own paper pages carry no fact-checking, error detection, or critique, and a review
notes its summaries "paraphrase confidently, even when slightly wrong."

That is a different axis, not a feature gap:

> **alphaXiv tells you what a paper says. Keystone tells you what it rests on, and
> how much of that we could verify.**

### The reframe this forces

Measured recall on planted defects is **11%**, and the suite found **zero** errors
across nine good papers. A product whose headline is "errors found" therefore shows an
empty screen on most papers, and dies in a demo. So the headline is not errors. It is
two things that exist on *every* paper, error or not:

1. **The keystone claim** — which single number or assumption the most headline claims
   depend on, and what falls if it is wrong. Requires the claim DAG. Nobody computes it.
2. **A verification coverage map** — "47 numbers in the abstract and intro; 44 trace to
   a table cell; 3 could not be traced." Honest, useful, and unfakeable.

Coverage turns our real limitation into the credibility argument. No competitor states
what they checked, because none of them check anything.

### Why this is defensible

Every competitor's output is **unfalsifiable** — you cannot tell a summary is wrong
without doing the work yourself. Ours is **falsifiable by construction**: two numbers,
both anchored, checkable in three seconds. Three things follow that a comprehension
tool cannot reach without becoming a different product:

- **A different customer.** Readers read many papers; authors submit one, with a
  deadline and stakes. "Check my paper before I submit" is the moment of maximum
  willingness to pay, and it is author-side, where alphaXiv does not play.
- **Publishable output.** A checkable report is a citable artifact. An AI summary is not.
  This is what makes shareable dossiers a growth loop rather than a vanity feature.
- **Cross-paper number provenance.** When paper B reports paper A's baseline in its
  comparison table, does it match what A actually reported? Deterministic, high hit
  rate, and only possible because we hold LaTeX source for both.

### Borrow (validated, cheap for us)

- [ ] **URL swap** — `alphaxiv.org/abs/X` proved this works. We already key on arXiv id.
      Highest leverage distribution mechanism available to us.
- [ ] **MCP server** — better fit for us than for them: structured findings are an ideal
      MCP payload. "Verify this paper" from inside Claude or Cursor.
- [ ] **Browser extension**
- [ ] **No account required to read** — friction kills first use.

### Do not chase

Comments and social (their network, brutal cold start), Deep Research / lit review
(commodity, better funded), explore / trending / follow graph, audio summaries.

---

## Release gates

### Gate A — internal alpha (you, daily use)

Purpose: does this earn a place in your own reading?

- [x] Numeric-mention extraction from headline sections
- [x] `headline_table_mismatch` check landed (fully deterministic)
- [x] Keystone (load-bearing table) computed
- [x] Coverage map computed
- [x] One end-to-end run on 9 papers, output eyeballed
- [x] Reader that makes the analysis legible in ten seconds
- [ ] Persistence: Postgres + pgvector, docker-compose, schema for `PaperGraph`
- [ ] `keystone ingest <arxiv-id>` produces a stored, queryable paper
- [ ] Ingest an arbitrary arXiv id from the UI rather than a prebuilt set
- [x] Anchor the claims and cells to PDF pixels in the reader
- [x] Reader laid out as a scrolling report rather than a tab bar (see below)
- **Exit criterion:** you run it on a paper you are actually reading, unprompted, twice
  in one week.

### Gate B — closed alpha (10–20 testers)

Purpose: is the output trustworthy to someone who did not build it?

- [x] Reader UI: PDF + highlight overlay + dossier panel
- [x] Click a finding → both sides highlight in the PDF
- [x] Coverage map rendered, not just computed
- [ ] SSE progress so the dossier fills in live
- [ ] Ingest from arXiv id *and* PDF upload
- [ ] Graceful, explicit degradation when LaTeX source is unavailable (~1 in 10 papers)
- [ ] Error states: paper not found, source unavailable, ingest failed, timeout
- [ ] Per-paper cost logged; a hard ceiling that stops a runaway ingest
- [ ] Feedback capture on every finding: "this is wrong" / "this is useful"
- **Exit criterion:** ≥ 10 testers, ≥ 50 papers ingested, **zero** confirmed false
  findings. One false positive here costs more than ten missed defects.

### Gate C — public beta (arXiv-only, free)

- [ ] URL swap live
- [ ] Auth (Clerk), per-user libraries
- [ ] Shareable read-only dossier URLs
- [ ] Usage metering against real API cost; abuse limits
- [ ] Rate limiting, ingest queue with backpressure
- [ ] Caching so a popular paper is ingested once, not once per visitor
- [ ] Public limitations page (see below) — stated up front, not buried
- [ ] Legal: arXiv ToS review, robots/rate etiquette, what we store and for how long
- [ ] Privacy: uploaded PDFs may be unpublished work — retention policy, deletion path
- [ ] Status page / health endpoint, error tracking, basic analytics
- **Exit criterion:** 100 papers ingested by strangers with no manual intervention.

### Gate D — 1.0

- [ ] Citation faithfulness for *prose* claims (the table-baseline case is done)
- [x] Cross-paper baseline provenance
- [ ] Chat over the paper graph with the grounding contract enforced
- [ ] Browser extension, MCP server
- [ ] Author-side pre-submission flow

---

## Task list by area

### Substrate — mostly done

- [x] Skeleton normalization (ligatures, accents, dashes, hyphenation)
- [x] MuPDF word geometry, band and furniture detection
- [x] Anchor resolution with self-reported precision, verified by round-trip
- [x] Fabrication rejection (fuzzy opt-in with substitution guard)
- [x] arXiv e-print fetch / unpack / main-file resolution / `\input` expansion
- [x] LaTeX equations, tables, citations, sentence runs
- [x] Typed tables: emphasis, bands, spanning headers, leaf metric headers
- [ ] Figures: caption + page crop extraction
- [ ] Section segmentation and typing (abstract / method / results / limitations)
- [ ] Reference list parsing → DOI / S2 id resolution
- [ ] Persistence layer + migrations
- [ ] Deterministic ingest cache (same paper → same graph)

### Checks

- [x] `table.emphasis_not_best` — orientation-inferred, band-aware, premise-validated
- [x] `table.aggregate_mismatch` — whole-label matched, premise-validated
- [ ] `abstract_table_mismatch` — **next; fully deterministic, no credentials needed**
- [ ] `arithmetic_rederivation` — deltas, "X% improvement", relative vs absolute
- [x] `cross_paper_baseline` — does B's reported baseline match A's own number
- [ ] `variance_vs_delta` — is the claimed gain inside the reported noise
- [ ] `sample_accounting` — do n's add up across splits and ablations
- [ ] `stat_consistency` (statcheck) — lower priority for ML, keep for cross-discipline
- [ ] `granularity` (GRIM) — **deprioritised**: needs means of integer items, rare in ML
- [ ] Orientation as an *extraction* output rather than a heuristic (see Risks)

### Analysis layer — the actual product

- [ ] Claim extraction, typed and anchored
- [ ] Claim → evidence / assumption / citation edges
- [ ] Load-bearing DAG and the keystone claim
- [ ] Verification coverage map
- [ ] Assumption tree, falsification mode, steelman/strawman

### Product

- [ ] Next.js app, PDF viewer, highlight overlay
- [ ] Dossier panel, finding → highlight interaction
- [ ] Two-way anchoring (select region → conversation focus)
- [ ] Chat agent over the graph, with the verifier pass and grounding score
- [ ] Auth, libraries, sharing, metering

---

## Do not ship without

1. **Zero confirmed false findings in the alpha window.** The entire premise is that a
   finding can be checked rather than trusted. One confident wrong finding on a correct
   paper costs more than every defect we miss.
2. **Every finding shows its arithmetic.** If a finding cannot display the numbers that
   produced it, it does not ship.
3. **Anchor-or-reject stays enforced in code.** Not a prompt instruction.
4. **The coverage map is visible.** We say what we did not check. Always.
5. **A cost ceiling per ingest.** No path where one paper can run up an unbounded bill.
6. **Uploaded PDFs are treated as unpublished work.** Retention and deletion stated
   before a single upload is accepted.

---

## Limitations to state publicly, up front

Stating these is part of the product, not a disclaimer to hide.

- Deterministic checks currently catch roughly **1 in 9** planted defects of the kinds
  they target. They are precise, not exhaustive. Silence is not a clean bill of health.
- **arXiv only**, and ~1 paper in 10 has no usable LaTeX source (PDF-wrapper
  submissions); those fall back to a reduced PDF-only path.
- Display maths, stacked fractions and rotated figure labels anchor approximately, and
  say so — they are marked `approximate` rather than silently imprecise.
- We check what a paper says against itself and against its sources. We do not judge
  whether the idea is good.

---

## Open risks and decisions

| Risk | Detail | Mitigation |
|---|---|---|
| **Low recall undermines the pitch** | 11% on planted defects; nothing found on 9 good papers | Reframe headline to keystone claim + coverage. Decided 2026-09-15. |
| **Orientation ambiguity caps check recall** | Whether a table compares down columns or across rows is not recoverable from source | Make orientation an extraction output — the model sets the frame, code still returns the verdict |
| **alphaXiv adds verification** | Well funded, has distribution | Our moat is the substrate (LaTeX ground truth, claim DAG, anchor-or-reject), not the checks. Checks are copyable; the substrate took a fortnight of measurement |
| **arXiv rate limits / ToS** | Bulk e-print fetching at public scale | Cache aggressively, identify the client, review ToS before Gate C |
| **Author-side may be the real market** | Readers are free users; authors have deadlines and budget | Test in the alpha: recruit 5 testers who are actively writing |
| **Cost per paper** | ~$1–2 estimated, unmeasured | Measure at Gate A; hard ceiling before Gate B |
| **Nothing is committed** | 53 passing tests exist only in the working tree | Commit before any further work |

---

## The reader

Built and runnable: `npm --prefix apps/web run dev`. Dossiers are produced offline by
`keystone dossier <ids>` and written to `public/dossiers`, so the app is **fully
static** — it builds to prerendered HTML with no backend and no API key, and can go up
on Vercel, Netlify, Cloudflare Pages or GitHub Pages as-is.

Design notes, since "looks machine-generated" is a product risk in this category:

- **No** violet gradients, glassmorphism, neon-on-charcoal or floating orbs. Those read
  as generated because everything generated uses them.
- Warm paper, real ink, one brass accent reserved exclusively for the keystone. Fractal
  grain at 3.5% opacity, because a perfectly even field reads as synthetic.
- A transitional serif for argument, a tabular mono for evidence — the reader can tell
  by voice which they are looking at.
- The 3D is the analysis, not decoration. Each voussoir is a headline claim; brass ones
  rest on the keystone table; hollow ones are claims with no evidence, so the arch is
  visibly full of holes exactly where coverage is missing. The build animation lays
  stones from the springing points inward and sets the keystone last, which is the
  order an arch is actually built in. "Pull the keystone" drops every stone that
  depended on it and leaves the hollow ones standing, because they never rested on it.

Both animation paths are driven by the render clock rather than by summed frame deltas:
a throttled tab delivers far fewer frames than seconds, and a delta-summed animation
then takes minutes of wall time to arrive.

### The reader layout, rebuilt

The first version put the analysis in eight tabs inside a 30 rem column. Measured at
1440x900 that was not a rough edge, it was a broken interface:

| | |
|---|---|
| Tab bar | clipped mid-word (`REFE...`) with a horizontal scrollbar |
| Claim rows | **every one** ended in an ellipsis; not a single claim was readable |
| Type scale | ~0.75 rem across the whole panel, no hierarchy, one weight |
| Panes | PDF showed a narrow text column inside wide gutters; analysis crushed to 30 rem |

What replaced it, and why:

- **Collapsible sections, not tabs.** Eight tabs is eight things that do not fit. What
  the parser produces is one report about one paper, and a report is something you
  scroll with the parts you do not need folded away. `components/Section.tsx`.
- **Ask is a mode, not a tab.** Asking a question is a different posture from reading
  the audit, so it takes the whole column and says so.
- **37 rem analysis column, two-line claim rows.** A claim you cannot read is not a
  claim; the sentence now gets two lines before it clips.
- **PDF zoom.** Papers are typeset with wide margins, so fitting a page to the pane left
  the text column small. Four steps to 210%.
- **The evidence map was drawn at 70% and floated.** Its coordinate space was 560 wide
  against a 555 px column, but a `max-height` cap won the aspect fit, so the whole chart
  shrank and sat in the middle of the pane with air down both sides.
- **`suppressHydrationWarning` on `<html>`.** The pre-paint theme script adds `dark`
  before React hydrates, so server and client necessarily disagree on that class list.
  That is the intended behaviour; it was logging a hydration error on every page.
- **Library rows for papers with no headline numbers** said only "no numeric claims up
  front" next to an em dash, which read as a paper we had failed on. They now carry
  their real density — ViT is 84 items, VGG 49 — from a new `density` field on the
  index.

### Before it goes on a public URL

- [ ] Mobile layout — the arch needs a smaller camera framing below ~640 px
- [ ] `prefers-reduced-motion`: skip the build animation, render the arch assembled
- [ ] Accessible description of the arch for screen readers (the ledger already carries
      the same facts as text, so this is a summary and an `aria-hidden` on the canvas)
- [ ] WebGL fallback: if the context fails, the ledger alone must still be a complete
      account
- [ ] Decide the deploy target and put the static build behind it

## Immediate next three

1. `ANTHROPIC_API_KEY` as a Vercel project environment variable. Asking a paper a
   question is built, streams, and caches the paper's prose for an hour — and currently
   returns a 503 that says exactly what is missing. This is a one-command unblock:
   `vercel env add ANTHROPIC_API_KEY production`, then redeploy.
2. Ingest an arbitrary arXiv id from the UI, so the library is not a fixed set.
   Vercel Python function; hobby-tier duration is the risk, so measure before
   committing to it, and cache so a paper is ingested once rather than once per
   visitor. `keystone expand` already does the hard part offline.
