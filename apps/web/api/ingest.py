"""
Analyse an arXiv paper that is not in the library, on demand.

The library is seventy-four papers chosen by hand, and that is the honest limit of a
demonstration: a reader's own paper is never in it. This route removes that limit.
Given an arXiv id it downloads the paper's LaTeX source and its PDF, runs the same
parser the library was built with, and returns the same dossier shape the reader
already knows how to draw — cue phrases, stances, assumptions, and pixel anchors.

Nothing is approximated to make this fit in a request. It is the same code path,
measured at about a second and a half end to end for a paper the size of T5, which is
why it can be a request at all rather than a queue.

Two things are deliberately not done here. Citations are not resolved against the
library's own papers, so an on-demand paper does not join the lineage graph — that
needs every paper's full title in hand and is a build-time job. And nothing is written
to the library: the result is cached and served, not published.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.request
import zlib
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

#: arXiv's modern form, and its older one. Anything else is refused before a single
#: request leaves this function — an id is about to become a URL and a cache key.
NEW_STYLE = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$")
OLD_STYLE = re.compile(r"^[a-z-]+(\.[A-Z]{2})?/\d{7}(v\d+)?$")

#: A cached dossier is worth keeping for a long time: the paper does not change, and
#: the expensive part is arXiv's patience rather than ours. Thirty days.
CACHE_TTL = 60 * 60 * 24 * 30

#: A source tarball larger than this is somebody's 200MB collection of figures, and
#: unpacking it inside a function with a 60-second budget ends one way.
MAX_SOURCE = 40 * 1024 * 1024
MAX_PDF = 40 * 1024 * 1024

AGENT = "keystone/0.1 (+https://github.com/Srikarmk/Keystone)"


def valid(arxiv_id: str) -> bool:
    return bool(NEW_STYLE.match(arxiv_id) or OLD_STYLE.match(arxiv_id))


def read_id(raw: str) -> str:
    """The id out of whatever the reader pasted — a bare id, or any arXiv URL."""
    text = (raw or "").strip()
    if not text:
        return ""
    # abs/, pdf/, with or without a version, with or without the scheme.
    found = re.search(
        r"arxiv\.org/(?:abs|pdf|format)/([a-zA-Z0-9./-]+?)(?:v\d+)?(?:\.pdf)?/?$", text
    )
    if found:
        text = found.group(1)
    text = re.sub(r"^arxiv:", "", text, flags=re.I).strip()
    # The version is dropped: the parser reads whatever arXiv serves as current, so
    # keying the cache on a version it did not honour would be a lie.
    text = re.sub(r"v\d+$", "", text)
    return text


# --------------------------------------------------------------------------------- #
# The cache. Redis over HTTP, spoken to with urllib — the same protocol and the same
# store the reading lists use, so there is one database to reason about and no client
# library to keep current.
# --------------------------------------------------------------------------------- #

ENDPOINT = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL")
TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN")


def redis(*words: object) -> object:
    if not ENDPOINT or not TOKEN:
        return None
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(list(words)).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return json.loads(response.read()).get("result")
    except Exception:  # noqa: BLE001
        # A cache that is down must not take the feature with it.
        return None


def key(arxiv_id: str) -> str:
    return f"keystone:ingest:{arxiv_id}"


def cached(arxiv_id: str) -> bytes | None:
    stored = redis("GET", key(arxiv_id))
    if not isinstance(stored, str):
        return None
    try:
        return zlib.decompress(base64.b64decode(stored))
    except Exception:  # noqa: BLE001
        return None


def remember(arxiv_id: str, payload: bytes) -> None:
    # Stored compressed. A dossier is around 650KB of JSON and about 55KB deflated,
    # which is the difference between fitting in a Redis value comfortably and
    # arguing with a size limit on every large paper.
    packed = base64.b64encode(zlib.compress(payload, 6)).decode()
    redis("SET", key(arxiv_id), packed, "EX", CACHE_TTL)


# --------------------------------------------------------------------------------- #
# The work itself.
# --------------------------------------------------------------------------------- #


def fetch(url: str, limit: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=45) as response:
        payload = response.read(limit + 1)
    if len(payload) > limit:
        raise ValueError("that paper's files are larger than this will download")
    return payload


def build(arxiv_id: str) -> dict:
    """Download, parse, anchor. The same call the command line makes."""
    from keystone import dossier as dossier_module
    from keystone.ingest import metadata as metadata_module
    from keystone.ingest.arxiv_source import SourceUnavailable, load_project
    from keystone.ingest.latex import document_title

    work = Path("/tmp/keystone")
    cache = work / "cache"
    pdfs = work / "pdf"
    cache.mkdir(parents=True, exist_ok=True)
    pdfs.mkdir(parents=True, exist_ok=True)

    # The PDF is fetched here rather than inside the parser because the parser takes
    # a path: the library's papers are downloaded once by the expand command and kept.
    # Without it the analysis still runs and every anchor comes back null, which is a
    # silent and very confusing way to lose the half of this that points at the page.
    pdf_path = pdfs / f"{arxiv_id.replace('/', '_')}.pdf"
    if not pdf_path.exists():
        payload = fetch(f"https://arxiv.org/pdf/{arxiv_id}", MAX_PDF)
        if payload[:4] != b"%PDF":
            raise SourceUnavailable("arXiv did not return a PDF for that id")
        pdf_path.write_bytes(payload)

    # The title, from the paper's own LaTeX. The library gets its display titles the
    # same way, and the command line can do better — it cross-checks against titles
    # printed beside the same arXiv id in *other* papers' bibliographies, which is
    # what catches a paper carrying a stale conference template. One paper on its own
    # has no such second opinion, so this is the best available and occasionally it
    # will be a template's title rather than the paper's.
    document, _ = load_project(arxiv_id, cache)
    title = " ".join(document_title(document.text).split())

    built = dossier_module.build(arxiv_id, cache, title=title, pdf_path=pdf_path)
    payload = built.to_dict()

    # Authors, category and date, so an on-demand paper reads like a library one
    # rather than an anonymous slab. A metadata request never downloads a paper, so
    # it is cheap and is not subject to the e-print rate limiting; when it fails the
    # dossier is served without it, which is what the reader already expects from
    # papers whose metadata did not resolve.
    try:
        record = metadata_module.fetch([arxiv_id]).get(arxiv_id.split("v")[0])
        payload["arxiv"] = record.to_dict() if record else None
    except Exception:  # noqa: BLE001
        payload["arxiv"] = None

    # Said out loud in the payload, because it changes what the page can promise: an
    # on-demand paper is analysed against itself, so its citations are not resolved
    # to other papers in the library and it has no inbound edges.
    payload["onDemand"] = True
    return payload


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802  (the runtime calls it)
        started = time.monotonic()
        params = parse_qs(urlparse(self.path).query)
        arxiv_id = read_id((params.get("id") or [""])[0])

        if not arxiv_id:
            return self.fail(400, "Paste an arXiv id or link — 1706.03762, say.")
        if not valid(arxiv_id):
            return self.fail(400, f"“{arxiv_id}” is not an arXiv id.")

        hit = cached(arxiv_id)
        if hit:
            return self.ok(hit, cache="hit", seconds=time.monotonic() - started)

        try:
            payload = json.dumps(build(arxiv_id)).encode()
        except Exception as exc:  # noqa: BLE001
            return self.explain(exc, arxiv_id)

        remember(arxiv_id, payload)
        return self.ok(payload, cache="miss", seconds=time.monotonic() - started)

    # ----------------------------------------------------------------------------- #

    def ok(self, payload: bytes, *, cache: str, seconds: float) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Keystone-Cache", cache)
        self.send_header("X-Keystone-Seconds", f"{seconds:.2f}")
        # Cached at the edge too. The analysis of a published paper does not change,
        # and this is the expensive request on the site by a wide margin.
        self.send_header("Cache-Control", "public, max-age=3600, s-maxage=86400")
        self.end_headers()
        self.wfile.write(payload)

    def fail(self, status: int, message: str, **extra: object) -> None:
        body = json.dumps({"error": message, **extra}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def explain(self, exc: Exception, arxiv_id: str) -> None:
        """
        Say which of the several things that can go wrong actually did.

        A paper with no LaTeX source is the common case — roughly one arXiv paper in
        ten — and it is not an error on anybody's part, so it gets its own message
        rather than a 500. Everything else is reported as a failure and logged with a
        traceback, because it is one.
        """
        name = type(exc).__name__
        if name == "SourceUnavailable":
            return self.fail(
                422,
                "arXiv has no LaTeX source for that paper, so there is nothing to "
                "read. About one paper in ten is posted as a PDF only.",
                reason="no-source",
                id=arxiv_id,
            )
        if isinstance(exc, urllib.error.HTTPError) and exc.code in (403, 429):
            return self.fail(
                429,
                "arXiv is rate-limiting this service at the moment. It usually clears "
                "within a minute or two.",
                reason="throttled",
                id=arxiv_id,
            )
        if isinstance(exc, (urllib.error.URLError, TimeoutError)):
            return self.fail(
                504, "arXiv did not answer in time.", reason="timeout", id=arxiv_id
            )
        if isinstance(exc, ValueError):
            return self.fail(413, str(exc), reason="too-large", id=arxiv_id)

        print(f"ingest {arxiv_id} failed: {exc!r}", file=sys.stderr)
        traceback.print_exc()
        return self.fail(
            500,
            "That paper could not be parsed. Malformed source and unusual document "
            "classes are normal in the wild; this one lost.",
            reason="failed",
            id=arxiv_id,
        )
