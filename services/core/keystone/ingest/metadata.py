"""What arXiv says a paper is about.

The library needed grouping, and the tempting way to get it is to read the titles and
sort them into buckets I invent. That would be a guess dressed as a fact, in a tool
whose whole argument is that it does not guess: "Computer Vision" would be my opinion
about a paper, sitting next to sentences quoted verbatim from the paper itself.

arXiv already assigns every submission a primary category, chosen by its authors and
visible on the abstract page. So the categories here are not derived at all — they are
fetched, cached, and shown with the same name arXiv uses. A paper whose metadata cannot
be fetched is left uncategorised rather than assigned a plausible one.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

_API = "http://export.arxiv.org/api/query"

#: arXiv asks for one request every three seconds. Ids are batched instead, so the
#: whole library is one request and the courtesy costs nothing.
_BATCH = 100
_PAUSE = 3.0

_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}

#: arXiv's own names for the categories this library reaches. Not abbreviated and not
#: renamed: the point of using their taxonomy is that a reader can check it against the
#: abstract page. An unknown code falls back to the code itself, which is honest and
#: also visibly a gap to fill.
CATEGORY_NAMES: dict[str, str] = {
    "cs.CL": "Computation and Language",
    "cs.CV": "Computer Vision",
    "cs.LG": "Machine Learning",
    "cs.AI": "Artificial Intelligence",
    "cs.NE": "Neural and Evolutionary Computing",
    "cs.IR": "Information Retrieval",
    "cs.RO": "Robotics",
    "cs.SD": "Sound",
    "cs.CY": "Computers and Society",
    "cs.SI": "Social and Information Networks",
    "cs.DS": "Data Structures and Algorithms",
    "cs.DC": "Distributed and Cluster Computing",
    "cs.HC": "Human-Computer Interaction",
    "cs.SC": "Symbolic Computation",
    "cs.MA": "Multiagent Systems",
    "cs.GT": "Computer Science and Game Theory",
    "cs.LO": "Logic in Computer Science",
    "cs.CC": "Computational Complexity",
    "cs.DB": "Databases",
    "cs.SE": "Software Engineering",
    "cs.PL": "Programming Languages",
    "cs.MM": "Multimedia",
    "cs.GR": "Graphics",
    "stat.ML": "Machine Learning (Statistics)",
    "stat.AP": "Applications",
    "stat.CO": "Computation",
    "eess.SP": "Signal Processing",
    "math.ST": "Statistics Theory",
    "math.NA": "Numerical Analysis",
    "q-bio.NC": "Neurons and Cognition",
    "q-bio.QM": "Quantitative Methods",
    "stat.ME": "Methodology",
    "eess.AS": "Audio and Speech Processing",
    "eess.IV": "Image and Video Processing",
    "math.OC": "Optimization and Control",
}


def category_name(code: str) -> str:
    return CATEGORY_NAMES.get(code, code)


@dataclass(frozen=True, slots=True)
class Metadata:
    """The parts of arXiv's record this project shows."""

    arxiv_id: str
    primary: str
    """Primary category code, e.g. "cs.CL". Empty when arXiv did not answer."""
    categories: tuple[str, ...]
    """Every category, primary first. A paper is usually cross-listed."""
    published: str
    """ISO date of version 1, so the library can be read in order."""
    authors: tuple[str, ...] = ()
    """Who wrote it, in the order arXiv lists them.

    From the same request the category came from, and previously thrown away — which
    left a reader unable to answer "whose paper is this?" anywhere in the interface.
    """

    def to_dict(self) -> dict:
        return {
            "primary": self.primary,
            "primaryName": category_name(self.primary),
            "categories": list(self.categories),
            "published": self.published,
            "authors": list(self.authors),
        }


def _strip_version(arxiv_id: str) -> str:
    return arxiv_id.split("v")[0] if "v" in arxiv_id.split("/")[-1] else arxiv_id


def _parse(xml: str) -> dict[str, Metadata]:
    out: dict[str, Metadata] = {}
    root = ET.fromstring(xml)
    for entry in root.findall("atom:entry", _NS):
        raw = (entry.findtext("atom:id", "", _NS) or "").rsplit("/", 1)[-1]
        ident = _strip_version(raw)
        if not ident:
            continue
        primary_node = entry.find("arxiv:primary_category", _NS)
        primary = (primary_node.get("term") if primary_node is not None else "") or ""
        others = [
            term
            for node in entry.findall("atom:category", _NS)
            if (term := node.get("term")) and term != primary
        ]
        out[ident] = Metadata(
            arxiv_id=ident,
            primary=primary,
            categories=tuple([primary, *others]) if primary else tuple(others),
            published=(entry.findtext("atom:published", "", _NS) or "")[:10],
            authors=tuple(
                name.strip()
                for node in entry.findall("atom:author", _NS)
                if (name := node.findtext("atom:name", "", _NS) or "").strip()
            ),
        )
    return out


def fetch(ids: list[str], *, timeout: float = 30.0) -> dict[str, Metadata]:
    """arXiv's record for each id. Ids it does not answer for are simply absent.

    Metadata only — this never downloads a paper, so it is cheap and unaffected by the
    e-print rate limiting that makes ingestion slow.
    """
    found: dict[str, Metadata] = {}
    wanted = [_strip_version(i) for i in ids if i]
    for start in range(0, len(wanted), _BATCH):
        chunk = wanted[start : start + _BATCH]
        url = f"{_API}?id_list={','.join(chunk)}&max_results={len(chunk)}"
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                found.update(_parse(response.read().decode("utf-8", "replace")))
        except (urllib.error.URLError, ET.ParseError, TimeoutError):
            # A missing category is a gap in the display, not a failed build. The
            # caller leaves those papers uncategorised.
            continue
        if start + _BATCH < len(wanted):
            time.sleep(_PAUSE)
    return found


def load_cache(path: Path) -> dict[str, Metadata]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    out: dict[str, Metadata] = {}
    for ident, record in (raw or {}).items():
        if not isinstance(record, dict):
            continue
        out[ident] = Metadata(
            arxiv_id=ident,
            primary=str(record.get("primary", "")),
            categories=tuple(record.get("categories", []) or []),
            published=str(record.get("published", "")),
            authors=tuple(record.get("authors", []) or []),
        )
    return out


def save_cache(path: Path, records: dict[str, Metadata]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                ident: {
                    "primary": record.primary,
                    "categories": list(record.categories),
                    "published": record.published,
                    "authors": list(record.authors),
                }
                for ident, record in sorted(records.items())
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def resolve(ids: list[str], cache_path: Path) -> dict[str, Metadata]:
    """Cached metadata for every id, fetching only the ones not seen before."""
    cached = load_cache(cache_path)
    missing = [i for i in (_strip_version(x) for x in ids) if i and i not in cached]
    if missing:
        cached.update(fetch(missing))
        save_cache(cache_path, cached)
    return cached
