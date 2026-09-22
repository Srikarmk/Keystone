"""The search index, and the hash it shares with the reader.

A search hit carries the id of the row it came from, so clicking it lands on the
sentence rather than on the paper that happens to contain it. That id is computed
twice — here in Python when the index is written, and in TypeScript in
`apps/web/lib/rows.ts` when the row is rendered — and the two have to agree
exactly.

Nothing fails loudly if they drift. The index still builds, the page still renders,
and every search result quietly scrolls to nothing. So the known values below are
the contract: they were produced by running both implementations side by side, and
if either changes, one of these breaks.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from keystone.cli import _row_digest, _row_slug, _write_search_index

#: Produced by `lib/rows.ts` — assumptionId({sentence}) minus its "assume-" prefix.
SHARED = {
    "We assume the data is i.i.d.": "o8q3k",
    "For simplicity we restrict attention to the linear case.": "mu6ity",
    "It is well known that the genetic code varies in several organisms.": "ud8w23",
    "": "ztntfp",
}


@pytest.mark.parametrize("sentence,want", SHARED.items())
def test_the_digest_matches_the_reader(sentence: str, want: str) -> None:
    assert _row_digest(sentence) == want


def test_a_citation_key_slugs_the_same_way() -> None:
    assert _row_slug("vaswani2017attention") == "vaswani2017attention"
    assert _row_slug("Graves-Schmidhuber:TPAMI2009") == "graves-schmidhuber-tpami2009"


def test_a_key_with_nothing_sluggable_falls_back_to_the_digest() -> None:
    """A key of pure punctuation would otherwise produce the id "cite-"."""
    assert _row_slug("...") == _row_digest("...")


# ------------------------------------------------------------------ the index


def _dossier(**over) -> dict:
    base = {
        "title": "Attention Is All You Need",
        "lineage": {
            "edges": [
                {
                    "key": "he2016",
                    "stance": "inherits",
                    "sentence": "We employ a residual connection.",
                    "cue": "We employ",
                    "section": "Encoder",
                    "title": "Deep residual learning",
                }
            ]
        },
        "assumptions": [
            {
                "sentence": "We assume the data is i.i.d.",
                "support": "bare",
                "cue": "We assume",
                "section": "Method",
            }
        ],
    }
    base.update(over)
    return base


def test_the_index_carries_one_row_per_reading(tmp_path: Path) -> None:
    """The unit is a reading, not a paper.

    A reader asking "does anything here argue with layer normalisation" is asking
    about sentences, and a title index cannot answer that.
    """
    (tmp_path / "1706.03762.json").write_text(json.dumps(_dossier()))
    assert _write_search_index(tmp_path) == 2

    found = json.loads((tmp_path / "search.json").read_text())
    assert found["titles"] == {"1706.03762": "Attention Is All You Need"}
    kinds = {row["kind"]: row for row in found["rows"]}
    assert kinds["edge"]["row"] == "cite-he2016"
    assert kinds["edge"]["text"] == "We employ a residual connection."
    assert kinds["assumption"]["row"] == "assume-o8q3k"


def test_library_files_are_not_mistaken_for_papers(tmp_path: Path) -> None:
    """`lineage.json` and `accuracy.json` sit in the same directory."""
    (tmp_path / "1706.03762.json").write_text(json.dumps(_dossier()))
    (tmp_path / "lineage.json").write_text(json.dumps({"nodes": [], "edges": []}))
    (tmp_path / "accuracy.json").write_text(json.dumps({"labelled": 90}))
    _write_search_index(tmp_path)
    found = json.loads((tmp_path / "search.json").read_text())
    assert list(found["titles"]) == ["1706.03762"]


def test_a_malformed_dossier_is_skipped_rather_than_fatal(tmp_path: Path) -> None:
    (tmp_path / "1706.03762.json").write_text(json.dumps(_dossier()))
    (tmp_path / "1512.03385.json").write_text("{ not json")
    assert _write_search_index(tmp_path) == 2
