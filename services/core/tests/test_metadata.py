"""Reading arXiv's own record of a paper.

The module exists so the library can group papers without inventing a taxonomy, which
makes exactly one property worth holding above all others: a paper whose metadata could
not be read must come back *uncategorised*, never plausibly categorised. A wrong
heading over a verbatim quote is the one kind of error this project cannot afford.
"""

from __future__ import annotations

import json
from pathlib import Path

from keystone.ingest.metadata import (
    CATEGORY_NAMES,
    Metadata,
    _parse,
    category_name,
    load_cache,
    resolve,
    save_cache,
)

ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <arxiv:primary_category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1512.03385v1</id>
    <published>2015-12-10T19:51:55Z</published>
    <title>Deep Residual Learning for Image Recognition</title>
    <arxiv:primary_category term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
"""


# ------------------------------------------------------------------- parsing


def test_the_version_suffix_is_dropped_from_the_identifier() -> None:
    """arXiv answers for "1706.03762" with an id of "1706.03762v7".

    Left in, every lookup misses and the whole library silently loses its categories.
    """
    got = _parse(ATOM)
    assert set(got) == {"1706.03762", "1512.03385"}


def test_the_primary_category_leads_the_list() -> None:
    got = _parse(ATOM)["1706.03762"]
    assert got.primary == "cs.CL"
    assert got.categories == ("cs.CL", "cs.LG")


def test_the_primary_is_not_repeated_among_the_cross_lists() -> None:
    """arXiv lists the primary again under <category>; showing it twice is wrong."""
    assert _parse(ATOM)["1706.03762"].categories.count("cs.CL") == 1


def test_the_publication_date_is_a_plain_iso_day() -> None:
    assert _parse(ATOM)["1512.03385"].published == "2015-12-10"


def test_an_entry_with_no_primary_still_parses() -> None:
    """A malformed record should cost that paper its heading, not the whole run."""
    atom = ATOM.replace(
        '<arxiv:primary_category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>',
        "",
    )
    got = _parse(atom)["1706.03762"]
    assert got.primary == ""
    assert got.categories == ("cs.CL", "cs.LG")


# ------------------------------------------------------------------- naming


def test_a_known_code_reads_as_arxivs_own_name() -> None:
    assert category_name("cs.CL") == "Computation and Language"
    assert category_name("stat.ML") == "Machine Learning (Statistics)"


def test_an_unknown_code_is_shown_as_itself_rather_than_guessed() -> None:
    """Better a bare "cs.GT" than a heading I made up for it."""
    assert category_name("cs.GT") == "cs.GT"
    assert "cs.GT" not in CATEGORY_NAMES


def test_every_name_differs_from_its_code() -> None:
    """A mapping entry that just repeats the code is a stub someone forgot."""
    assert all(code != name for code, name in CATEGORY_NAMES.items())


# ------------------------------------------------------------------- caching


def test_a_cache_round_trips(tmp_path: Path) -> None:
    path = tmp_path / "metadata.json"
    records = {"1706.03762": Metadata("1706.03762", "cs.CL", ("cs.CL", "cs.LG"), "2017-06-12")}
    save_cache(path, records)
    assert load_cache(path) == records


def test_a_corrupt_cache_is_ignored_rather_than_fatal(tmp_path: Path) -> None:
    """The cache is a convenience. Losing it costs a network round trip, not a build."""
    path = tmp_path / "metadata.json"
    path.write_text("{ this is not json")
    assert load_cache(path) == {}


def test_a_missing_cache_is_empty(tmp_path: Path) -> None:
    assert load_cache(tmp_path / "nowhere.json") == {}


def test_a_cache_entry_of_the_wrong_shape_is_skipped(tmp_path: Path) -> None:
    path = tmp_path / "metadata.json"
    path.write_text(json.dumps({"1706.03762": "cs.CL", "1512.03385": {"primary": "cs.CV"}}))
    got = load_cache(path)
    assert set(got) == {"1512.03385"}


def test_resolve_does_not_reach_the_network_for_a_cached_paper(tmp_path: Path) -> None:
    """The library is rebuilt often; refetching every category each time is rude."""
    path = tmp_path / "metadata.json"
    save_cache(path, {"1706.03762": Metadata("1706.03762", "cs.CL", ("cs.CL",), "2017-06-12")})
    # No network is available to this test, so a fetch would fail rather than hang;
    # the assertion is that the value comes back at all.
    got = resolve(["1706.03762"], path)
    assert got["1706.03762"].primary == "cs.CL"
