# Working on Keystone

Read this first. It is the operating manual — what the project is, how to run it, and
the specific things that have cost hours here. The architecture is in `README.md`; the
decision history is in `RELEASE.md`.

## What it is

Keystone reads an arXiv paper's **LaTeX source** and reports, verbatim, two things:
what each citation *adopts / extends / disputes / measures against* (decided by cue
phrases, not a model), and what the paper *assumes*, filed by whether the same sentence
offers a citation, its own evidence, or nothing. Every reading is anchored to pixel
rectangles on the PDF, and where a sentence cannot be located nothing is drawn.

The governing principle is **precision over coverage**: it is silent where a sentence
says nothing checkable, and silence is reported as silence rather than dressed up. Any
change that trades that away is the wrong change, however much it improves a number.

- Live: <https://keystone-research.vercel.app> (old name `keystone-seven-beta` 307s to it)
- Repo: <https://github.com/Srikarmk/Keystone> — public, so never commit a secret

## Where things are

```
services/core/          Python engine (parser, anchors, cue rules). 274 tests.
  keystone/ingest/      arXiv source, PDF, anchors, metadata
  keystone/lineage/     stance + assumption cue rules
  keystone/audit/       numeric tracing and the deterministic checks
apps/web/               Next 15 App Router site. 49 JS tests.
  app/api/ingest.py     Python serverless function: analyse any arXiv paper on demand
  public/dossiers/      the built library — 234 papers, committed
eval/corpus/            e-print + PDF cache, metadata.json. Gitignored, not in the repo.
```

## Commands

```bash
# Python engine
cd services/core && uv run pytest -q              # 274 tests (needs `brew install uv`)
cd services/core && uv run keystone --help        # the CLI

# Site
cd apps/web && npm test                           # 49 tests (node --test)
cd apps/web && npx tsc --noEmit -p .              # typecheck
cd apps/web && npm run build

# Deploy — see the trap below, this is NOT automatic
cd apps/web && npx vercel --prod --yes
```

On a fresh clone 26 of the 274 skip: they read PDFs from `eval/corpus/pdf/`, which is
gitignored. "248 passed, 26 skipped" is a clean run without the corpus, not a failure. Fetch the
corpus with `eval/fetch_library.sh` (about 45 minutes; arXiv refused nothing at ~4s).

## Traps that have actually cost time here

These are the expensive ones. Each was found the hard way.

**Deploys are manual.** A push to `main` deploys nothing — the Vercel project has no git
integration. Always `cd apps/web && npx vercel --prod --yes` yourself. A quiet minute
after a push means no deploy was triggered, not a slow build.

**`next build` poisons `next dev`.** They share `.next`. After a build, client components
silently stop mounting and the error names a missing chunk. `rm -rf .next` before
starting the dev server, every time.

**Next's data cache outlives deployments.** A route that fetches a built file with
`revalidate` or `force-cache` keeps serving the *previous build's* copy. This made the
MCP route report 40 disputes when there were 52, through a redeploy and through a fix
that was not the cause. Use `lib/built.ts`, which keys the URL with the deployment id
(not the commit SHA: a CLI deploy of an uncommitted rebuild has the previous one's SHA).

**A dynamic route cannot read `public/`.** `readFileSync` works at build and fails in a
serverless function. Import the JSON so the bundler sees it (`lib/card.ts`), or fetch it.

**A page about the signed-in user must be `force-dynamic`.** `/profile` was prerendered
static because `currentUser()` returns null without touching cookies when no provider is
configured, so nothing read the request. One reader's page, served to everybody.

**Sensitive env vars pull as `""`.** `vercel env pull` returns empty for
`AUTH_GOOGLE_*`, `ANTHROPIC_API_KEY` and `KEYSTONE_OWNER`. To test a signed-in feature,
put placeholder provider creds in `apps/web/.env.development.local` (gitignored) and mint
a session cookie with the real `AUTH_SECRET`:

```js
import { encode } from "./node_modules/@auth/core/jwt.js";
// salt MUST equal the cookie name: "authjs.session-token" over http,
// "__Secure-authjs.session-token" over https (works against production too).
await encode({ salt, secret, maxAge: 3600, token: { sub: "test-reader", email: "test@localhost" } });
```
Never type a real password into a browser to test. Clean up afterwards —
`DELETE /api/marks?scope=all`, then `SCAN 0` the store for stray keys.

**arXiv answers 406 when it is throttling.** One IP budget shared across `/e-print/` and
`export.arxiv.org/api/query`. A one-id request returned 200 and then 406 nine minutes
later with nothing changed; User-Agent, batch size, scheme and headers were each tested
and ruled out. Do not tune `POLITE_DELAY`. Fetch out of process with `curl` at ~4s
intervals into `eval/corpus/cache/eprints/` and `eval/corpus/pdf/`, then run
`keystone dossier` which reads from cache. `load_project` uses `cache_dir/eprints/`, not
the cache root. If the metadata API refuses, `metadata.from_abs()` reads the same three
facts off the paper's abstract page — 26 of 26 where the API managed 1 of 27.

**zsh does not word-split unquoted `$VAR`.** `keystone dossier $IDS` passes every id as
one argument, fails, and **exits 0**. Pipe through `xargs`, and verify by counting what
was written rather than trusting the exit code.

**Quoted heredocs still convert `\uXXXX`.** Writing files via heredoc mangles unicode
escapes and breaks later exact-match patches. Use a Python heredoc for such files.

**pdf.js `TextLayer` must be cancelled.** Two renders into one container both clear it
and both keep appending, so every span appears twice — invisibly, until a selection
quotes the sentence back doubled. Keep the layer and `.cancel()` the superseded one.

**A popover must clamp to the scroll viewport, not the page.** A page is 800pt tall in a
500px pane, so "4pt from the top of page 3" is off screen. Re-place on scroll too: a
smooth `scrollTo` means the first placement was computed against a moving target.

**The browser pane's `key: "Return"` does not reach text inputs.** It looks exactly like
a broken `onKeyDown`. Dispatch a `KeyboardEvent` directly before believing the code is
wrong.

**Vercel's Python builder needs a `pyproject.toml`, not `requirements.txt`.** It rewrites
requirements into a uv project and loses the `#subdirectory=` fragment a git dependency
needs. `apps/web/pyproject.toml` states the source in uv's own syntax.

**Never type a count into copy.** The MCP route said "899 readings from 74 papers" to
every empty search long after the library reached 101. Count it off the JSON.

**An equation body has no environment.** The parser stores what is inside `align` or
`eqnarray` and the environment beside it, so the body alone has bare `&`s that KaTeX
rejects. `lib/equation.ts` puts the environment back; without it 164 of 524 equations
rendered as error-coloured source. 38 of 1249 still do, each for a paper-specific reason (an uncaptured
macro, `\resizebox`).

**Growing the corpus is a test of the checks.** Going 74 → 101 papers produced five false
`headline_table_mismatch` findings, all of which had matched a *column* with no row
identified. A finding that cannot name the cell it accuses must not be published. The
same thing happened at 9 → 35 papers with a different check, and again at 101 → 125:
Zeiler & Fergus print a table as two side-by-side halves with one Mean row for both,
which `table.aggregate_mismatch` read as wrong. Folded tables are now skipped. At
125 → 160, `headline_table_mismatch` read 0.90 under an "E %" heading as 90% to accuse
an abstract's 89.94%, and set "greater than 99%" against a cell; a mismatch now believes
the header's unit and never accuses a bound. The same growth found a *real* one —
Gillick et al.'s AVERAGE row — which is listed in `VERIFIED` in `tests/test_planted.py`
with the arithmetic. Add to that list only with proof; it is what keeps the gate a gate.
At 160 → 197, 1410.8206 keeps its headline 37.5 in a macro (`\bestbleuunk`) used in
prose and table alike; the table cell was never expanded, so the abstract was set against
another system's 37.2. Number-valued macros now expand in table cells (formatting macros
still do not), and a number written verbatim in any cell is never accused of mismatching.
At 197 → 234, Universal Transformers' second header row ("0 1 2 3 4 5 Total") was read as
data and labelled "Total" from its *last* cell; a total row must now say so in its first.
**Never run pytest while a build is running** — both unpack into `cache/unpacked/` and
the race fails tests that are not broken.

**Rebuild the whole library when you grow it, not only the new papers.** A citation
becomes a walkable edge only when the *citing* paper is built with the cited one already
in the library. Adding 27 papers at 74 → 101 without rebuilding the rest left 34 edges
unwalked. Rebuild on top of the committed `public/dossiers/` — an empty `--out` loses
the bibliographies that confirm titles and drops edges instead. Expect some headlines to
move: `foundation` breaks ties toward a work that is in the library, so at 101 → 125
nine papers' "Stands on" changed with no reading changed. That is the rule working.

**Build twice after growing, and diff the two.** Titles are confirmed by what the
library's bibliographies print, read from the dossiers on disk *before* the run, so the
first build after adding papers has not seen the new papers' bibliographies. At
125 → 160 the second pass changed three titles and added an edge; the third changed
nothing. Stop when two consecutive builds are byte-identical (`diff -rq`).

**Thirteen candidates so far are refused, correctly — skip them.** 1604.01696,
1801.03622 and 1803.05573 ship only an `\includepdf`. FractalNet (1605.07648),
ConvS2S (1705.03122) and 1707.06990 yield no prose from their source; 1406.7806 is
excluded by hand, because a library bibliography attaches that id to the dropout paper's
title, so ingesting it would draw a false edge. **Six more:** PALMS (2106.10328)
has no source at all. The other five: Adam, PPO and
1704.06611 ship only an `\includepdf`; 1806.03822 has no prose in its source;
1909.08593's LaTeX is a stale template that does not match its PDF. `expand` will
keep ranking them first — skip them rather than work around the guards.

## Conventions

- **Commit as the user**, with simple messages, and **no `Co-Authored-By` or any Claude
  attribution** — this is their repo and their work history.
  ```bash
  GIT_AUTHOR_NAME="Srikarmk" GIT_AUTHOR_EMAIL="srikarmks@gmail.com" \
  GIT_COMMITTER_NAME="Srikarmk" GIT_COMMITTER_EMAIL="srikarmks@gmail.com" git commit ...
  ```
- Commit to `main` and push; no PRs.
- Comments explain *why*, especially where a design looks odd — most of this codebase's
  comments record a decision or a bug that justified it. Match that.
- Numbers shown on the site are read from generated JSON, never typed in, so the site
  cannot drift from the run that produced them. Keep it that way.

## Environment

Seven variables, all set in Vercel production. Nothing works locally without
`vercel env pull .env.local --environment=production` first (and see the sensitive-vars
trap above).

| | |
|---|---|
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in |
| `UPSTASH_REDIS_REST_URL`, `..._TOKEN` | marks, reading lists, ingest cache, analytics |
| `ANTHROPIC_API_KEY` | Ask, and the library guide |
| `KEYSTONE_OWNER` | email(s) allowed to read `/stats`; unset = nobody |

## State, as of 2026-10-22

234 papers · 548 walkable edges · 1524 citation readings (90.7% anchored) · 973
assumptions · 2497 searchable rows · 1211 of 1249 equations typeset. 274 Python tests,
49 JS tests, all green. Three findings, all verified real: EfficientNet ×2, Gillick ×1.

Shipped and verified on production: the reader with pixel anchors, full-screen page,
highlights and notes (sign-in required, stored in the PDF's coordinate space so they can
be matched to Keystone's own readings by rectangle overlap), Google sign-in with
cross-device sync, search, a library guide, `/timeline`, `/contested`, `/assumptions`,
`/method`, `/news`, on-demand analysis of **any** arXiv paper (~1.5–16s), an MCP server
at `/api/mcp`, and cookieless analytics at `/stats`.

## What is left

Nothing is broken or half-finished. These are the open directions, roughly by value:

1. **Grow the library further.** 234 papers; the ranking in `keystone expand --dry-run`
   has plenty of good candidates left. Fetch with the curl workaround above. Watch for
   new findings each time — see the corpus trap.
2. **Hand-label more stance rows.** In progress: 60 more rows were drawn on 2026-10-16
   (`gold: null` in `eval/labels/stance.jsonl`, all `heldout`) and are being labelled
   blind on a claude.ai page, <https://claude.ai/artifact/796x9V3VLo3LRf5XAtZ3cK>, whose
   database holds the labels (`labels/<row>`, rows `r01`–`r60` in file order of the
   unlabelled rows). Copy them into the file, then `stance-refresh` and `stance-eval`.
3. **Compare two papers** — shipped as `/compare?a=…&b=…` (`lib/compare.ts`): what each
   says about the other, what both stand on, where they part ways, what both argue
   with, and what else both cite. References match on arXiv id or folded title, the
   engine's own rule. Shared *assumptions* are deliberately not compared — that would
   need a similarity judgement, which nothing on the site makes. Library papers only.
4. **Return visits in analytics.** Deliberately impossible now: the visitor hash
   re-salts daily. Changing it would need a cookie, a banner, and different promises in
   the footer. Do not do it quietly.
5. **The model layer** (the old plan's Phase D): claims beyond numbers, typed and
   anchor-or-reject enforced. This is the one that could break the precision discipline,
   so it needs the same anchor-or-say-nothing gate as everything else.

Two things that look like bugs and are not: `/stats` holds ~7 events from testing on
2026-09-25, and three findings are shown in the library — all real: EfficientNet's
introduction says 76.3% for ResNet-50 where its Table 3 says 76.0% (and 83.0 vs 82.9),
and Gillick et al.'s Table 1 averages 95.85 where its rows give 95.83.
