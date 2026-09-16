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
from keystone.ingest.arxiv_source import load
from keystone.ingest.sections import extract_sections
from keystone.ingest.tables import build_tables


@dataclass(frozen=True, slots=True)
class Dossier:
    paper: Paper
    coverage: Coverage
    findings: tuple[Finding, ...]

    def to_dict(self) -> dict[str, Any]:
        keystone = self.coverage.keystone
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
                }
                for t in self.coverage.claims
            ],
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


def build(arxiv_id: str, cache_dir: Path, title: str = "") -> Dossier:
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
    coverage = trace_all(paper.mentions, paper.tables)
    findings = tuple(run(paper)) + tuple(mismatch_findings(coverage))
    return Dossier(paper=paper, coverage=coverage, findings=findings)
