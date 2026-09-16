"""Keystone developer CLI."""

from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path

import pymupdf
import typer

from keystone.ingest import Document, DocIndex, roundtrip
from keystone.ingest.arxiv_source import SourceUnavailable, fetch, load, unpack
from keystone.ingest.latex import (
    anchorable_runs,
    anchorable_sentences,
    expand_inputs,
)
from keystone.ingest.assemble import paper_from_arxiv
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
) -> None:
    """Build dossiers and write them as JSON for the reader."""
    lookup = dict(
        pair.split("=", 1) for pair in titles.split(",") if "=" in pair
    )
    out.mkdir(parents=True, exist_ok=True)
    index = []

    for arxiv_id in arxiv_ids:
        try:
            built = build_dossier(
                arxiv_id,
                cache,
                title=lookup.get(arxiv_id, ""),
                pdf_path=pdfs / f"{arxiv_id}.pdf",
            )
        except SourceUnavailable as exc:
            typer.secho(f"{arxiv_id}: no source ({exc})", fg=typer.colors.YELLOW)
            continue

        payload = built.to_dict()
        (out / f"{arxiv_id}.json").write_text(json.dumps(payload, indent=2))
        index.append({
            "id": arxiv_id,
            "title": payload["title"] or arxiv_id,
            "coverage": payload["coverage"],
            "keystone": payload["keystone"],
            "findings": len(payload["findings"]),
        })
        typer.echo(
            f"{arxiv_id}: {payload['coverage']['supported']}/{payload['coverage']['claims']} "
            f"claims supported, {len(payload['findings'])} finding(s)"
        )

    # Merge rather than replace: building one paper must not drop every other paper
    # from the index, which is what made the reader show a single-entry list.
    index_path = out / "index.json"
    existing = json.loads(index_path.read_text()) if index_path.exists() else []
    merged = {entry["id"]: entry for entry in existing}
    merged.update({entry["id"]: entry for entry in index})
    index_path.write_text(json.dumps(list(merged.values()), indent=2))

    typer.secho(
        f"wrote {len(index)} dossier(s); index now lists {len(merged)}",
        fg=typer.colors.GREEN,
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


if __name__ == "__main__":
    app()
