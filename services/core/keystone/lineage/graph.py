"""The paper in relation to the papers around it.

A stance is only half an edge. "This paper inherits from ``vaswani2017``" is a fact
about a citation key; what a reader wants is *Attention Is All You Need*, a link to it,
and the sentence in this paper's PDF where the inheritance is admitted. This joins the
three things that already exist — the stance classifier, the bibliography parser, and
the anchor layer — into one edge that can be drawn.

Two properties of an edge matter for how it reads:

* **Load-bearing.** Inheriting someone's method makes their correctness a precondition
  of yours; out-scoring them does not. So an inherited edge is a dependency and a
  contested one is a disagreement, and they are not the same shape.
* **In the corpus or not.** When the cited paper has been ingested too, the edge is
  traversable in both directions and the reader can follow it. When it has not, the
  edge still ends at a real reference with a real arXiv link, which is worth more than
  a citation key.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

from keystone.graph.models import Anchor, Section, SectionKind
from keystone.ingest.anchors import DocIndex
from keystone.ingest.bibliography import Reference
from keystone.lineage.stance import CitationContext, Stance, contexts, strongest


@dataclass(frozen=True, slots=True)
class Edge:
    """One thing this paper says about one other paper."""

    key: str
    stance: Stance
    cue: str
    sentence: str
    section: str
    section_kind: SectionKind
    ordinal: int

    title: str
    authors: str
    year: int | None
    arxiv_id: str | None
    in_corpus: bool
    """Whether the cited paper has been ingested, so the edge can be walked."""

    anchor: Anchor | None
    """Where this paper says it, in its own PDF. None when it could not be located."""

    @property
    def is_load_bearing(self) -> bool:
        return self.stance.is_load_bearing

    def to_dict(self, anchor_json) -> dict:
        return {
            "key": self.key,
            "stance": str(self.stance),
            "cue": self.cue,
            "sentence": self.sentence,
            "section": self.section,
            "sectionKind": str(self.section_kind),
            "ordinal": self.ordinal,
            "title": self.title,
            "authors": self.authors,
            "year": self.year,
            "arxivId": self.arxiv_id,
            "inCorpus": self.in_corpus,
            "anchor": anchor_json(self.anchor),
        }


@dataclass(frozen=True, slots=True)
class Lineage:
    """Everything this paper says about other papers, and what it takes on faith."""

    edges: tuple[Edge, ...]
    background: int
    """Citations with no stance written down. Counted, not listed."""

    @property
    def inherits(self) -> tuple[Edge, ...]:
        return tuple(e for e in self.edges if e.stance is Stance.INHERITS)

    @property
    def extends(self) -> tuple[Edge, ...]:
        return tuple(e for e in self.edges if e.stance is Stance.EXTENDS)

    @property
    def contests(self) -> tuple[Edge, ...]:
        return tuple(e for e in self.edges if e.stance is Stance.CONTESTS)

    @property
    def compares(self) -> tuple[Edge, ...]:
        return tuple(e for e in self.edges if e.stance is Stance.COMPARES)

    @property
    def foundation(self) -> Edge | None:
        """The single work this paper leans on hardest.

        The keystone, in the sense the name was always reaching for: not a table of
        numbers but the piece of other people's work that this paper would not stand
        without. Chosen by where the dependency is admitted — a method section states
        a design decision, a related-work section states positioning.
        """
        weight = {
            SectionKind.METHOD: 0,
            SectionKind.ABSTRACT: 1,
            SectionKind.INTRODUCTION: 2,
            SectionKind.EXPERIMENTS: 3,
            SectionKind.RESULTS: 4,
        }
        candidates = [e for e in self.edges if e.is_load_bearing]
        if not candidates:
            return None
        return min(
            candidates,
            key=lambda e: (
                weight.get(e.section_kind, 9),
                0 if e.stance is Stance.INHERITS else 1,
                0 if e.in_corpus else 1,
                0 if e.anchor else 1,
                # Order of first mention, last. Without it the Transformer's four
                # equally load-bearing method-section adoptions tied on every test
                # above and the headline fell to alphabetical order of citation key.
                e.ordinal,
            ),
        )

    def tally(self) -> dict[str, int]:
        counts = Counter(e.stance for e in self.edges)
        return {
            "inherits": counts[Stance.INHERITS],
            "extends": counts[Stance.EXTENDS],
            "contests": counts[Stance.CONTESTS],
            "compares": counts[Stance.COMPARES],
            "background": self.background,
            "traversable": sum(1 for e in self.edges if e.in_corpus),
        }


def fold(title: str) -> str:
    """A title reduced to what two bibliographies can be expected to agree on.

    Case, punctuation, accents and spacing all vary between styles; the words do not.
    This is an exact match on the folded form rather than a similarity score, so
    "Attention is all you need" and "Attention Is All You Need" are the same paper and
    nothing else ever is.
    """
    plain = unicodedata.normalize("NFKD", title)
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", plain.lower()).strip()


def build(
    latex: str,
    sections: tuple[Section, ...],
    references: list[Reference],
    index: DocIndex | None = None,
    corpus: frozenset[str] = frozenset(),
    corpus_titles: dict[str, str] | None = None,
) -> Lineage:
    """Resolve every stanced citation to a paper, and locate where it is said.

    ``corpus`` is the set of arXiv ids already ingested and ``corpus_titles`` maps a
    folded title to an id. Both are needed: these papers cite each other's *conference*
    versions, so matching on arXiv identifiers alone found one traversable edge in the
    whole library where matching on titles as well finds the actual lineage.

    ``index`` is this paper's own PDF; without it the edges are still correct, they
    just cannot be pointed at.
    """
    by_key = {reference.key: reference for reference in references}
    titles = {fold(t): i for i, t in (corpus_titles or {}).items() if fold(t)}
    best = strongest(contexts(latex, sections))

    edges: list[Edge] = []
    background = 0
    located: dict[str, Anchor | None] = {}

    for key, context in sorted(best.items()):
        if context.stance is Stance.BACKGROUND:
            background += 1
            continue

        reference = by_key.get(key)
        # Anchoring is per sentence, not per edge: one sentence often admits several
        # inheritances at once ("a residual connection followed by layer
        # normalization"), and locating it repeatedly is wasted work on the slowest
        # part of the pipeline.
        if index is not None and context.anchor_text and context.anchor_text not in located:
            located[context.anchor_text] = index.locate(context.anchor_text).anchor

        # The arXiv id on the reference when there is one; otherwise the id of the
        # corpus paper whose title the reference names.
        resolved = reference.arxiv_id if reference else None
        if resolved is None and reference is not None:
            resolved = titles.get(fold(_title(reference)))

        edges.append(
            Edge(
                key=key,
                stance=context.stance,
                cue=context.cue,
                sentence=context.sentence,
                section=context.section,
                section_kind=context.section_kind,
                ordinal=context.ordinal,
                title=_title(reference),
                authors=reference.authors if reference else "",
                year=reference.year if reference else None,
                arxiv_id=resolved,
                in_corpus=bool(resolved and resolved in corpus),
                anchor=located.get(context.anchor_text),
            )
        )

    return Lineage(edges=tuple(edges), background=background)


def _title(reference: Reference | None) -> str:
    """The cited work's title, or the best available stand-in.

    A citation key is not a title. Where the bibliography style did not separate the
    fields, the raw entry at least names authors and venue, which a reader can use.
    """
    if reference is None:
        return ""
    if reference.title:
        return reference.title
    return reference.raw[:90]


def cross_edges(
    lineages: dict[str, Lineage],
    titles: dict[str, str],
) -> list[dict]:
    """Edges that run between two papers in the library.

    These are the ones worth drawing as a graph, because both ends can be opened. On a
    corpus of nine foundational papers there are only a handful — ViT following the
    original Transformer, ResNet adopting batch normalisation — but a handful of
    *traversable* edges reads as a field, where a hundred dangling ones read as a
    bibliography.
    """
    out: list[dict] = []
    for source, lineage in lineages.items():
        for edge in lineage.edges:
            if not edge.in_corpus or edge.arxiv_id == source:
                continue
            out.append({
                "from": source,
                "fromTitle": titles.get(source, source),
                "to": edge.arxiv_id,
                "toTitle": titles.get(edge.arxiv_id or "", edge.title),
                "stance": str(edge.stance),
                "cue": edge.cue,
                "sentence": edge.sentence,
                "section": edge.section,
            })
    return out
