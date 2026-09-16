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
from keystone.audit.checks.tables import emphasis_not_best
from keystone.audit.registry import run
from keystone.eval.planted import paper_with, plant_emphasis_error
from keystone.ingest.arxiv_source import SourceUnavailable
from keystone.ingest.assemble import paper_from_arxiv

from .conftest import CORPUS, corpus_paths, library_paths
from .test_source_alignment import requires_cache

CACHE = CORPUS.parent / "cache"

# The emphasis check's measured recall, kept as a floor on its *arithmetic* rather
# than as a gate on the suite: the check is retired and no longer registered, because
# its premise — that emphasis marks the single best value in its group — is a
# convention it cannot establish. See the note above `emphasis_not_best`.
MIN_RECALL = 0.10


def _papers(paths):
    out = []
    for path in paths:
        try:
            out.append(paper_from_arxiv(path.stem, CACHE))
        except (SourceUnavailable, ValueError):
            continue
    return out


@requires_cache
def test_no_findings_on_unmodified_papers():
    """The registered suite must produce nothing at all on real papers.

    Measured over the whole library rather than the gate corpus, on purpose: this is
    the assertion that should get *harder* as papers are added, and the first time it
    was widened it immediately failed. Every false positive this suite has produced
    was caught here — label substring matching reading "summarization" as a total row,
    column orientation assumed on a row-compared table, a band's best value judged
    against the whole column, and most recently a table that highlights every score
    statistically tied with the best.
    """
    papers = _papers(library_paths())
    if len(papers) < 9:
        pytest.skip("library too small to be a meaningful gate")

    spurious = [
        f"{paper.id}: {finding.title}"
        for paper in papers
        for finding in run(paper)
    ]
    assert not spurious, (
        f"findings reported on {len(papers)} unmodified papers:\n" + "\n".join(spurious)
    )


@requires_cache
def test_the_retired_emphasis_check_can_still_find_a_planted_defect():
    """Its arithmetic works. That was never what was wrong with it.

    Called directly rather than through the registry, since it is no longer
    registered. Kept because the distinction matters: a check can be perfectly sound
    and still unusable, and conflating "the rule is wrong" with "the premise cannot be
    established" would send the next attempt after the wrong problem.
    """
    papers = _papers(corpus_paths())
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
            if defect.was_found(emphasis_not_best(paper_with(paper, mutated))):
                caught += 1

    assert planted >= 5, "too few plantable sites to measure anything"
    recall = caught / planted
    assert recall >= MIN_RECALL, f"recall {recall:.0%} below floor {MIN_RECALL:.0%}"


@requires_cache
def test_the_retired_emphasis_check_is_why_it_is_retired():
    """And it fires on unmodified papers, which is the reason it does not ship.

    Asserting the failure rather than describing it, so that re-registering the check
    has to come with evidence: if a future premise fix makes this test fail, the check
    has earned its place back and this test should be deleted with it.
    """
    papers = _papers(library_paths())
    if len(papers) < 20:
        pytest.skip("needs the expanded library to reproduce")

    spurious = [
        f"{paper.id}: {finding.title}"
        for paper in papers
        for finding in emphasis_not_best(paper)
    ]
    assert spurious, (
        "the emphasis check no longer fires on unmodified papers; if its premise has "
        "been fixed, re-register it and delete this test"
    )


@requires_cache
def test_planting_does_not_disturb_the_rest_of_the_paper():
    """One planted defect must not cascade into findings about untouched tables.

    Measured against the retired check directly, because that is the one this harness
    plants defects for. The property it guards is about the *pooled premise*: the
    convention is inferred paper-wide, so a single corrupted marker could in principle
    drag the inference down and turn every other table's markers into violations.
    """
    rng = random.Random(1)
    for paper in _papers(corpus_paths()):
        baseline = len(list(emphasis_not_best(paper)))
        for table in paper.tables:
            result = plant_emphasis_error(table, rng)
            if result is None:
                continue
            mutated, _defect = result
            after = len(list(emphasis_not_best(paper_with(paper, mutated))))
            assert after <= baseline + 1, (
                f"{paper.id} {table.name}: one plant produced {after - baseline} findings"
            )
