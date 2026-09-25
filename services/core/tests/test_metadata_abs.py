"""Reading a paper's record off its abstract page.

The API is the right way to ask, and `from_abs` is what runs when it will not answer:
arXiv returns 406 Not Acceptable while throttling, and it does so for
`export.arxiv.org/api/query` long after `arxiv.org/abs/` is still serving. Twenty-seven
papers reached the library with no date and no category that way, which drops them out
of the timeline and into an uncategorised heap on the front page.

Parsing only — no network. A page shape that changes will break these, which is the
point: the alternative is discovering it as another silent gap.
"""

from __future__ import annotations

from keystone.ingest.metadata import from_abs

PAGE = """
<html><body>
<div class="dateline">[Submitted on 25 Aug 2016 (v1), last revised 28 Jan 2018 (this version, v5)]</div>
<div class="authors"><span>Authors:</span>
  <a href="/a/huang_g_1">Gao Huang</a>, <a href="/a/liu_z_1">Zhuang Liu</a>,
  <a href="/a/weinberger_k_1">Kilian Q. Weinberger</a></div>
<td class="tablecell subjects"><span class="primary-subject">Computer Vision and Pattern
Recognition (cs.CV)</span>; Machine Learning (cs.LG)</td>
</body></html>
"""


def _parsed(monkeypatch, html: str):
    """`from_abs` with the network replaced by a fixed page."""
    import contextlib
    import io

    from keystone.ingest import metadata

    @contextlib.contextmanager
    def fake(request, timeout=0):
        yield io.BytesIO(html.encode())

    monkeypatch.setattr(metadata.urllib.request, "urlopen", fake)
    return from_abs("1608.06993")


def test_reads_the_first_submission_date(monkeypatch) -> None:
    """The v1 date, not the revision — the library is ordered by when a paper landed."""
    assert _parsed(monkeypatch, PAGE).published == "2016-08-25"


def test_reads_the_primary_category_first(monkeypatch) -> None:
    got = _parsed(monkeypatch, PAGE)
    assert got.primary == "cs.CV"
    assert got.categories == ("cs.CV", "cs.LG")


def test_reads_the_authors_in_order(monkeypatch) -> None:
    assert _parsed(monkeypatch, PAGE).authors == (
        "Gao Huang",
        "Zhuang Liu",
        "Kilian Q. Weinberger",
    )


def test_a_page_with_no_dateline_yields_nothing(monkeypatch) -> None:
    """Better no record than a record with a fabricated date."""
    assert _parsed(monkeypatch, "<html><body>nothing here</body></html>") is None
