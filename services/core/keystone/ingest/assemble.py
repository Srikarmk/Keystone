"""Assembling a :class:`Paper` from ingested sources."""

from __future__ import annotations

from pathlib import Path

from keystone.graph.models import Paper
from keystone.ingest.arxiv_source import load
from keystone.ingest.tables import build_tables


def paper_from_arxiv(arxiv_id: str, cache_dir: Path) -> Paper:
    """Build a paper from its arXiv LaTeX source.

    Source-only for now: it yields exact table numbers, emphasis, and band structure
    without a model in the loop, which is everything the deterministic checks need.
    Prose claims and PDF anchors join later, at which point the same Paper gains
    sections and mentions.
    """
    document = load(arxiv_id, cache_dir)
    return Paper(
        id=arxiv_id,
        tables=build_tables(document.tables),
        notes=document.text,
    )
