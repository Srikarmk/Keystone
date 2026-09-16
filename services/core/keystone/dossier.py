"""Assembling a paper's dossier — the object the reader actually sees."""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from pathlib import Path
from typing import Any

import keystone.audit.checks.tables  # noqa: F401  (registers the checks)
from keystone.audit.registry import run
from keystone.audit.trace import Coverage, headline_mentions, mismatch_findings, trace_all
from keystone.graph.models import Finding, Paper
from keystone.ingest.anchors import Anchor, DocIndex
from keystone.ingest.arxiv_source import load
from keystone.ingest.latex import label_kinds, source_sentences
from keystone.ingest.pdf import Document
from keystone.ingest.sections import extract_sections
from keystone.ingest.tables import build_tables


def _anchor_json(anchor: Anchor | None, pages: dict[int, tuple[float, float]]) -> dict | None:
    """An anchor in a form the reader can draw, with the page box to scale against.

    Rectangles are in PDF points; the viewer renders at whatever width it has. Sending
    the page dimensions alongside lets it scale without having to know anything about
    the document.
    """
    if anchor is None or not anchor.rects:
        return None
    page = anchor.rects[0].page
    width, height = pages.get(page, (612.0, 792.0))
    return {
        "page": page,
        "pageWidth": width,
        "pageHeight": height,
        "precision": anchor.precision,
        "rects": [
            {"x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1}
            for r in anchor.rects
            if r.page == page
        ],
    }


@dataclass(frozen=True, slots=True)
class Dossier:
    paper: Paper
    coverage: Coverage
    findings: tuple[Finding, ...]
    claim_anchors: tuple[Anchor | None, ...] = ()
    evidence_anchors: tuple[Anchor | None, ...] = ()
    page_sizes: dict[int, tuple[float, float]] = None  # type: ignore[assignment]

    def to_dict(self) -> dict[str, Any]:
        keystone = self.coverage.keystone
        pages = self.page_sizes or {}
        claim_anchors = self.claim_anchors or ((None,) * len(self.coverage.claims))
        evidence_anchors = self.evidence_anchors or ((None,) * len(self.coverage.claims))
        return {
            "id": self.paper.id,
            "title": self.paper.title,
            "keystone": None if keystone is None else {
                "table": keystone.table.name,
                "caption": keystone.table.caption,
                "supported": keystone.supported,
                "share": round(keystone.share, 3),
                "summary": keystone.summary,
            },
            "coverage": {
                "claims": len(self.coverage.claims),
                "supported": len(self.coverage.supported),
                "declared": len(self.coverage.declared),
                "unsupported": len(self.coverage.unsupported),
                "mismatched": len(self.coverage.mismatched),
                "rate": round(self.coverage.rate, 3),
            },
            "claims": [
                {
                    "value": t.mention.number.raw,
                    "section": str(t.mention.section),
                    "sentence": t.mention.sentence,
                    "status": t.status,
                    "table": t.table.name if t.table else None,
                    "caption": t.table.caption if t.table else None,
                    "row": t.cell.row_header if t.cell else None,
                    "column": t.cell.column_header if t.cell else None,
                    "cell": t.cell.raw if t.cell else None,
                    "evidenceLabel": t.evidence_label,
                    "anchor": _anchor_json(claim_anchors[i], pages),
                    "evidenceAnchor": _anchor_json(evidence_anchors[i], pages),
                }
                for i, t in enumerate(self.coverage.claims)
            ],
            "pdfUrl": f"https://arxiv.org/pdf/{self.paper.id}",
            "tables": [
                {
                    "name": table.name,
                    "caption": table.caption,
                    "numericCells": len(table.numeric_cells),
                    "supports": sum(
                        1 for t in self.coverage.supported
                        if t.table is not None and t.table.ordinal == table.ordinal
                    ),
                }
                for table in self.paper.tables
            ],
            "findings": [f.to_dict() for f in self.findings],
        }


def build(
    arxiv_id: str, cache_dir: Path, title: str = "", pdf_path: Path | None = None
) -> Dossier:
    """Ingest a paper and produce everything the reader sees. No model in the loop."""
    document = load(arxiv_id, cache_dir)
    sections = extract_sections(document.text)
    tables = build_tables(document.tables)

    paper = Paper(
        id=arxiv_id,
        title=title,
        sections=sections,
        tables=tables,
        mentions=headline_mentions(sections),
        notes=document.text,
    )
    # Every sentence in the paper, so a headline number can be followed to wherever
    # the body restates it and says what it rests on.
    coverage = trace_all(
        paper.mentions,
        paper.tables,
        label_kinds(document.text),
        tuple(source_sentences(document.text)),
    )
    findings = tuple(run(paper)) + tuple(mismatch_findings(coverage))

    claim_anchors: tuple[Anchor | None, ...] = ()
    evidence_anchors: tuple[Anchor | None, ...] = ()
    page_sizes: dict[int, tuple[float, float]] = {}

    if pdf_path is not None and pdf_path.exists():
        pdf = Document.open(pdf_path)
        index = DocIndex(pdf)
        page_sizes = {p.number: (p.width, p.height) for p in pdf.pages}
        claim_anchors = tuple(
            index.locate(t.mention.sentence).anchor for t in coverage.claims
        )
        evidence_anchors = tuple(_evidence_anchor(index, t) for t in coverage.claims)

    return Dossier(
        paper=paper,
        coverage=coverage,
        findings=findings,
        claim_anchors=claim_anchors,
        evidence_anchors=evidence_anchors,
        page_sizes=page_sizes,
    )


def _evidence_anchor(index: DocIndex, trace) -> Anchor | None:
    """Where in the PDF the evidence for a claim lives.

    Preference order matters. A caption locates reliably and takes the reader to the
    right table, but pointing at the *cell* is what makes the claim checkable at a
    glance. So the cell is tried first — qualified by its row label, since a bare
    "28.4" occurs several times on a page and an ambiguous match is refused — and the
    caption is the fallback rather than the goal.
    """
    if trace.table is None or not trace.table.caption:
        return None

    caption = index.locate(trace.table.caption)
    if caption.anchor is None:
        return None
    page = caption.anchor.rects[0].page if caption.anchor.rects else None
    if page is None:
        return caption.anchor

    cell = trace.cell
    if cell is not None:
        for needle in (f"{cell.row_header} {cell.raw}", cell.raw):
            if not needle.strip():
                continue
            located = index.locate_on_page(needle, page)
            if located is not None:
                return located

    return caption.anchor
