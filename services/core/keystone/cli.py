"""Keystone developer CLI."""

from __future__ import annotations

import json
import random
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import replace
from pathlib import Path

import pymupdf
import typer

from keystone.ingest import Document, DocIndex, roundtrip
from keystone.ingest.arxiv_source import (
    SourceUnavailable,
    fetch,
    load,
    load_project,
    unpack,
)
from keystone.ingest.latex import (
    anchorable_runs,
    anchorable_sentences,
    document_title,
    expand_inputs,
)
from keystone.ingest.assemble import paper_from_arxiv
from keystone.ingest.metadata import resolve as resolve_metadata
from keystone.ingest.sampling import sample_spans, spans_with_line_hyphens
import keystone.audit.checks.tables  # noqa: F401  (registers the checks)
from keystone.audit.registry import run
from keystone.eval.planted import paper_with, plant_emphasis_error
from keystone.dossier import build as build_dossier

app = typer.Typer(add_completion=False, help="Keystone ingest and anchor tooling.")

# Anchors that claim to be tight are the ones prose claims may cite, so that is what
# the Phase 0 gate measures. Stacked-geometry spans are reported but not gated.
GATE_TIGHT_RATE = 99.0


@app.command()
def probe(pdf: Path, quote: str, page_hint: int | None = None) -> None:
    """Locate a quote in a PDF and print the resolved anchor."""
    doc = Document.open(pdf)
    index = DocIndex(doc)
    result = index.locate(quote, page_hint=page_hint)
    if result.anchor is None:
        typer.secho(f"REJECTED ({result.reason})", fg=typer.colors.RED)
        raise typer.Exit(1)

    passed, why, extracted = roundtrip(doc, result.anchor)
    payload = result.anchor.to_dict() | {"roundtrip": {"passed": passed, "reason": why}}
    typer.echo(json.dumps(payload, indent=2))
    typer.secho(
        f"{'PASS' if passed else 'FAIL'} — {why}",
        fg=typer.colors.GREEN if passed else typer.colors.RED,
    )
    if not passed:
        typer.echo(f"extracted: {extracted!r}")
        raise typer.Exit(1)


@app.command()
def audit(
    pdfs: list[Path],
    samples: int = typer.Option(40, help="Random spans per document."),
    hyphen_samples: int = typer.Option(10, help="Hyphenated-line-break spans per document."),
    seed: int = 0,
    verbose: bool = typer.Option(False, help="Print every failure."),
) -> None:
    """Audit anchor resolution across a corpus: locate, then round-trip through geometry."""
    totals = Counter()
    methods = Counter()
    failures: list[str] = []

    for pdf in pdfs:
        doc = Document.open(pdf)
        index = DocIndex(doc)
        spans = sample_spans(doc, samples, seed=seed) + spans_with_line_hyphens(
            doc, hyphen_samples, seed=seed
        )

        per_doc = Counter()
        for span in spans:
            totals["spans"] += 1
            per_doc["spans"] += 1
            result = index.locate(span.quote)

            if result.anchor is None:
                totals["rejected"] += 1
                per_doc["rejected"] += 1
                failures.append(f"{pdf.name}: REJECT ({result.reason}) {span.quote[:70]!r}")
                continue

            methods[result.anchor.method] += 1
            bucket = result.anchor.precision
            totals[f"{bucket}_spans"] += 1
            if bucket == "tight":
                per_doc["tight_spans"] += 1
            # A located anchor must also land on the words it came from. Geometry that
            # covers the right text at the wrong place would pass round-trip alone.
            if result.anchor.word_start != span.word_start and not result.anchor.is_ambiguous:
                totals["misplaced"] += 1
                per_doc["misplaced"] += 1
                failures.append(
                    f"{pdf.name}: MISPLACED want w{span.word_start} got "
                    f"w{result.anchor.word_start} {span.quote[:60]!r}"
                )
                continue

            passed, why, _ = roundtrip(doc, result.anchor)
            if passed:
                totals["passed"] += 1
                totals[f"{bucket}_passed"] += 1
                per_doc["passed"] += 1
                if bucket == "tight":
                    per_doc["tight_passed"] += 1
            else:
                totals[f"{bucket}_failed"] += 1
                totals["roundtrip_failed"] += 1
                per_doc["roundtrip_failed"] += 1
                failures.append(f"{pdf.name}: ROUNDTRIP [{bucket}] {why} {span.quote[:60]!r}")

        tight_rate = 100.0 * per_doc["tight_passed"] / max(1, per_doc["tight_spans"])
        typer.echo(
            f"{pdf.name:>20}  tight {per_doc['tight_passed']:>3}/{per_doc['tight_spans']:<3}"
            f" {tight_rate:6.2f}%   all {per_doc['passed']:>3}/{per_doc['spans']:<3}"
        )

    typer.echo("")
    tight_rate = 100.0 * totals["tight_passed"] / max(1, totals["tight_spans"])
    approx_rate = 100.0 * totals["approximate_passed"] / max(1, totals["approximate_spans"])
    overall = 100.0 * totals["passed"] / max(1, totals["spans"])

    # The gate is the tight bucket: those are the anchors prose claims may cite.
    typer.secho(
        f"TIGHT  {totals['tight_passed']}/{totals['tight_spans']} = {tight_rate:.2f}%"
        f"   (gate: >= {GATE_TIGHT_RATE:.0f}%)",
        fg=typer.colors.GREEN if tight_rate >= GATE_TIGHT_RATE else typer.colors.RED,
        bold=True,
    )
    typer.echo(
        f"APPROX {totals['approximate_passed']}/{totals['approximate_spans']} "
        f"= {approx_rate:.2f}%   (stacked geometry: maths, fractions, figures)"
    )
    typer.echo(f"ALL    {totals['passed']}/{totals['spans']} = {overall:.2f}%")
    typer.echo(f"  by method: {dict(methods)}")
    typer.echo(
        f"  rejected={totals['rejected']} misplaced={totals['misplaced']} "
        f"roundtrip_failed={totals['roundtrip_failed']}"
    )
    if failures and verbose:
        typer.echo("\n".join(f"  {f}" for f in failures[:40]))


@app.command("source-audit")
def source_audit(
    pdfs: list[Path],
    cache: Path = typer.Option(Path("../../eval/corpus/cache"), help="e-print cache."),
    sentences: bool = typer.Option(
        True, help="Anchor sentence by sentence rather than whole paragraph runs."
    ),
    verbose: bool = typer.Option(False, help="Show runs that failed to anchor."),
) -> None:
    """Measure how much arXiv LaTeX source can be anchored back into the PDF.

    Source gives exact equations, table numbers and citation keys; anchoring gives
    them pixel coordinates. This reports the join rate between the two.
    """
    totals = Counter()
    typer.echo(
        f"{'paper':>14} {'runs':>5} {'anchored':>9} {'rate':>7}"
        f"  {'eqs':>4} {'tabs':>5} {'cites':>6}"
    )

    for pdf in pdfs:
        ident = pdf.stem
        try:
            archive = fetch(ident, cache / "eprints")
            project = unpack(archive, cache / "unpacked" / ident)
            document = load(ident, cache)
            full = expand_inputs(
                project.main.read_text(encoding="utf-8", errors="replace"), project.read
            )
        except (SourceUnavailable, ValueError) as exc:
            typer.secho(f"{ident:>14}   no source: {exc}", fg=typer.colors.YELLOW)
            totals["no_source"] += 1
            continue

        runs = anchorable_sentences(full) if sentences else anchorable_runs(full)
        doc = Document.open(pdf)
        index = DocIndex(doc)

        anchored = 0
        for run in runs:
            if index.locate(run).anchor is not None:
                anchored += 1
            elif verbose:
                typer.echo(f"    MISS {run[:100]!r}")

        totals["runs"] += len(runs)
        totals["anchored"] += anchored
        typer.echo(
            f"{ident:>14} {len(runs):>5} {anchored:>9} "
            f"{100.0 * anchored / max(1, len(runs)):>6.1f}%"
            f"  {len(document.equations):>4} {len(document.tables):>5}"
            f" {len(document.citations):>6}"
        )

    rate = 100.0 * totals["anchored"] / max(1, totals["runs"])
    typer.echo("")
    typer.secho(
        f"ANCHORED {totals['anchored']}/{totals['runs']} = {rate:.1f}%"
        f"   (papers without source: {totals['no_source']})",
        fg=typer.colors.GREEN if rate >= 85 else typer.colors.YELLOW,
        bold=True,
    )


@app.command("check")
def check_papers(
    arxiv_ids: list[str],
    cache: Path = typer.Option(Path("../../eval/corpus/cache"), help="e-print cache."),
) -> None:
    """Run the deterministic check suite over papers, by arXiv id."""
    for arxiv_id in arxiv_ids:
        try:
            paper = paper_from_arxiv(arxiv_id, cache)
        except SourceUnavailable as exc:
            typer.secho(f"{arxiv_id}: no source ({exc})", fg=typer.colors.YELLOW)
            continue

        findings = run(paper)
        cells = sum(len(t.numeric_cells) for t in paper.tables)
        typer.echo(
            f"{arxiv_id}: {len(paper.tables)} tables, {cells} numeric cells, "
            f"{len(findings)} finding(s)"
        )
        for finding in findings:
            typer.secho(f"  [{finding.severity}] {finding.title}", bold=True)
            typer.echo(f"      {finding.explanation}")


@app.command("planted-audit")
def planted_audit(
    arxiv_ids: list[str],
    cache: Path = typer.Option(Path("../../eval/corpus/cache"), help="e-print cache."),
    seed: int = 0,
    verbose: bool = typer.Option(False, help="List each miss."),
) -> None:
    """Measure the check suite against deliberately planted defects.

    A suite that reports nothing across a corpus is indistinguishable from a suite
    that *can* report nothing, which is the failure most likely to ship unnoticed.
    Planting known defects into real tables separates the two, and measures both
    halves of the trade: recall on the plants, and false positives on the originals.
    """
    rng = random.Random(seed)
    planted = caught = false_positives = 0
    misses: list[str] = []

    for arxiv_id in arxiv_ids:
        try:
            paper = paper_from_arxiv(arxiv_id, cache)
        except SourceUnavailable:
            continue

        clean = run(paper)
        false_positives += len(clean)
        for finding in clean:
            typer.secho(f"  FALSE POSITIVE {arxiv_id}: {finding.title}", fg=typer.colors.RED)

        for table in paper.tables:
            result = plant_emphasis_error(table, rng)
            if result is None:
                continue
            mutated, defect = result
            planted += 1
            if defect.was_found(run(paper_with(paper, mutated))):
                caught += 1
            else:
                misses.append(f"{arxiv_id} {table.name}: {defect.description}")

    typer.echo("")
    typer.secho(
        f"recall {caught}/{planted} = {100.0 * caught / max(1, planted):.0f}%",
        fg=typer.colors.GREEN if caught else typer.colors.YELLOW,
        bold=True,
    )
    typer.secho(
        f"false positives on unmodified papers: {false_positives}",
        fg=typer.colors.GREEN if not false_positives else typer.colors.RED,
        bold=True,
    )
    if verbose:
        for miss in misses:
            typer.echo(f"  MISS {miss}")


@app.command()
def dossier(
    arxiv_ids: list[str],
    out: Path = typer.Option(Path("../../apps/web/public/dossiers"), help="Output directory."),
    cache: Path = typer.Option(Path("../../eval/corpus/cache"), help="e-print cache."),
    pdfs: Path = typer.Option(Path("../../eval/corpus/pdf"), help="Local PDFs, for anchoring."),
    titles: str = typer.Option("", help="Optional id=Title pairs, comma separated."),
    check_baselines: bool = typer.Option(
        False,
        "--cross-paper",
        help="Check reported baselines against the papers they cite (downloads them).",
    ),
) -> None:
    """Build dossiers and write them as JSON for the reader."""
    lookup = dict(
        pair.split("=", 1) for pair in titles.split(",") if "=" in pair
    )
    out.mkdir(parents=True, exist_ok=True)
    index = []

    # Resolving a cited work to an ingested paper is done on titles, so every paper's
    # full title has to be known before any single dossier is built. Read from each
    # paper's own LaTeX rather than typed in: the display names in the library are
    # deliberately short and would never match a bibliography entry.
    existing = [
        json.loads(path.read_text())
        for path in sorted(out.glob("*.json"))
        if _DOSSIER_FILE.match(path.name)
    ]
    corpus_titles, display_titles = _corpus_titles(arxiv_ids, cache, out, existing)
    failures: list[tuple[str, str]] = []

    # One metadata request for the whole run, cached across runs. Categories come
    # from arXiv rather than from reading the titles, so a group the library shows is
    # a fact about the submission and not an opinion about the paper.
    catalogue = resolve_metadata(list(arxiv_ids), cache.parent / "metadata.json")

    for arxiv_id in arxiv_ids:
        try:
            built = build_dossier(
                arxiv_id,
                cache,
                title=lookup.get(arxiv_id, "") or display_titles.get(arxiv_id, ""),
                pdf_path=pdfs / f"{arxiv_id}.pdf",
                check_baselines=check_baselines,
                corpus_titles=corpus_titles,
            )
        except SourceUnavailable as exc:
            typer.secho(f"{arxiv_id}: no source ({exc})", fg=typer.colors.YELLOW)
            continue
        except Exception as exc:  # noqa: BLE001
            # Deliberately broad, and only at this level. Papers now arrive from the
            # wild rather than from a hand-picked list, so a malformed tarball, an
            # unusual class file or a PDF MuPDF will not open is a normal event. One
            # of them must cost that paper, not the other forty and the twenty minutes
            # of anchoring already done.
            typer.secho(f"{arxiv_id}: failed ({exc!r})", fg=typer.colors.RED)
            failures.append((arxiv_id, repr(exc)))
            continue

        payload = built.to_dict()
        # arXiv's own primary category, not one inferred from the title. A library
        # that groups papers has to say where the grouping came from, and "the authors
        # filed it under cs.CL" is checkable on the abstract page.
        record = catalogue.get(arxiv_id)
        payload["arxiv"] = record.to_dict() if record else None
        (out / f"{arxiv_id}.json").write_text(json.dumps(payload, indent=2))

        # The paper's prose, written separately. Answering questions needs the text,
        # but the reader does not — shipping it inside the dossier would double what
        # every visitor downloads to serve a feature most of them will not open.
        (out / f"{arxiv_id}.context.json").write_text(
            json.dumps(
                {
                    "id": arxiv_id,
                    "title": payload["title"],
                    "sections": [
                        {"kind": str(section.kind), "title": section.title, "text": section.text}
                        for section in built.paper.sections
                        if section.text.strip()
                    ],
                },
                indent=2,
            )
        )
        index.append({
            "id": arxiv_id,
            "title": payload["title"] or arxiv_id,
            # The paper's own title, kept so a later run that rebuilds only one paper
            # can still resolve citations against the rest of the library.
            "fullTitle": display_titles.get(arxiv_id, payload["title"]),
            "lineage": payload["lineage"]["tally"],
            "assumptions": payload["assumptionTally"],
            "coverage": payload["coverage"],
            "keystone": payload["keystone"],
            "findings": len(payload["findings"]),
            "arxiv": payload["arxiv"],
            # The single most load-bearing dependency, by title. Carried in the index
            # so the paper's social card can name it: that card renders in a
            # serverless function where the dossier files are not on disk, and an
            # index the bundler can see is the only data it can be sure of.
            "foundation": (payload["lineage"].get("foundation") or {}).get("title", ""),
            # Four of nine papers state no numbers up front, and a library row that
            # says only "no numeric claims" reads as a paper we failed on rather than
            # a paper that argues in prose. These counts are what is actually in hand.
            "density": {
                "numbers": len(payload["numbers"]),
                "tables": len(payload["tables"]),
                "equations": len(payload["equations"]),
                "references": len(payload["references"]),
            },
        })
        baselines = payload.get("baselines", [])
        confirmed = sum(1 for b in baselines if b["outcome"] == "confirmed")
        typer.echo(
            f"{arxiv_id}: {payload['coverage']['supported']}/{payload['coverage']['claims']} "
            f"claims supported, {len(payload['findings'])} finding(s)"
            + (
                f", {confirmed}/{len(baselines)} baselines confirmed"
                if baselines
                else ""
            )
        )

    # Merge rather than replace: building one paper must not drop every other paper
    # from the index, which is what made the reader show a single-entry list.
    index_path = out / "index.json"
    existing = json.loads(index_path.read_text()) if index_path.exists() else []
    merged = {entry["id"]: entry for entry in existing}
    merged.update({entry["id"]: entry for entry in index})
    index_path.write_text(json.dumps(list(merged.values()), indent=2))
    edges = _write_lineage_index(out)

    typer.secho(
        f"wrote {len(index)} dossier(s); index now lists {len(merged)}; "
        f"{edges} edge(s) run between papers in the library",
        fg=typer.colors.GREEN,
    )
    for arxiv_id, reason in failures:
        typer.secho(f"  failed: {arxiv_id} {reason}", fg=typer.colors.RED)

    # Exit non-zero when nothing was written. A build that failed every paper and
    # returned 0 is how two full rebuilds were reported as finished while the site kept
    # serving the previous run's dossiers: the shell had passed all forty-six ids as a
    # single argument, every one failed, and the exit code said the work was done.
    if failures and not index:
        raise typer.Exit(1)


def survey(
    payloads: list[dict], have: set[str]
) -> tuple[Counter[str], Counter[str], dict[str, str]]:
    """What the library's own citations point at, outside the library.

    Returns how many library papers cite each outside work, how many take a *stance*
    on it, and the best title available for it.
    """
    cited: Counter[str] = Counter()
    stanced: Counter[str] = Counter()
    titles: dict[str, str] = {}

    for payload in payloads:
        # Counted once per citing paper, not once per citation: a paper that mentions
        # the same work eight times is one vote for ingesting it, not eight.
        outside = {
            reference["arxivId"]
            for reference in payload.get("references", [])
            if reference.get("arxivId") and reference["arxivId"] not in have
        }
        for ident in outside:
            cited[ident] += 1
        for reference in payload.get("references", []):
            if reference.get("arxivId") in outside:
                titles.setdefault(
                    reference["arxivId"], reference.get("title") or reference["raw"][:80]
                )
        for edge in payload.get("lineage", {}).get("edges", []):
            ident = edge.get("arxivId")
            if ident and ident not in have:
                stanced[ident] += 1
                titles.setdefault(ident, edge.get("title", ""))

    return cited, stanced, titles


def rank_candidates(
    cited: Counter[str],
    stanced: Counter[str],
    *,
    stanced_only: bool = True,
    extra: list[str] | None = None,
) -> list[str]:
    """Which papers to ingest next, best first.

    A paper the library already takes a stance on arrives with an edge attached, so
    those come first; among equals, the one more papers cite. ``extra`` is appended as
    a hand-picked tail — hub papers that densify the graph once ingested but that the
    current library happens not to stance yet.
    """
    pool = [i for i in cited if not stanced_only or stanced[i] > 0]
    pool += [i for i in (extra or []) if i not in cited]
    return sorted(
        dict.fromkeys(pool), key=lambda i: (-stanced[i], -cited[i], i)
    )


def attested_titles(payloads: list[dict]) -> dict[str, Counter[str]]:
    """Titles the library's own bibliographies print for each arXiv identifier.

    Independent confirmation, and it is needed rather than merely nice. A paper's own
    source can carry the *wrong* title: arXiv:1909.08593 is "Fine-Tuning Language
    Models from Human Preferences", but its LaTeX says
    ``\\icmltitle{Language Models are Unsupervised Multitask Learners}`` — a stale
    conference template copied from GPT-2. Resolving citations on that would have made
    every citation of GPT-2 point at the wrong paper, which is precisely the kind of
    confident-and-wrong edge this suite exists not to produce.
    """
    attested: dict[str, Counter[str]] = {}
    for payload in payloads:
        for reference in payload.get("references", []):
            ident = reference.get("arxivId")
            title = (reference.get("title") or "").strip()
            if ident and _plausible_title(title):
                attested.setdefault(ident, Counter())[title] += 1
    return attested


def _plausible_title(title: str) -> bool:
    """Whether a bibliography's title field is a title at all.

    The field split is heuristic by design, so it sometimes hands back a URL, a page
    range or a venue. Those must not become resolution keys.
    """
    if len(title) < 12:
        return False
    if title.lower().startswith(("http", "www.", "arxiv:", "doi:")):
        return False
    return sum(c.isalpha() for c in title) >= len(title) * 0.5


def _corpus_titles(
    arxiv_ids: list[str], cache: Path, out: Path, payloads: list[dict]
) -> tuple[dict[str, str], dict[str, str]]:
    """Titles for the library: one set to resolve citations with, one to display.

    Resolution is two-tier, and the first version got this wrong in both directions.

    **Attested wins.** Where some bibliography prints a title *alongside the same arXiv
    identifier*, that is independent evidence and it is used. This is what protects
    against a paper mis-stating its own title: arXiv:1909.08593 is "Fine-Tuning
    Language Models from Human Preferences", but its LaTeX carries
    ``\\icmltitle{Language Models are Unsupervised Multitask Learners}`` — a stale ICML
    template copied from GPT-2. Resolving on that would point every citation of GPT-2
    at the wrong paper.

    **Otherwise the paper's own title, with a collision guard.** Requiring attestation
    outright cost nine real edges, and for a reason that defeats the rule: a reference
    can only attest if it already carries an arXiv identifier, and those are precisely
    the references that never needed a title match. So an unattested paper resolves by
    its own title unless that title is already claimed — by another paper's
    attestation, or by another paper in the library. Ambiguity resolves to nothing,
    which is the same answer the anchor layer gives.
    """
    from keystone.lineage.graph import fold

    attested = attested_titles(payloads)
    display: dict[str, str] = {}

    # The library itself — papers that have been ingested. Attestation covers every
    # *cited* work, five hundred of them, and letting those into the resolution map
    # would mark them all as walkable: the reader would link to paper pages that do
    # not exist, because `in_corpus` is read off these keys.
    library: set[str] = set(arxiv_ids)
    index_path = out / "index.json"
    if index_path.exists():
        for entry in json.loads(index_path.read_text()):
            library.add(entry["id"])
            if entry.get("fullTitle"):
                display[entry["id"]] = entry["fullTitle"]

    own: dict[str, str] = {}
    for arxiv_id in arxiv_ids:
        try:
            document, _project = load_project(arxiv_id, cache)
        except Exception:  # noqa: BLE001
            # A title that cannot be read costs this paper its cross-library edges,
            # which is a smaller loss than refusing to build the library at all.
            continue
        if found := document_title(document.text):
            own[arxiv_id] = found

    resolve = resolve_titles(library, own, attested)
    for ident in library:
        # Attested first: it is the only independent evidence, and it is what the
        # field prints. Then the paper's own reading, then whatever the index already
        # had — last, because seeding from the index is how a title that was once
        # misread survives every later rebuild.
        mine, theirs = own.get(ident), resolve.get(ident)
        # The paper's own capitalisation where the two agree on the words — "BERT:
        # Pre-training of..." rather than the bibliography's "Bert: Pre-training of..."
        # — and the attested wording where they disagree, since then the paper's own
        # claim is the one under suspicion.
        best = mine if mine and theirs and fold(mine) == fold(theirs) else theirs
        display[ident] = best or mine or display.get(ident) or ident

    return resolve, display


def resolve_titles(
    library: set[str],
    own: dict[str, str],
    attested: dict[str, Counter[str]],
) -> dict[str, str]:
    """One canonical title per library paper, for matching citations against.

    Separated from the file reading because the rule is subtle enough to have been
    wrong twice — once too strict, once too broad — and it is worth testing directly.
    """
    from keystone.lineage.graph import fold

    # Every folded title any bibliography ties to an identifier, so a self-reported
    # title can be checked against what the field says the name belongs to.
    claimed: dict[str, set[str]] = {}
    for ident, votes in attested.items():
        for title in votes:
            claimed.setdefault(fold(title), set()).add(ident)

    resolve: dict[str, str] = {}
    for ident in library:
        votes = attested.get(ident)
        if votes:
            resolve[ident] = votes.most_common(1)[0][0]
        elif ident in own:
            owners = claimed.get(fold(own[ident]), set())
            if not owners - {ident}:
                resolve[ident] = own[ident]

    # Two library papers claiming one name cannot both be right, and a wrong edge
    # costs more than a missing one.
    duplicates = Counter(fold(title) for title in resolve.values())
    return {
        ident: title
        for ident, title in resolve.items()
        if duplicates[fold(title)] == 1
    }


def _write_lineage_index(out: Path) -> int:
    """The library as a graph: papers as nodes, what they say about each other as edges.

    Derived from the dossiers on disk rather than from this run, so rebuilding one
    paper does not shrink the graph to that paper's edges.
    """
    nodes: list[dict] = []
    edges: list[dict] = []
    titles: dict[str, str] = {}

    # Matched on the shape of an arXiv identifier rather than by excluding known
    # names. The exclusion list was already one file behind — `accuracy.json` landed
    # in this directory and was read as a paper — which is the same mistake that once
    # built a junk /paper/lineage route.
    files = sorted(
        path for path in out.glob("*.json") if _DOSSIER_FILE.match(path.name)
    )
    payloads = [json.loads(path.read_text()) for path in files]
    for payload in payloads:
        titles[payload["id"]] = payload["title"] or payload["id"]

    for payload in payloads:
        tally = payload.get("lineage", {}).get("tally", {})
        nodes.append({
            "id": payload["id"],
            "title": titles[payload["id"]],
            "inherits": tally.get("inherits", 0),
            "contests": tally.get("contests", 0),
            "bare": payload.get("assumptionTally", {}).get("bare", 0),
        })
        for edge in payload.get("lineage", {}).get("edges", []):
            target = edge.get("arxivId")
            if not edge.get("inCorpus") or target not in titles or target == payload["id"]:
                continue
            edges.append({
                "from": payload["id"],
                "to": target,
                "stance": edge["stance"],
                "cue": edge["cue"],
                "sentence": edge["sentence"],
                "section": edge["section"],
                "anchor": edge.get("anchor"),
            })

    (out / "lineage.json").write_text(
        json.dumps({"nodes": nodes, "edges": edges}, indent=2)
    )
    return len(edges)


@app.command("audit-density")
def audit_density(
    arxiv_ids: list[str],
    cache: Path = typer.Option(Path("../../eval/corpus/cache"), help="e-print cache."),
    floor: int = typer.Option(40, help="Minimum items of substance per paper."),
) -> None:
    """Measure how much the reader actually has to show, per paper.

    "The app feels plain" is a judgement; this makes it a number. The audit that
    prompted this existed as a throwaway script, which meant the only way to know
    whether the app had anything to say was to look at it — so it lives here now.
    """
    rows = []
    for arxiv_id in arxiv_ids:
        try:
            payload = build_dossier(arxiv_id, cache).to_dict()
        except SourceUnavailable as exc:
            typer.secho(f"{arxiv_id}: no source ({exc})", fg=typer.colors.YELLOW)
            continue

        items = {
            "claims": len(payload["claims"]),
            "numbers": len(payload["numbers"]),
            "tables": len(payload["tables"]),
            "equations": len(payload["equations"]),
            "sections": len(payload["sections"]),
            "findings": len(payload["findings"]),
            "arxiv": payload["arxiv"],
            # The single most load-bearing dependency, by title. Carried in the index
            # so the paper's social card can name it: that card renders in a
            # serverless function where the dossier files are not on disk, and an
            # index the bundler can see is the only data it can be sure of.
            "foundation": (payload["lineage"].get("foundation") or {}).get("title", ""),
        }
        rows.append((arxiv_id, items, sum(items.values())))

    typer.echo(
        f"{'paper':>14} {'claims':>7} {'numbers':>8} {'tables':>7} {'eqns':>6}"
        f" {'sections':>9} {'findings':>9} {'total':>7}"
    )
    starved = []
    for arxiv_id, items, total in rows:
        typer.echo(
            f"{arxiv_id:>14} {items['claims']:>7} {items['numbers']:>8} "
            f"{items['tables']:>7} {items['equations']:>6} {items['sections']:>9} "
            f"{items['findings']:>9} {total:>7}"
        )
        if total < floor:
            starved.append(f"{arxiv_id} ({total})")

    typer.echo("")
    if starved:
        typer.secho(
            f"{len(starved)} paper(s) below the floor of {floor}: {', '.join(starved)}",
            fg=typer.colors.RED,
            bold=True,
        )
    else:
        typer.secho(
            f"every paper shows at least {floor} items of substance", fg=typer.colors.GREEN, bold=True
        )


@app.command()
def render(pdf: Path, quote: str, out: Path = Path("anchor.png"), zoom: float = 2.0) -> None:
    """Draw a quote's highlight rects onto the page image, for eyeballing."""
    index = DocIndex(Document.open(pdf))
    result = index.locate(quote)
    if result.anchor is None:
        typer.secho(f"REJECTED ({result.reason})", fg=typer.colors.RED)
        raise typer.Exit(1)

    page_no = result.anchor.pages[0]
    with pymupdf.open(pdf) as doc:
        page = doc[page_no]
        for rect in result.anchor.rects:
            if rect.page == page_no:
                annot = page.add_highlight_annot(
                    pymupdf.Rect(rect.x0, rect.y0, rect.x1, rect.y1)
                )
                annot.set_colors(stroke=(1, 0.85, 0.2))
                annot.update()
        page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).save(out)

    typer.echo(f"wrote {out} (page {page_no + 1}, {len(result.anchor.rects)} rects)")


#: Papers already in the library, by filename. Library-level artefacts live in the
#: same directory, so the shape of an arXiv identifier is the test.
_DOSSIER_FILE = re.compile(r"^(?P<id>\d{4}\.\d{4,5})\.json$")

#: arXiv asks for roughly one request every three seconds from bulk clients, and each
#: paper here costs *two* requests — the e-print and the PDF. Budgeting three seconds
#: per paper rather than per request is what produced sixteen spurious "no source"
#: results on the first expansion run, so the delay covers both.
POLITE_DELAY = 6.0


@app.command()
def expand(
    dossiers: Path = typer.Option(Path("../../apps/web/public/dossiers"), help="Existing dossiers."),
    cache: Path = typer.Option(Path("../../eval/corpus/cache"), help="e-print cache."),
    pdfs: Path = typer.Option(Path("../../eval/corpus/pdf"), help="Where to put PDFs."),
    limit: int = typer.Option(40, help="How many new papers to fetch."),
    stanced_only: bool = typer.Option(
        True,
        help="Only papers the library takes a stance on, which guarantees each one an edge.",
    ),
    also: str = typer.Option("", help="Extra arXiv ids to include, comma separated."),
    dry_run: bool = typer.Option(False, help="Rank the candidates and stop."),
) -> None:
    """Grow the library one hop out, along the citations it already has.

    The graph's value is in *walkable* edges — both ends ingested — and those grow
    superlinearly with the corpus, so which papers to add next is not an arbitrary
    choice. The best candidates are the ones the library already says something about:
    ingesting a paper that three library papers adopt from produces three edges before
    that paper's own citations are even read.

    Ranked by how many library papers take a stance on it, then by how many cite it at
    all. Papers with no LaTeX source are skipped and reported, not retried.
    """
    have = {
        match.group("id")
        for path in dossiers.glob("*.json")
        if (match := _DOSSIER_FILE.match(path.name))
    }
    if not have:
        typer.secho(f"no dossiers in {dossiers}", fg=typer.colors.RED)
        raise typer.Exit(1)

    payloads = [
        json.loads(path.read_text())
        for path in sorted(dossiers.glob("*.json"))
        if _DOSSIER_FILE.match(path.name)
    ]
    cited, stanced, titles = survey(payloads, have)
    ranked = rank_candidates(
        cited,
        stanced,
        stanced_only=stanced_only,
        extra=[i.strip() for i in also.split(",") if i.strip()],
    )

    typer.echo(
        f"{len(have)} papers in the library; {len(cited)} arXiv-resolvable citations "
        f"outside it, {sum(1 for v in stanced.values() if v)} of them stanced"
    )
    for ident in ranked[:limit]:
        typer.echo(
            f"  {ident}  stanced={stanced[ident]} cited_by={cited[ident]}  "
            f"{titles.get(ident, '')[:58]}"
        )
    if dry_run:
        return

    pdfs.mkdir(parents=True, exist_ok=True)
    got: list[str] = []
    skipped: list[tuple[str, str]] = []

    for ident in ranked[:limit]:
        try:
            # `cache / "eprints"`, not `cache`: that is where `load_project` looks, and
            # writing them a level up meant every paper was downloaded twice — once
            # here into a directory nothing reads, and again by the dossier build.
            fetch(ident, cache / "eprints")
        except SourceUnavailable as exc:
            skipped.append((ident, str(exc)))
            typer.secho(f"skip  {ident}: {exc}", fg=typer.colors.YELLOW)
            time.sleep(POLITE_DELAY)
            continue
        except Exception as exc:  # noqa: BLE001
            # Deliberately broad. One unreachable paper out of fifty must not end the
            # expansion; the contract is "report it and carry on".
            skipped.append((ident, repr(exc)))
            typer.secho(f"skip  {ident}: {exc}", fg=typer.colors.YELLOW)
            time.sleep(POLITE_DELAY)
            continue

        if not _fetch_pdf(ident, pdfs):
            skipped.append((ident, "PDF could not be downloaded"))
            typer.secho(f"skip  {ident}: no PDF", fg=typer.colors.YELLOW)
            time.sleep(POLITE_DELAY)
            continue

        got.append(ident)
        typer.echo(f"have  {ident}")
        time.sleep(POLITE_DELAY)

    typer.secho(
        f"\nfetched {len(got)}, skipped {len(skipped)}", fg=typer.colors.GREEN, bold=True
    )
    if got:
        typer.echo("\nnow build them:\n  uv run keystone dossier " + " ".join(got))


def _fetch_pdf(arxiv_id: str, into: Path) -> bool:
    """Download a paper's PDF, which the anchor layer needs and the reader shows."""
    target = into / f"{arxiv_id}.pdf"
    if target.exists() and target.stat().st_size > 0:
        return True
    request = urllib.request.Request(
        f"https://arxiv.org/pdf/{arxiv_id}",
        headers={"User-Agent": "keystone/0.1 (+https://github.com/Srikarmk/Keystone)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = response.read()
    except Exception:  # noqa: BLE001
        return False
    if payload[:4] != b"%PDF":
        return False
    staging = target.with_suffix(".partial")
    staging.write_bytes(payload)
    staging.replace(target)
    return True


@app.command("stance-sample")
def stance_sample(
    labels: Path = typer.Option(Path("../../eval/labels/stance.jsonl"), help="Label file."),
    cache: Path = typer.Option(Path("../../eval/corpus/cache"), help="e-print cache."),
    dossiers: Path = typer.Option(Path("../../apps/web/public/dossiers"), help="Library."),
    per_stance: int = typer.Option(12, help="Rows to draw per predicted stance."),
    seed: int = typer.Option(7, help="Sampling seed, so the draw is reproducible."),
) -> None:
    """Draw a sample of citation sites to label by hand, stratified by prediction.

    Appends to the label file, skipping anything already in it, so the sample can be
    grown over time without relabelling. Rows arrive with ``gold: null``; filling that
    in is the labelling.
    """
    from keystone.eval import stance_labels as SL
    from keystone.ingest.sections import extract_sections
    from keystone.lineage.stance import contexts

    existing = SL.load(labels)
    ids = [
        match.group("id")
        for path in sorted(dossiers.glob("*.json"))
        if (match := _DOSSIER_FILE.match(path.name))
    ]

    pool: list[SL.Row] = []
    for arxiv_id in ids:
        try:
            document, _project = load_project(arxiv_id, cache)
        except Exception:  # noqa: BLE001
            continue
        for context in contexts(document.text, extract_sections(document.text)):
            pool.append(SL.Row(
                paper=arxiv_id,
                key=context.key,
                predicted=str(context.stance),
                sentence=context.sentence,
                cue=context.cue,
                section=context.section,
            ))

    drawn = SL.sample(pool, per_stance=per_stance, seed=seed, existing=existing)
    SL.write(labels, existing + drawn)
    typer.secho(
        f"pool {len(pool)} sites; added {len(drawn)} unlabelled rows; "
        f"{len(existing)} already present -> {labels}",
        fg=typer.colors.GREEN,
    )


@app.command("stance-refresh")
def stance_refresh(
    labels: Path = typer.Option(Path("../../eval/labels/stance.jsonl"), help="Label file."),
    cache: Path = typer.Option(Path("../../eval/corpus/cache"), help="e-print cache."),
    dossiers: Path = typer.Option(Path("../../apps/web/public/dossiers"), help="Library."),
) -> None:
    """Re-run the rules over the labelled sample and update what they predicted.

    The gold labels are permanent; the predictions are not. Every change to the cue
    rules has to be re-measured against the same sample, and hand-relabelling to do
    that would be both wasteful and a good way to talk yourself into a better number.
    """
    from keystone.eval import stance_labels as SL
    from keystone.ingest.sections import extract_sections
    from keystone.lineage.stance import contexts

    rows = SL.load(labels)
    if not rows:
        typer.secho(f"no rows in {labels}", fg=typer.colors.YELLOW)
        raise typer.Exit(1)

    wanted = {row.paper for row in rows}
    # Keyed on the sentence as well as the paper and citation key, because a paper
    # cites the same work in several places and `stance-sample` buckets by predicted
    # stance — so the labelled site is not necessarily the first one for that key, and
    # keying on the pair alone re-measures a different sentence and calls it a change.
    # `CitationContext.sentence` is the stripped text the rules read and is deliberately
    # stable against changes to how a citation renders for a reader.
    fresh: dict[tuple[str, str, str], tuple[str, str]] = {}
    for arxiv_id in sorted(wanted):
        try:
            document, _project = load_project(arxiv_id, cache)
        except Exception:  # noqa: BLE001
            continue
        for context in contexts(document.text, extract_sections(document.text)):
            fresh[(arxiv_id, context.key, context.sentence)] = (
                str(context.stance), context.cue,
            )

    updated = missing = 0
    out = []
    for row in rows:
        found = fresh.get((row.paper, row.key, row.sentence))
        if found is None:
            missing += 1
            out.append(row)
            continue
        stance, cue = found
        if stance != row.predicted:
            updated += 1
        out.append(replace(row, predicted=stance, cue=cue))

    SL.write(labels, out)
    typer.secho(
        f"refreshed {len(out)} rows; {updated} predictions changed", fg=typer.colors.GREEN
    )
    if missing:
        # Loud and non-zero. These rows kept a prediction from an older version of the
        # rules, so any figure computed over them is part measurement and part memory.
        typer.secho(
            f"{missing} of {len(out)} labelled sites were not found in the sources; "
            f"their predictions are stale and stance-eval will report them as if fresh",
            fg=typer.colors.RED,
            bold=True,
        )
        raise typer.Exit(1)


@app.command("stance-eval")
def stance_eval(
    labels: Path = typer.Option(Path("../../eval/labels/stance.jsonl"), help="Label file."),
    out: Path = typer.Option(
        Path("../../apps/web/public/dossiers/accuracy.json"),
        help="Where to write the numbers for the site to read.",
    ),
    corpora: Path | None = typer.Option(
        None,
        help="Directory holding scicite/ and acl-arc/, to score against as well.",
    ),
) -> None:
    """Precision and recall of the cue rules on the hand-labelled sample.

    Reported per class with its support, because the sample is stratified and a single
    headline accuracy over it would not mean anything about the corpus.
    """
    from keystone.eval import stance_labels as SL

    rows = SL.load(labels)
    done = [row for row in rows if row.labelled]
    if not done:
        typer.secho(
            f"no labelled rows in {labels}; run stance-sample, then fill in `gold`",
            fg=typer.colors.YELLOW,
        )
        raise typer.Exit(1)

    result = SL.report(done)
    typer.secho(
        f"{result.rows} labelled of {len(rows)} sampled", fg=typer.colors.GREEN, bold=True
    )
    typer.echo(f"{'stance':12} {'gold':>5} {'pred':>5} {'prec':>7} {'recall':>7}")
    for stance in SL.STANCES:
        c = result.classes[stance]
        if c.support == 0 and c.predicted == 0:
            continue
        prec = "    -  " if c.precision is None else f"{c.precision:6.0%} "
        rec = "    -  " if c.recall is None else f"{c.recall:6.0%} "
        typer.echo(f"{stance:12} {c.support:5} {c.predicted:5} {prec:>7} {rec:>7}")

    lo, hi = result.interval
    typer.echo()
    typer.echo(f"{'':18} {'acc':>6}  {'95% CI':>12}  {'macro-F1':>9}")
    typer.echo(
        f"cue rules          {result.accuracy:6.0%}  [{lo:4.0%},{hi:4.0%}]  "
        f"{result.macro_f1:8.0%}"
    )
    typer.echo(
        f"bag-of-words NB    {result.baseline_accuracy:6.0%}  {'':12}  "
        f"{result.baseline_macro_f1:8.0%}   (leave-one-out, cue words removed)"
    )
    typer.echo(f"majority class     {result.majority_accuracy:6.0%}")
    typer.echo(
        "\nmacro-F1 is the metric published citation-intent work reports; accuracy "
        "flatters\nany system that predicts the majority `background` class well."
    )

    # Reported apart, because the first sixty rows are what the cue rules were fixed
    # against and their score stopped estimating anything the moment that happened.
    for split in ("tuned", "heldout"):
        rows_in = [row for row in done if row.split == split]
        if not rows_in:
            continue
        agree = sum(1 for row in rows_in if row.predicted == row.gold)
        label = "tuned on" if split == "tuned" else "held out"
        typer.echo(f"  {label:9} {len(rows_in):3} rows   {agree / len(rows_in):6.0%}")

    if result.confusions:
        typer.echo("\nerrors (gold -> predicted):")
        for (gold, predicted), n in result.confusions.most_common():
            typer.echo(f"  {gold} -> {predicted}: {n}")

    external = _external_report(corpora) if corpora else []

    # Written for the reader to display. The site claims these readings are checkable,
    # so how often they are right belongs on the site rather than in a terminal — and
    # generating it here is what stops the published number drifting from the labels.
    held = [row for row in done if row.split == "heldout"]
    held_hits = sum(1 for r in held if r.predicted == r.gold)
    held_lo, held_hi = SL.wilson(held_hits, len(held)) if held else (0.0, 0.0)
    payload = {
        "labelled": result.rows,
        "heldOut": len(held),
        # The interval, not just the point. At 30 rows the point estimate alone
        # invites a claim the sample cannot support.
        "heldOutInterval": [round(held_lo, 3), round(held_hi, 3)],
        "macroF1": round(result.macro_f1, 3),
        "baselineMacroF1": round(result.baseline_macro_f1, 3),
        "heldOutAccuracy": (
            round(sum(1 for r in held if r.predicted == r.gold) / len(held), 3)
            if held else None
        ),
        "accuracy": round(result.accuracy, 3),
        "baselineAccuracy": round(result.baseline_accuracy, 3),
        "majorityAccuracy": round(result.majority_accuracy, 3),
        # Somebody else's labels, on citations from papers outside the library. The
        # figures above describe rules measured on the corpus they were written
        # against; these are the only ones that describe how they travel.
        "external": [item.to_dict() for item in external],
        "classes": {
            stance: {
                "gold": c.support,
                "predicted": c.predicted,
                "precision": None if c.precision is None else round(c.precision, 3),
                "recall": None if c.recall is None else round(c.recall, 3),
            }
            for stance, c in result.classes.items()
            if c.support or c.predicted
        },
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2))
    typer.secho(f"\nwrote {out}", fg=typer.colors.GREEN)


if __name__ == "__main__":
    app()


def _external_report(corpora: Path) -> list:
    """Score the shipped classifier against SciCite and ACL-ARC, and print it.

    Kept out of the repository because the corpora are not mine to redistribute, so
    this is a no-op until they are fetched — see eval/corpora/README.md. The numbers it
    produces are the honest ones: every accuracy figure this project published before
    it came from ninety citations I labelled myself, drawn from the same forty-one
    papers the cue tables were written against.
    """
    from keystone.eval.external import evaluate

    results = evaluate(corpora)
    if not results:
        typer.secho(
            f"no corpora under {corpora} (expected scicite/ and acl-arc/)",
            fg=typer.colors.YELLOW,
        )
        return []

    typer.echo()
    typer.secho("against public labels", fg=typer.colors.GREEN, bold=True)
    typer.echo(
        f"{'corpus':10} {'n':>6} {'read':>6} {'right':>6} {'95% CI':>13} {'macro-F1':>9}"
    )
    for item in results:
        lo, hi = item.spoken_interval
        typer.echo(
            f"{item.corpus:10} {item.instances:6} {item.coverage:6.1%} "
            f"{item.spoken_precision:6.1%} [{lo:5.0%},{hi:5.0%}] {item.macro_f1:9.3f}"
        )
    typer.echo(
        "\n`read` is the share of citations a stance was reported for, `right` how "
        "often\nthose were correct. macro-F1 blends the two and so punishes silence as "
        "hard as\nerror, which measures a benchmark entry rather than a tool built to "
        "decline."
    )
    for item in results:
        typer.echo(f"\n{item.corpus}")
        for label in item.labels:
            score = item.classes[label]
            if score.support == 0:
                continue
            precision = "   -  " if score.precision is None else f"{score.precision:6.2f}"
            typer.echo(
                f"  {label:20} support {score.support:5}  said {score.predicted:5}"
                f"  P {precision}  R {score.recall:5.2f}"
            )
        if item.unreachable:
            typer.echo(
                f"  no class maps to {', '.join(item.unreachable)}, so macro-F1 here "
                f"cannot exceed {item.ceiling:.3f}"
            )
    typer.echo(
        "\nPublished reference points: ACL-ARC 6-class macro-F1 — cue phrases (Teufel\n"
        "2000) 0.273, random forest (Jurgens 2018) 0.530, Falcon-7B 0.733. SciCite\n"
        "3-class macro-F1 — neural state of the art 0.84-0.889."
    )
    return results


@app.command("assumption-eval")
def assumption_eval(
    corpora: Path = typer.Option(
        Path("../../eval/corpora/bioscope"),
        help="Directory holding BioScope's full_papers.xml and abstracts.xml.",
    ),
) -> None:
    """Score the assumption cues against BioScope's speculation annotations.

    A *related* task, not the same one, and the output says so. BioScope marks every
    sentence whose claim is hedged; Keystone looks for the narrower case of a paper
    announcing something it takes as given. Recall against BioScope is therefore low
    by construction and is not a defect — the figure that describes the detector is
    precision on the sentences it does flag.
    """
    from keystone.eval.hedging import evaluate

    reports = evaluate(corpora)
    if not reports:
        typer.secho(
            f"no BioScope files under {corpora} — see eval/corpora/README.md",
            fg=typer.colors.YELLOW,
        )
        raise typer.Exit(1)

    typer.secho("assumption cues against BioScope", fg=typer.colors.GREEN, bold=True)
    typer.echo(
        f"{'corpus':22} {'sentences':>9} {'flagged':>8} {'right':>7} {'95% CI':>13}"
    )
    for report in reports:
        low, high = report.precision_interval
        typer.echo(
            f"{report.corpus:22} {report.sentences:9} "
            f"{report.flagged:8} {report.precision:7.1%} [{low:5.0%},{high:5.0%}]"
        )

    for report in reports:
        typer.echo(f"\n{report.corpus}")
        typer.echo(
            f"  BioScope marks {report.gold} of {report.sentences} sentences as "
            f"speculative; Keystone flagged {report.flagged} "
            f"({report.coverage:.1%}), of which {report.agreed} overlap."
        )
        if report.kinds:
            typer.echo(
                "  kinds flagged: "
                + ", ".join(f"{k} {n}" for k, n in sorted(report.kinds.items()))
            )
        for _sid, cue, text in report.unshared[:6]:
            typer.echo(f"    only Keystone [{cue}]: {text[:110]}")

    typer.echo(
        "\nRecall is low on purpose. BioScope annotates hedging — \"these results may\n"
        "indicate a role for X\" — and Keystone annotates assumptions the paper takes\n"
        "on and moves past, which is a subset. CoNLL-2010's ~85% F1 figures are for\n"
        "the hedging task and are not a bar this is trying to clear."
    )
