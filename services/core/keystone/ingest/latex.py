"""LaTeX source parsing — ground truth for equations, tables and citations.

For any arXiv paper the actual LaTeX source is available, and it carries facts that
cannot be recovered reliably from rendered glyphs:

* **equations** as real LaTeX rather than a vision model's reading of stacked glyphs
* **table numbers** as source text, so a numeric check compares against what the
  author wrote instead of against an interpretation of a rendered table
* **``\\cite`` keys** resolved to bibliography entries, giving exact claim-to-citation
  edges instead of inferred ones
* **``\\label``/``\\ref`` cross-references**, giving the real claim-to-evidence graph

This module is pure text processing so it can be tested without a network. Fetching
and unpacking live in :mod:`keystone.ingest.arxiv_source`.

The one thing source cannot do alone is say *where on the page* something is, which is
what makes a finding clickable. That is handled by anchoring source-derived text back
into the PDF — see :func:`anchorable_runs`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Environments whose body is mathematics rather than prose.
_MATH_ENVIRONMENTS = (
    "equation", "equation*", "align", "align*", "alignat", "alignat*",
    "gather", "gather*", "multline", "multline*", "eqnarray", "eqnarray*",
    "displaymath", "flalign", "flalign*", "split", "IEEEeqnarray",
)

_COMMENT = re.compile(r"(?<!\\)%.*?$", re.MULTILINE)
_INPUT = re.compile(r"\\(?:input|include)\s*\{([^}]+)\}")
_CITE = re.compile(r"\\(?:cite|citep|citet|citealp|citealt|citeyear|autocite)"
                   r"\s*(?:\[[^\]]*\])*\s*\{([^}]+)\}")
_LABEL = re.compile(r"\\label\s*\{([^}]+)\}")
_BIBITEM = re.compile(r"\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}")

_RULE = re.compile(
    r"\\(?:hline|toprule|midrule|bottomrule|specialrule\s*(?:\{[^}]*\}){0,3}"
    r"|cline\s*\{[^}]*\}|cmidrule(?:\s*\([^)]*\))?\s*(?:\[[^\]]*\])?\s*\{[^}]*\})"
)

# Macros whose braced argument is a filename, a length, or a definition — never prose.
# Without this their arguments survive macro stripping and land in the text as words.
_DISCARD_ARGS = re.compile(
    r"\\(?:documentclass|usepackage|includegraphics|bibliography|bibliographystyle"
    r"|newcommand|renewcommand|providecommand|def|newtheorem|DeclareMathOperator"
    r"|vspace|hspace|setlength|addtolength|graphicspath|pagestyle|thispagestyle"
    r"|geometry|hypersetup|definecolor|label|rule|raisebox|resizebox|scalebox)\*?\s*(?:\[[^\]]*\])*(?:\s*\{[^{}]*\})+"
)


def document_body(text: str) -> str:
    """The text between ``\\begin{document}`` and ``\\end{document}``.

    The preamble is full of macros whose arguments are not prose — package names,
    class options, command definitions — and scanning it puts words like "article"
    into the document's text. Returns the input unchanged when there is no
    ``document`` environment, so a fragment or an included file still parses.
    """
    start = re.search(r"\\begin\s*\{document\}", text)
    body = text[start.end() :] if start else text
    end = re.search(r"\\end\s*\{document\}", body)
    return body[: end.start()] if end else body


@dataclass(frozen=True, slots=True)
class Equation:
    """A display equation, exactly as the author wrote it."""

    latex: str
    environment: str
    labels: tuple[str, ...]
    ordinal: int  # position among the document's display equations, 0-based


@dataclass(frozen=True, slots=True)
class TableSource:
    """A tabular environment's cells, split but not interpreted."""

    rows: tuple[tuple[str, ...], ...]
    labels: tuple[str, ...]
    caption: str
    ordinal: int
    block_starts: tuple[int, ...] = ()
    """Row indices where a horizontal rule begins a new block.

    Results tables are usually banded — prior work, a rule, then the authors' own
    rows — and a "best result" marker applies within a band, not down the whole
    column. Discarding the rules loses that structure and makes the winning value of
    one band look like a middling value of the column.
    """


@dataclass(frozen=True, slots=True)
class SourceSentence:
    """One sentence of prose, with what the author says it rests on.

    The references matter as much as the text. A paper that writes "as shown in
    Table~\\ref{tab:main}, we reach 94.2%" has *told* us where the evidence is; guessing
    by searching every table for a matching number throws that away and can only ever
    be less precise. It also tells us when the evidence is something no numeric check
    can reach — a figure, a theorem, another paper — which is the difference between
    "unverifiable" and "unsupported".
    """

    text: str  # markup stripped, matchable against the PDF
    refs: tuple[str, ...]  # \ref / \eqref / \cref targets
    cites: tuple[str, ...]  # \cite keys


@dataclass(frozen=True, slots=True)
class Citation:
    """One ``\\cite`` site: which keys, and the prose immediately before it."""

    keys: tuple[str, ...]
    preceding_text: str
    offset: int


@dataclass
class TexDocument:
    """A LaTeX document with ``\\input`` expanded."""

    text: str
    equations: list[Equation] = field(default_factory=list)
    tables: list[TableSource] = field(default_factory=list)
    citations: list[Citation] = field(default_factory=list)
    bib_keys: list[str] = field(default_factory=list)
    macros: dict[str, str] = field(default_factory=dict)
    """The paper's own ``\\newcommand`` definitions, for rendering its notation."""

    @property
    def prose_chars(self) -> int:
        """Characters of matchable prose in the document body.

        Near zero means the "source" is not really source — most often a wrapper that
        ``\\includepdf``s a pre-compiled PDF, which arXiv accepts and which carries
        none of the equations, tables or citation keys this module exists to read.
        """
        return sum(len(run) for run in anchorable_runs(self.text))

    @classmethod
    def parse(cls, text: str) -> TexDocument:
        raw = strip_comments(text)
        # Definitions are stripped only for reading equations and tables: a macro whose
        # body contains an ``align`` block would otherwise be harvested as one of the
        # paper's equations, and the reader shown "\\newcommand{\\ee}{" as mathematics.
        #
        # Deliberately *not* used as the document's own text. Definition stripping has
        # to consume balanced arguments to work at all, so when it over-consumes it
        # destroys prose — and every other consumer (sections, sentences, labels) reads
        # ``text``. Keeping the blast radius to two callers is the difference between a
        # cosmetic bug and a paper losing all of its sections.
        body = strip_definitions(raw)
        return cls(
            text=raw,
            equations=extract_equations(body),
            # Tables read the raw text. Definition stripping exists for equations —
            # a macro body holding an ``align`` block gets harvested as one of the
            # paper's own — and it cost a table on two of nine papers when applied
            # here as well. Narrower is better: the guard inside extract_equations
            # catches parameter markers regardless.
            tables=extract_tables(raw),
            # Body only, with macros expanded: a preamble holds no citations, and a
            # claim reading "We propose , which improves on" has lost the very word
            # the citation is attached to. Equations and tables above are left
            # unexpanded on purpose — those must stay exactly as the author wrote them.
            citations=extract_citations(
                expand_macros(document_body(body), user_macros(raw))
            ),
            bib_keys=_BIBITEM.findall(raw),
            macros=all_macro_definitions(raw),
        )


def strip_comments(text: str) -> str:
    """Remove LaTeX comments, leaving escaped percent signs alone."""
    return _COMMENT.sub("", text)


def expand_inputs(
    main: str,
    read: "callable[[str], str | None]",
    *,
    max_depth: int = 12,
) -> str:
    """Inline ``\\input`` and ``\\include`` recursively.

    ``read`` resolves a LaTeX path to file contents, or returns None if missing —
    arXiv submissions routinely reference files that were never uploaded, and a
    missing input should leave a gap rather than abort the parse. Files already
    inlined are not expanded again, which also breaks any include cycle.
    """
    seen: set[str] = set()

    def walk(text: str, depth: int) -> str:
        if depth >= max_depth:
            return text

        def replace(match: re.Match[str]) -> str:
            name = match.group(1).strip()
            if name in seen:
                return ""
            seen.add(name)
            content = read(name)
            if content is None:
                return ""
            return walk(strip_comments(content), depth + 1)

        return _INPUT.sub(replace, text)

    return walk(strip_comments(main), 0)


def _match_brace_group(text: str, open_index: int) -> tuple[str, int] | None:
    """Read a balanced ``{...}`` group starting at ``open_index``; return (body, end)."""
    if open_index >= len(text) or text[open_index] != "{":
        return None
    depth = 0
    for i in range(open_index, len(text)):
        ch = text[i]
        if ch == "{" and (i == 0 or text[i - 1] != "\\"):
            depth += 1
        elif ch == "}" and text[i - 1] != "\\":
            depth -= 1
            if depth == 0:
                return text[open_index + 1 : i], i + 1
    return None


_MACRO_DEFINITION = re.compile(
    r"\\(?:newcommand|renewcommand|providecommand)\*?\s*\{?\\([a-zA-Z@]+)\}?\s*"
)


_DEFINITION_HEAD = re.compile(
    r"\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator|newtheorem"
    # \def and \newenvironment matter as much as \newcommand: a paper that wraps an
    # align block in either leaves the block behind, and it gets harvested as one of
    # the paper's equations.
    # The lookahead is load-bearing: without it "def" matches inside \definecolor,
    # \defaultfont and friends, and the argument reader then swallows the document
    # text that follows. It cost two tables and fourteen sections before it was added.
    r"|declaretheorem|def|newenvironment|renewenvironment|newcolumntype)"
    r"(?![a-zA-Z])\*?\s*"
)


def strip_definitions(text: str) -> str:
    """Remove macro and theorem definitions, arguments included.

    Brace-matched rather than pattern-matched: a definition body routinely contains
    nested braces (``\\newcommand{\\shape}[1]{\\mathbb{R}^{#1}}``), and a regex
    stopping at the first closing brace leaves the remainder behind as text.
    """
    out: list[str] = []
    cursor = 0
    while True:
        match = _DEFINITION_HEAD.search(text, cursor)
        if match is None:
            out.append(text[cursor:])
            return "".join(out)

        out.append(text[cursor : match.start()])
        pos = match.end()
        # The name, then any bracketed arity, then the body — each optional in
        # practice, since these macros are written in several equivalent styles.
        while pos < len(text):
            if text[pos] == "{":
                group = _match_brace_group(text, pos)
                if group is None:
                    break
                pos = group[1]
            elif text[pos] == "[":
                close = text.find("]", pos)
                if close == -1:
                    break
                pos = close + 1
            elif text[pos] == "\\":
                end = pos + 1
                while end < len(text) and (text[end].isalpha() or text[end] == "@"):
                    end += 1
                pos = end
            elif text[pos].isspace():
                pos += 1
            else:
                break
        cursor = pos


def user_macros(text: str) -> dict[str, str]:
    """Collect argument-less ``\\newcommand`` definitions.

    Papers define shorthands — ``\\ie``, ``\\etal``, a method name — and use them
    throughout the prose. Stripping the macro without expanding it leaves a hole where
    the PDF shows text, and every run containing one then fails to match. Macros that
    take arguments are skipped: expanding those correctly means implementing TeX.
    """
    macros: dict[str, str] = {}
    for match in _MACRO_DEFINITION.finditer(text):
        cursor = match.end()
        if cursor < len(text) and text[cursor] == "[":
            continue  # takes arguments
        group = _match_brace_group(text, cursor)
        if group is None:
            continue
        body, _end = group
        if "#" in body:
            continue
        macros[match.group(1)] = body
    return macros


def all_macro_definitions(text: str) -> dict[str, str]:
    """Every ``\\newcommand`` body, keyed by macro name, arguments and all.

    Distinct from :func:`user_macros`, which keeps only the argument-less ones because
    it substitutes them itself. This one is for handing to a renderer that understands
    ``#1`` — a paper's equations are written in the paper's own notation, and without
    its definitions half of them render as error text rather than mathematics.
    """
    macros: dict[str, str] = {}
    for match in _MACRO_DEFINITION.finditer(strip_comments(text)):
        cursor = match.end()
        if cursor < len(text) and text[cursor] == "[":
            close = text.find("]", cursor)
            if close == -1:
                continue
            cursor = close + 1
        group = _match_brace_group(text, cursor)
        if group is None:
            continue
        macros[f"\\{match.group(1)}"] = group[0]
    return macros


def expand_macros(text: str, macros: dict[str, str], *, max_passes: int = 4) -> str:
    """Substitute argument-less user macros, including nested definitions."""
    if not macros:
        return text
    # Longest name first, so \etalx is not eaten by \etal.
    pattern = re.compile(
        r"\\(" + "|".join(sorted(map(re.escape, macros), key=len, reverse=True)) + r")"
        r"(\s*\{\}|\b|(?=[^a-zA-Z]))"
    )
    for _ in range(max_passes):
        expanded = pattern.sub(lambda m: macros[m.group(1)], text)
        if expanded == text:
            break
        text = expanded
    return text


def _environment_spans(text: str, names: tuple[str, ...]) -> list[tuple[str, int, int, str]]:
    """Find (name, start, end, body) for each occurrence of the given environments.

    Nesting is tracked per environment name, so an ``align`` inside an ``align`` — or
    the ``split`` that commonly sits inside ``equation`` — closes at the right place.
    """
    found: list[tuple[str, int, int, str]] = []
    for name in names:
        escaped = re.escape(name)
        opener = re.compile(rf"\\begin\s*\{{{escaped}\}}")
        closer = re.compile(rf"\\end\s*\{{{escaped}\}}")
        for match in opener.finditer(text):
            depth, pos = 1, match.end()
            while depth and pos < len(text):
                nxt_open = opener.search(text, pos)
                nxt_close = closer.search(text, pos)
                if nxt_close is None:
                    break
                if nxt_open is not None and nxt_open.start() < nxt_close.start():
                    depth += 1
                    pos = nxt_open.end()
                else:
                    depth -= 1
                    pos = nxt_close.end()
                    if depth == 0:
                        found.append((name, match.start(), pos, text[match.end():nxt_close.start()]))
    found.sort(key=lambda item: item[1])
    return found


def extract_equations(text: str) -> list[Equation]:
    """Display equations in document order, with their labels."""
    out: list[Equation] = []
    for name, _start, _end, body in _environment_spans(text, _MATH_ENVIRONMENTS):
        # A `split` or `aligned` nested inside `equation` is part of that equation,
        # not a separate one; the outer environment already captured its body.
        if out and body.strip() and body.strip() in out[-1].latex:
            continue
        latex = _LABEL.sub("", body).strip()
        # A parameter marker only exists inside a definition, so its presence means
        # this body is a macro's, not the document's.
        if "#" in latex or len(latex) < 3:
            continue
        out.append(
            Equation(
                latex=latex,
                environment=name,
                labels=tuple(_LABEL.findall(body)),
                ordinal=len(out),
            )
        )
    return out


def extract_tables(text: str) -> list[TableSource]:
    """Tabular bodies split into rows and cells, plus the enclosing caption."""
    out: list[TableSource] = []
    # Captions belong to the enclosing float, and a tabular's caption may sit either
    # above or below it. Scanning a window around the tabular and taking the first
    # caption found picks up the *previous* table's caption whenever two floats are
    # close together, silently attributing the wrong text to the wrong table.
    floats = _environment_spans(text, ("table", "table*", "sidewaystable"))

    for _name, start, end, raw_body in _environment_spans(text, ("tabular", "tabularx", "tabu")):
        enclosing = _innermost_enclosing(floats, start, end)
        body = _strip_tabular_preamble(raw_body)
        rows: list[tuple[str, ...]] = []
        block_starts: list[int] = []
        pending_rule = False

        for raw_row in re.split(r"\\\\", body):
            has_rule = bool(_RULE.search(raw_row))
            cleaned = _RULE.sub("", raw_row).strip()
            if not cleaned:
                # A rule on its own line separates the rows on either side of it.
                pending_rule = pending_rule or has_rule
                continue
            if (has_rule or pending_rule) and rows:
                block_starts.append(len(rows))
            pending_rule = False
            cells = tuple(cell.strip() for cell in cleaned.split("&"))
            rows.append(cells)

        # Caption and label live on the enclosing float, not on the tabular itself.
        window = (
            text[enclosing[0] : enclosing[1]] if enclosing is not None
            else text[max(0, start - 1500) : min(len(text), end + 1500)]
        )
        caption = _extract_caption(window)
        out.append(
            TableSource(
                rows=tuple(rows),
                labels=tuple(_LABEL.findall(window)),
                caption=caption,
                ordinal=len(out),
                block_starts=tuple(block_starts),
            )
        )
    return out


# Column specifications: alignment letters, sizing, rules, and inter-column material.
_COLUMN_SPEC = re.compile(r"^[lcrpmbXYSsCRLwW|@!<>{}()\[\]\s.\d\\a-zA-Z*+-]*$")


def _strip_tabular_preamble(body: str) -> str:
    """Drop a tabular's positioning and column-spec arguments.

    ``\begin{tabular}{lcc}`` leaves ``{lcc}`` at the head of the body, and
    ``tabularx`` adds a width argument before it. Left in place, the spec would be
    parsed as the first cell of the first row and every column would shift by one.
    """
    text = body.lstrip()
    if text.startswith("["):
        depth = 0
        for i, ch in enumerate(text):
            depth += ch == "["
            depth -= ch == "]"
            if depth == 0:
                text = text[i + 1 :].lstrip()
                break

    # Consume leading brace groups for as long as they look like specification rather
    # than content, so a table whose first cell is a braced word survives.
    while text.startswith("{"):
        depth, close = 0, None
        for i, ch in enumerate(text):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    close = i
                    break
        if close is None:
            break
        group = text[1:close]
        if not _COLUMN_SPEC.match(group) or "&" in group:
            break
        text = text[close + 1 :].lstrip()
    return text


def _innermost_enclosing(
    spans: list[tuple[str, int, int, str]], start: int, end: int
) -> tuple[int, int] | None:
    """The tightest environment containing [start, end), if any."""
    containing = [(s, e) for _n, s, e, _b in spans if s <= start and e >= end]
    return min(containing, key=lambda span: span[1] - span[0]) if containing else None


def _extract_caption(window: str) -> str:
    """Pull a ``\\caption{...}`` body out, matching braces rather than the first one."""
    match = re.search(r"\\caption\s*(?:\[[^\]]*\])?\s*\{", window)
    if match is None:
        return ""
    depth, start = 1, match.end()
    for i in range(start, len(window)):
        if window[i] == "{" and window[i - 1] != "\\":
            depth += 1
        elif window[i] == "}" and window[i - 1] != "\\":
            depth -= 1
            if depth == 0:
                return strip_markup(window[start:i]).strip()
    return ""


def extract_citations(text: str) -> list[Citation]:
    """Every citation site, with the prose that precedes it.

    The preceding text is what turns a citation into an edge worth checking: it is the
    claim the citation is being used to support.
    """
    out: list[Citation] = []
    for match in _CITE.finditer(text):
        keys = tuple(k.strip() for k in match.group(1).split(",") if k.strip())
        before = strip_markup(text[max(0, match.start() - 400) : match.start()])
        out.append(
            Citation(keys=keys, preceding_text=before.strip(), offset=match.start())
        )
    return out


# Markup that renders as something the PDF text cannot be matched against: a citation
# becomes "(Author, 2017)", a reference becomes "3.1", maths becomes glyphs. Text is
# split at these points rather than through them.
_REF = re.compile(r"\\(?:ref|eqref|autoref|cref|Cref|vref)\s*\{([^}]+)\}")

# Environments whose \label names a piece of evidence of a particular kind.
_LABEL_SCOPES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("table", ("table", "table*", "sidewaystable", "tabular", "tabularx")),
    ("figure", ("figure", "figure*", "wrapfigure", "subfigure")),
    ("equation", _MATH_ENVIRONMENTS),
    ("theorem", ("theorem", "lemma", "corollary", "proposition", "definition",
                 "conjecture", "claim", "assumption", "remark")),
    ("algorithm", ("algorithm", "algorithm*", "algorithmic")),
)


def label_kinds(latex: str) -> dict[str, str]:
    """Map each ``\\label`` to the kind of thing it names.

    Resolved by which environment encloses the label, so a reference in the prose can
    be classified without guessing from the label's own text — plenty of papers write
    ``\\label{main}`` for a table and ``\\label{tab:x}`` for a figure.
    """
    text = strip_comments(latex)
    kinds: dict[str, str] = {}

    for kind, environments in _LABEL_SCOPES:
        for _name, start, end, _body in _environment_spans(text, environments):
            for match in _LABEL.finditer(text, start, end):
                kinds.setdefault(match.group(1).strip(), kind)

    # Anything left is a section or an unscoped label; the distinction does not matter
    # downstream, only that it is not evidence of the kinds above.
    for match in _LABEL.finditer(text):
        kinds.setdefault(match.group(1).strip(), "section")
    return kinds


def source_sentences(latex: str, *, min_chars: int = 24) -> list[SourceSentence]:
    """Sentences of body prose, each carrying its own references and citations.

    Split on the *marked-up* text rather than on the stripped output, so that a
    reference can be attributed to the sentence it actually appears in.
    """
    source = strip_comments(latex)
    body = expand_macros(document_body(source), user_macros(source))
    body = blank_environments(body, _OPAQUE_ENVIRONMENTS)

    out: list[SourceSentence] = []
    for block in re.split(r"\n\s*\n", body):
        for raw in split_sentences(block):
            text = strip_markup(raw)
            if len(text) < min_chars:
                continue
            out.append(
                SourceSentence(
                    text=text,
                    refs=tuple(dict.fromkeys(r.strip() for r in _REF.findall(raw))),
                    cites=tuple(
                        dict.fromkeys(
                            key.strip()
                            for group in _CITE.findall(raw)
                            for key in group.split(",")
                            if key.strip()
                        )
                    ),
                )
            )
    return out


_UNRECOVERABLE = re.compile(
    r"\\(?:cite|citep|citet|citealp|citealt|citeyear|autocite|ref|eqref|cref|Cref"
    r"|pageref|footnote|input|include)\b\s*(?:\[[^\]]*\])*\s*\{[^}]*\}"
    r"|\$[^$]*\$"
    r"|\\\[[\s\S]*?\\\]"
    r"|\\\((?:[\s\S]*?)\\\)"
)

_ENV_DELIMITER = re.compile(r"\\(?:begin|end)\s*\{[^}]*\}")
_SIMPLE_MACRO = re.compile(r"\\(?:emph|textit|textbf|texttt|textsc|text|mbox|underline)\s*\{")
_BARE_MACRO = re.compile(r"\\[a-zA-Z@]+\*?\s*(?:\[[^\]]*\])?")
_BRACES = re.compile(r"[{}]")

_ACCENT_MACROS = {
    r"\&": "&", r"\%": "%", r"\_": "_", r"\#": "#", r"\$": "$",
    r"\{": "{", r"\}": "}", r"~": " ", r"``": '"', r"''": '"',
    r"\ldots": "...", r"\dots": "...", r"\-": "",
    # Row separator: renders as a line break, so it must become whitespace rather
    # than being deleted and joining two words together.
    r"\\": " ",
    # Explicit spacing macros. These are punctuation rather than commands, so the
    # letter-matching macro stripper below never sees them and would leave the
    # backslash sitting in the middle of the text.
    "\\ ": " ", r"\,": " ", r"\;": " ", r"\:": " ",
    r"\!": "", r"\@": "", r"\/": "",
}


def strip_markup(tex: str) -> str:
    """Reduce LaTeX to approximate rendered prose. Lossy, and only for matching."""
    text = strip_definitions(strip_comments(tex))
    text = _DISCARD_ARGS.sub(" ", text)
    text = _UNRECOVERABLE.sub(" ", text)
    text = _ENV_DELIMITER.sub(" ", text)
    for src, dst in _ACCENT_MACROS.items():
        text = text.replace(src, dst)
    text = _SIMPLE_MACRO.sub("", text)
    text = _BARE_MACRO.sub(" ", text)
    text = _BRACES.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


# Environments whose rendered output cannot be reconstructed from their source: the
# glyphs of an equation, the layout of a table, the numbering of a bibliography.
_OPAQUE_ENVIRONMENTS = _MATH_ENVIRONMENTS + (
    "tabular", "tabularx", "tabu", "table", "table*", "figure", "figure*",
    "verbatim", "lstlisting", "algorithm", "algorithmic", "thebibliography",
    "wrapfigure", "subfigure", "minipage", "picture", "tikzpicture",
)


def blank_environments(text: str, names: tuple[str, ...]) -> str:
    """Replace whole environments with a paragraph break.

    A break rather than nothing, so the prose either side is never joined into a run
    that does not exist in the document.
    """
    spans = _environment_spans(text, names)
    if not spans:
        return text

    # Outermost only: a tabular inside a table is already covered by the table.
    kept: list[tuple[int, int]] = []
    for _name, start, end, _body in spans:
        if kept and start < kept[-1][1]:
            kept[-1] = (kept[-1][0], max(kept[-1][1], end))
        else:
            kept.append((start, end))

    out, cursor = [], 0
    for start, end in kept:
        out.append(text[cursor:start])
        out.append("\n\n")
        cursor = end
    out.append(text[cursor:])
    return "".join(out)


def anchorable_runs(tex: str, *, min_chars: int = 24) -> list[str]:
    """Split source prose into runs that should appear verbatim in the rendered PDF.

    Whole paragraphs cannot be matched against a PDF, because a paragraph almost
    always contains something whose rendered form is unrecoverable from source — a
    citation renders as "(Vaswani et al., 2017)", a cross-reference as a section
    number, inline maths as positioned glyphs. Splitting *at* those points instead of
    trying to reproduce them leaves runs of plain prose, each of which should appear
    in the PDF character for character.

    Each run can then be located with the ordinary anchor machinery, which is what
    gives source-derived facts pixel coordinates.
    """
    source = strip_comments(tex)
    body = expand_macros(document_body(source), user_macros(source))
    body = blank_environments(body, _OPAQUE_ENVIRONMENTS)
    runs: list[str] = []
    for chunk in _UNRECOVERABLE.split(body):
        if not chunk:
            continue
        for piece in re.split(r"\n\s*\n", chunk):
            cleaned = strip_markup(piece)
            if len(cleaned) >= min_chars:
                runs.append(cleaned)
    return runs


# Tokens that end in a period without ending a sentence. Without these, "Smith et al.
# (2020) showed" splits into two fragments and neither matches the PDF.
_ABBREVIATIONS = frozenset("""
al cf ed eds eg ie etc resp approx vs viz inc ltd co dept univ
fig figs eq eqs sec secs tab tabs ref refs app apps ch chs no nos vol vols pp
thm lem cor prop def defn rem alg
dr prof mr mrs ms st jr sr phd
jan feb mar apr jun jul aug sep sept oct nov dec
""".split())

_SENTENCE_BREAK = re.compile(r'(?<=[.!?])["\')\]]*\s+(?=[A-Z(\[])')


def split_sentences(text: str) -> list[str]:
    """Split prose into sentences, keeping scientific abbreviations intact.

    Naive splitting at a period followed by a capital is unusable on papers:
    "Smith et al. (2020)",
    "see Fig. 3", "i.e. the baseline", and initials like "J. Smith" all break, and a
    fragment that stops mid-clause will not match the PDF's text either.
    """
    pieces = _SENTENCE_BREAK.split(text)
    out: list[str] = []
    for piece in pieces:
        if out and _ends_with_abbreviation(out[-1]):
            out[-1] = f"{out[-1]} {piece}"
        else:
            out.append(piece)
    return [p.strip() for p in out if p.strip()]


def _ends_with_abbreviation(text: str) -> bool:
    tail = text.rstrip().rstrip('")\']')
    if not tail.endswith("."):
        return False
    last = tail[:-1].split()[-1] if tail[:-1].split() else ""
    stripped = last.strip("([{'\"").replace(".", "")
    if not stripped:
        return False
    # A single letter is an initial ("J. Smith"), not a sentence end.
    if len(stripped) == 1:
        return True
    return stripped.casefold() in _ABBREVIATIONS


def anchorable_sentences(tex: str, *, min_chars: int = 24) -> list[str]:
    """Sentence-level runs of source prose that should appear verbatim in the PDF.

    Preferred over whole-paragraph runs for two reasons. A long run is fragile: it
    only has to hit one place where the PDF interleaves something — a footnote, a
    figure caption dropped between two columns — to fail entirely, while the sentences
    either side would each have matched. And claims are sentence-shaped anyway, so
    sentence anchors are the granularity the rest of the system wants.
    """
    out: list[str] = []
    for run in anchorable_runs(tex, min_chars=min_chars):
        for sentence in split_sentences(run):
            if len(sentence) >= min_chars:
                out.append(sentence)
    return out
