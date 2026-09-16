"""Segmenting LaTeX source into typed sections.

Where a number appears decides what it means. A figure in the abstract is what the
paper is *asserting*; the same figure inside a results table is where it is
*evidenced*. Tracing the first back to the second is the whole of the coverage map, so
the section a sentence sits in has to be known before anything else can be said.
"""

from __future__ import annotations

import re

from keystone.graph.models import Section, SectionKind
from keystone.ingest.latex import (
    anchorable_sentences,
    document_body,
    expand_macros,
    strip_comments,
    strip_markup,
    user_macros,
)

_SECTION = re.compile(
    r"\\(?P<level>sub)*section\*?\s*(?:\[[^\]]*\])?\s*\{", re.IGNORECASE
)
_ABSTRACT = re.compile(
    r"\\begin\s*\{abstract\}(?P<body>[\s\S]*?)\\end\s*\{abstract\}", re.IGNORECASE
)
_APPENDIX = re.compile(r"\\appendix\b")

# Everything from here on is the reference list. Left attached, it becomes part of
# whatever section came last — usually the conclusion — and every arXiv identifier in
# it reads as a number the conclusion is asserting.
_BIBLIOGRAPHY = re.compile(
    r"\\bibliography\s*\{|\\begin\s*\{thebibliography\}|\\printbibliography"
    r"|\\bibliographystyle\s*\{"
)

# Matched against the section title, most specific first. "Related work" has to be
# tested before "work", and "experimental setup" before "results", or a title matches
# the wrong kind and its numbers are read as claims rather than as evidence.
_TITLE_KINDS: tuple[tuple[re.Pattern[str], SectionKind], ...] = (
    (re.compile(r"related\s+work|prior\s+work|background|literature", re.I), SectionKind.RELATED),
    (re.compile(r"limitation|broader\s+impact|ethic|societal", re.I), SectionKind.LIMITATIONS),
    (re.compile(r"conclusion|concluding|summary\b|future\s+work", re.I), SectionKind.CONCLUSION),
    (re.compile(r"discussion", re.I), SectionKind.DISCUSSION),
    (re.compile(r"introduction", re.I), SectionKind.INTRODUCTION),
    (re.compile(r"experiment|evaluation|setup|implementation\s+detail", re.I), SectionKind.EXPERIMENTS),
    (re.compile(r"result|analysis|ablation|comparison", re.I), SectionKind.RESULTS),
    (re.compile(r"method|approach|model|architecture|framework|algorithm|our\s+", re.I), SectionKind.METHOD),
    (re.compile(r"appendix", re.I), SectionKind.APPENDIX),
)


def classify(title: str) -> SectionKind:
    for pattern, kind in _TITLE_KINDS:
        if pattern.search(title):
            return kind
    return SectionKind.OTHER


def extract_sections(latex: str) -> tuple[Section, ...]:
    """Split a paper into typed sections, abstract first."""
    source = strip_comments(latex)
    body = expand_macros(document_body(source), user_macros(source))
    if (bibliography := _BIBLIOGRAPHY.search(body)) is not None:
        body = body[: bibliography.start()]

    sections: list[Section] = []

    if (abstract := _ABSTRACT.search(body)) is not None:
        sections.append(
            Section(
                kind=SectionKind.ABSTRACT,
                title="Abstract",
                text=strip_markup(abstract.group("body")),
                source=abstract.group("body"),
            )
        )

    appendix_at = match.start() if (match := _APPENDIX.search(body)) else len(body)

    headings = list(_SECTION.finditer(body))
    for index, heading in enumerate(headings):
        title_span = _read_braces(body, heading.end() - 1)
        if title_span is None:
            continue
        title, title_end = title_span
        end = headings[index + 1].start() if index + 1 < len(headings) else len(body)

        plain_title = strip_markup(title).strip()
        kind = SectionKind.APPENDIX if heading.start() >= appendix_at else classify(plain_title)
        # Subsections inherit rather than being classified on their own: a subsection
        # called "Results" inside "Experimental Setup" is still setup.
        if heading.group("level") and sections:
            kind = sections[-1].kind

        sections.append(
            Section(
                kind=kind,
                title=plain_title,
                text=strip_markup(body[title_end:end]),
                source=body[title_end:end],
            )
        )

    return tuple(sections)


def sentences_in(latex: str, section: Section) -> list[str]:
    """Anchorable sentences belonging to one section."""
    return anchorable_sentences(section.text)


def _read_braces(text: str, open_index: int) -> tuple[str, int] | None:
    if open_index >= len(text) or text[open_index] != "{":
        return None
    depth = 0
    for i in range(open_index, len(text)):
        if text[i] == "{" and (i == 0 or text[i - 1] != "\\"):
            depth += 1
        elif text[i] == "}" and text[i - 1] != "\\":
            depth -= 1
            if depth == 0:
                return text[open_index + 1 : i], i + 1
    return None
