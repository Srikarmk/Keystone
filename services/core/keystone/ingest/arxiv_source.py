"""Fetching and unpacking arXiv e-print source.

``arxiv.org/e-print/{id}`` serves the submission's actual LaTeX. Three shapes turn up
in practice and all three are handled: a gzipped tar of a multi-file project, a single
gzipped ``.tex``, and a PDF-only submission with no source at all. The last is not an
error — it just means this paper falls back to the PDF-only path.

Fetches are cached on disk. Beyond politeness to arXiv, it keeps the ingest pipeline
reproducible: re-running an audit should not depend on the network.
"""

from __future__ import annotations

import gzip
import http.client
import io
import re
import shutil
import tarfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .latex import TexDocument, expand_inputs

EPRINT_URL = "https://arxiv.org/e-print/{arxiv_id}"

# arXiv asks that automated clients identify themselves.
USER_AGENT = "keystone/0.1 (research paper audit; +https://github.com/keystone)"

#: Statuses worth asking again about. 406 is arXiv's answer when a client is asking
#: too often; 429 and the 5xx range are the ordinary transient set.
RETRY_CODES = frozenset({406, 408, 429, 500, 502, 503, 504})
RETRIES = 4
BACKOFF = 4.0

# Guards against a decompression bomb in an untrusted archive.
MAX_UNPACKED_BYTES = 256 * 1024 * 1024
MAX_MEMBERS = 2000

_ARXIV_ID = re.compile(r"(?:arxiv\.org/(?:abs|pdf|e-print)/)?(?P<id>\d{4}\.\d{4,5}(?:v\d+)?"
                       r"|[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)", re.IGNORECASE)


class SourceUnavailable(Exception):
    """The submission has no LaTeX source — a PDF-only upload."""


@dataclass(frozen=True, slots=True)
class TexProject:
    """An unpacked LaTeX project."""

    root: Path
    main: Path

    def read(self, name: str) -> str | None:
        """Resolve a LaTeX ``\\input`` path to file contents, if it exists."""
        candidates = [name, f"{name}.tex"] if not name.endswith(".tex") else [name]
        for candidate in candidates:
            path = (self.root / candidate).resolve()
            # Reject paths escaping the project root, whether by traversal or symlink.
            if not path.is_relative_to(self.root.resolve()) or not path.is_file():
                continue
            return path.read_text(encoding="utf-8", errors="replace")
        return None

    def document(self) -> TexDocument:
        """Parse the project into a single document with inputs expanded."""
        main_text = self.main.read_text(encoding="utf-8", errors="replace")
        return TexDocument.parse(expand_inputs(main_text, self.read))


def normalize_id(value: str) -> str:
    """Accept a bare id, an abs/pdf URL, or an id with a version suffix."""
    match = _ARXIV_ID.search(value.strip())
    if match is None:
        raise ValueError(f"not an arXiv identifier: {value!r}")
    return match.group("id")


def fetch(arxiv_id: str, cache_dir: Path, *, timeout: float = 60.0) -> Path:
    """Download an e-print archive, or return the cached copy."""
    ident = normalize_id(arxiv_id)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / f"{ident.replace('/', '_')}.eprint"
    if cached.exists() and cached.stat().st_size > 0:
        return cached

    request = urllib.request.Request(
        EPRINT_URL.format(arxiv_id=ident),
        # /e-print/ now redirects to /src/, which content-negotiates. urllib sends no
        # Accept header of its own, so say so explicitly rather than depending on the
        # server's default for a missing one.
        headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
    )

    # Retried with backoff. Two distinct failures make a single attempt unreliable for
    # bulk ingestion, and both are transient:
    #
    #   * truncated reads on multi-megabyte tarballs over a long-lived connection,
    #   * HTTP 406 from arXiv when a client asks too often. Read literally that is
    #     "this paper has no acceptable representation", which is wrong and permanent —
    #     the same request succeeds moments later. Treating it as fatal cost 16 of 46
    #     papers on the first expansion run.
    #
    # A partial body must never be cached as if it were the paper, so nothing is
    # written until a whole response is in hand.
    payload: bytes | None = None
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
            break
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404):
                raise SourceUnavailable(
                    f"no e-print source for {ident} (HTTP {exc.code})"
                ) from exc
            if exc.code not in RETRY_CODES:
                raise
            last = exc
        except (http.client.HTTPException, urllib.error.URLError, TimeoutError) as exc:
            last = exc
        if attempt < RETRIES - 1:
            time.sleep(BACKOFF * (attempt + 1))

    if payload is None:
        raise SourceUnavailable(
            f"could not download the e-print for {ident}"
            + (f" ({last})" if last else "")
        )

    if payload[:4] == b"%PDF":
        raise SourceUnavailable(f"{ident} is a PDF-only submission")

    # Write via a temporary name so an interrupted download never becomes a cache hit.
    staging = cached.with_suffix(".partial")
    staging.write_bytes(payload)
    staging.replace(cached)
    return cached


def unpack(archive: Path, dest: Path) -> TexProject:
    """Extract an e-print into ``dest`` and identify its main LaTeX file."""
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    raw = archive.read_bytes()
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:*") as tar:
            _safe_extract(tar, dest)
    except tarfile.ReadError:
        # Not a tar: a single-file submission is served as a bare gzipped .tex.
        try:
            text = gzip.decompress(raw)
        except (OSError, EOFError) as exc:
            raise SourceUnavailable(f"{archive.name} is neither tar nor gzip") from exc
        (dest / "main.tex").write_bytes(text)

    main = _find_main(dest)
    if main is None:
        raise SourceUnavailable(f"no LaTeX main file found in {archive.name}")
    return TexProject(root=dest, main=main)


def _safe_extract(tar: tarfile.TarFile, dest: Path) -> None:
    """Extract only regular files, inside the destination, within size limits."""
    root = dest.resolve()
    budget = MAX_UNPACKED_BYTES

    for index, member in enumerate(tar):
        if index >= MAX_MEMBERS:
            break
        if not member.isfile():
            continue  # skip links and devices outright rather than resolving them
        target = (dest / member.name).resolve()
        if not target.is_relative_to(root):
            continue  # path traversal
        budget -= member.size
        if budget < 0:
            raise SourceUnavailable("e-print archive exceeds the unpacked size limit")
        target.parent.mkdir(parents=True, exist_ok=True)
        extracted = tar.extractfile(member)
        if extracted is not None:
            target.write_bytes(extracted.read())


def _find_main(root: Path) -> Path | None:
    """Pick the main LaTeX file.

    A project's main file is the one that declares the document. Where several files
    do, the one not pulled in by another wins — some submissions ship a wrapper per
    journal template alongside the real manuscript.
    """
    tex_files = sorted(root.rglob("*.tex"))
    if not tex_files:
        return None

    contents = {
        path: path.read_text(encoding="utf-8", errors="replace") for path in tex_files
    }
    candidates = [
        path for path, text in contents.items()
        if "\\documentclass" in text and "\\begin{document}" in text
    ] or [path for path, text in contents.items() if "\\begin{document}" in text]

    if not candidates:
        return max(tex_files, key=lambda p: p.stat().st_size)
    if len(candidates) == 1:
        return candidates[0]

    included: set[str] = set()
    for text in contents.values():
        included.update(re.findall(r"\\(?:input|include)\s*\{([^}]+)\}", text))
    stems = {Path(name).stem for name in included}

    unincluded = [p for p in candidates if p.stem not in stems]
    pool = unincluded or candidates
    return max(pool, key=lambda p: p.stat().st_size)


# A real manuscript has thousands of characters of prose. Anything at this scale is a
# wrapper, not a source tree.
MIN_PROSE_CHARS = 1500


def load_project(arxiv_id: str, cache_dir: Path) -> tuple[TexDocument, TexProject]:
    """Parse a paper and keep its unpacked project.

    The project is needed as well as the document because the bibliography usually
    lives in a separate ``.bbl`` file rather than in the LaTeX itself.
    """
    document = load(arxiv_id, cache_dir)
    ident = normalize_id(arxiv_id)
    project = unpack(
        fetch(ident, cache_dir / "eprints"),
        cache_dir / "unpacked" / ident.replace("/", "_"),
    )
    return document, project


def load(arxiv_id: str, cache_dir: Path) -> TexDocument:
    """Fetch, unpack and parse an arXiv paper's LaTeX source.

    Raises :class:`SourceUnavailable` when the submission has no usable source, which
    includes the wrapper case: a few lines of LaTeX that ``\\includepdf`` a
    pre-compiled PDF. Failing loudly matters here. Returning an empty document would
    tell the audit engine the paper has no equations and no tables, which is a false
    statement about the paper rather than an absence of information about it.
    """
    ident = normalize_id(arxiv_id)
    archive = fetch(ident, cache_dir / "eprints")
    project = unpack(archive, cache_dir / "unpacked" / ident.replace("/", "_"))

    main_text = project.main.read_text(encoding="utf-8", errors="replace")
    if "\\includepdf" in main_text:
        raise SourceUnavailable(
            f"{ident} wraps a pre-compiled PDF (\\includepdf); no LaTeX source"
        )

    document = project.document()
    if document.prose_chars < MIN_PROSE_CHARS:
        raise SourceUnavailable(
            f"{ident} yielded only {document.prose_chars} chars of prose; "
            "treating as source-unavailable"
        )
    return document
