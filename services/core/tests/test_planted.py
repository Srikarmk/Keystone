"""Measuring the check suite against deliberately planted defects.

Unit fixtures prove a check works on the table its author imagined. Only real tables
prove it works on tables with spanning headers, banded rules, and half-prose cells.
And a suite reporting nothing across a corpus is indistinguishable from a suite that
*can* report nothing, which is the failure most likely to ship unnoticed.

The gate is deliberately asymmetric. Silence on unmodified papers is an absolute
requirement: a confident false finding on a correct table costs more trust than a
missed one costs coverage. Recall is tracked but held to a low floor, because the
measured ceiling is genuinely low — see the note on the recall gate below.
"""

from __future__ import annotations

import random

import pytest

import keystone.audit.checks.tables  # noqa: F401  (registers the checks)
from keystone.audit.registry import run
from keystone.eval.planted import paper_with, plant_emphasis_error
from keystone.ingest.arxiv_source import SourceUnavailable
from keystone.ingest.assemble import paper_from_arxiv

from .conftest import CORPUS, corpus_paths
from .test_source_alignment import requires_cache

CACHE = CORPUS.parent / "cache"

# The measured operating point: zero false positives, roughly one planted defect in
# nine. A parameter sweep showed the only configurations reaching 33% recall also
# produced three or four false positives across the same nine papers, which is the
# wrong trade for a tool whose whole claim is that its findings can be trusted.
#
# Recall here is limited by orientation ambiguity rather than by the check's
# arithmetic: establishing whether a table compares down columns or across rows needs
# signal the source does not carry.
MIN_RECALL = 0.10


def _papers():
    out = []
    for path in corpus_paths():
        try:
            out.append(paper_from_arxiv(path.stem, CACHE))
        except (SourceUnavailable, ValueError):
            continue
    return out


@requires_cache
def test_no_findings_on_unmodified_papers():
    """Nine heavily reviewed papers must produce no findings at all.

    Every false positive this suite has ever produced was caught here first: label
    substring matching reading "summarization" as a total row, column-orientation
    assumed on a row-compared table, a band's best value judged against the whole
    column, and a row of four different metrics compared end to end.
    """
    spurious = [
        f"{paper.id}: {finding.title}"
        for paper in _papers()
        for finding in run(paper)
    ]
    assert not spurious, "findings reported on unmodified papers:\n" + "\n".join(spurious)


@requires_cache
def test_planted_defects_are_detected():
    papers = _papers()
    if not papers:
        pytest.skip("no cached source available")

    rng = random.Random(0)
    planted = caught = 0
    for paper in papers:
        for table in paper.tables:
            result = plant_emphasis_error(table, rng)
            if result is None:
                continue
            mutated, defect = result
            planted += 1
            if defect.was_found(run(paper_with(paper, mutated))):
                caught += 1

    assert planted >= 5, "too few plantable sites to measure anything"
    recall = caught / planted
    assert recall >= MIN_RECALL, f"recall {recall:.0%} below floor {MIN_RECALL:.0%}"


@requires_cache
def test_planting_does_not_disturb_the_rest_of_the_paper():
    """One planted defect must not cascade into findings about untouched tables."""
    rng = random.Random(1)
    for paper in _papers():
        baseline = len(run(paper))
        for table in paper.tables:
            result = plant_emphasis_error(table, rng)
            if result is None:
                continue
            mutated, _defect = result
            after = run(paper_with(paper, mutated))
            assert len(after) <= baseline + 1, (
                f"{paper.id} {table.name}: one plant produced {len(after) - baseline} findings"
            )
