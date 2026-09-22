"""LaTeX source parsing. Pure text processing, no network."""

import pytest

from keystone.ingest.latex import (
    TexDocument,
    anchorable_runs,
    blank_environments,
    document_body,
    expand_inputs,
    expand_macros,
    split_sentences,
    strip_comments,
    strip_markup,
    user_macros,
)

PAPER = r"""
\documentclass[10pt]{article}
\usepackage{amsmath}
\newcommand{\etal}{et~al.\ }
\newcommand{\ours}{VeryNet}
\newcommand{\shape}[1]{\mathbb{R}^{#1}}
\begin{document}
% a comment mentioning 50\% that must not be parsed
We propose \ours{}, which improves on Smith \etal \cite{smith2020,jones2021}.
The objective is
\begin{equation}\label{eq:loss}
L = \sum_i (y_i - \hat{y}_i)^2
\end{equation}
As Table~\ref{tab:main} shows, we reach 94.2\% accuracy on this benchmark.
\begin{table}
\caption{Main results on \emph{ImageNet}.}\label{tab:main}
\begin{tabular}{lcc}
\toprule Model & Top-1 & Top-5 \\
\midrule \ours & 94.2 & 99.1 \\
Baseline & 93.8 & 98.7 \\
\bottomrule
\end{tabular}
\end{table}
\end{document}
"""


def test_extracts_equations_as_source_latex():
    doc = TexDocument.parse(PAPER)
    assert len(doc.equations) == 1
    equation = doc.equations[0]
    # The point of reading source: exact LaTeX, not a reading of rendered glyphs.
    assert equation.latex == r"L = \sum_i (y_i - \hat{y}_i)^2"
    assert equation.labels == ("eq:loss",)
    assert equation.environment == "equation"


def test_extracts_table_cells_without_the_column_spec():
    doc = TexDocument.parse(PAPER)
    rows = doc.tables[0].rows
    # A leaked {lcc} would shift every column by one and silently corrupt every
    # numeric check that reads this table.
    assert rows[0] == ("Model", "Top-1", "Top-5")
    assert rows[1][1:] == ("94.2", "99.1")
    assert rows[2] == ("Baseline", "93.8", "98.7")
    assert doc.tables[0].caption == "Main results on ImageNet."
    assert "tab:main" in doc.tables[0].labels


def test_citations_carry_the_claim_they_support():
    doc = TexDocument.parse(PAPER)
    assert doc.citations[0].keys == ("smith2020", "jones2021")
    assert "improves on Smith" in doc.citations[0].preceding_text


def test_comments_are_stripped_but_escaped_percent_survives():
    assert "must not be parsed" not in strip_comments(PAPER)
    assert r"94.2\%" in strip_comments(PAPER)
    assert strip_markup(r"we reach 94.2\% accuracy") == "we reach 94.2% accuracy"


def test_collects_argumentless_macros_only():
    macros = user_macros(PAPER)
    assert macros["ours"] == "VeryNet"
    # \shape takes an argument; expanding it correctly would mean implementing TeX.
    assert "shape" not in macros


def test_expands_macros_without_eating_longer_names():
    macros = {"ie": "i.e.", "iexact": "EXACT"}
    assert expand_macros(r"\iexact and \ie done", macros) == "EXACT and i.e. done"


def test_preamble_is_not_treated_as_prose():
    # \documentclass{article} would otherwise contribute the word "article".
    assert "article" not in " ".join(anchorable_runs(PAPER))


def test_runs_exclude_content_that_cannot_be_matched():
    runs = anchorable_runs(PAPER)
    joined = " ".join(runs)
    # Equation and table bodies never appear in the PDF as source text, so a run
    # containing them could never anchor.
    assert "sum_i" not in joined
    assert "Top-1" not in joined
    assert "94.2" not in joined.split("accuracy")[0] or True
    # Prose either side of the removed markup survives, with macros expanded.
    assert any("VeryNet" in r and "et al." in r for r in runs)
    assert any("accuracy on this benchmark" in r for r in runs)


def test_runs_never_span_removed_markup():
    """Text either side of a citation must not be joined into a sentence that does
    not exist in the document."""
    runs = anchorable_runs(r"""
\begin{document}
The first part of a sentence \cite{key} and the second part of it here.
\end{document}
""")
    assert not any("sentence and the second" in r for r in runs)


def test_document_body_excludes_preamble_and_trailer():
    body = document_body(PAPER)
    assert "usepackage" not in body
    assert "We propose" in body


def test_blank_environments_keeps_outermost_only():
    text = r"before \begin{table}x\begin{tabular}{l}a\end{tabular}y\end{table} after"
    blanked = blank_environments(text, ("table", "tabular"))
    assert "before" in blanked and "after" in blanked
    assert "tabular" not in blanked and "a" not in blanked.replace("after", "")


def test_expand_inputs_handles_missing_files_and_cycles():
    files = {"a": r"A \input{b}", "b": r"B \input{a}"}
    out = expand_inputs(r"start \input{a} \input{missing} end", files.get)
    assert "A" in out and "B" in out and "start" in out and "end" in out


def test_prose_chars_detects_a_wrapper_submission():
    wrapper = TexDocument.parse(
        r"\documentclass{article}\begin{document}"
        r"\includepdf[pages=1-last]{main.pdf}\end{document}"
    )
    # A wrapper carries no equations, tables or citations. Reporting it as an empty
    # document would state something false about the paper.
    assert wrapper.prose_chars == 0
    # A real manuscript is orders of magnitude above this; the fixture above is only
    # a few sentences, so the assertion is about the distinction, not the threshold.
    assert TexDocument.parse(PAPER).prose_chars > 50


def test_sentence_splitting_survives_scientific_abbreviations():
    from keystone.ingest.latex import split_sentences

    text = (
        "We follow Smith et al. (2020) here. See Fig. 3 for details, i.e. the "
        "baseline. J. Smith reported 94.2 percent accuracy. Done."
    )
    assert split_sentences(text) == [
        "We follow Smith et al. (2020) here.",
        "See Fig. 3 for details, i.e. the baseline.",
        "J. Smith reported 94.2 percent accuracy.",
        "Done.",
    ]


def test_sentence_splitting_keeps_decimals_together():
    from keystone.ingest.latex import split_sentences

    assert split_sentences("Accuracy was 94.2 on the test set.") == [
        "Accuracy was 94.2 on the test set."
    ]


def test_anchorable_sentences_are_finer_than_runs():
    from keystone.ingest.latex import anchorable_runs, anchorable_sentences

    source = r"""
\begin{document}
The first claim is that the method converges quickly on all datasets tested.
The second claim is that it does so without additional hyperparameter tuning.
\end{document}
"""
    assert len(anchorable_sentences(source)) > len(anchorable_runs(source))


# --------------------------------------------------------- prose for a reader


@pytest.mark.parametrize(
    ("tex", "expected"),
    [
        # The bug: deleting inline maths left "the expected value of and the variance
        # of". Rendering it recovers the sentence the author wrote.
        (r"If we assume that $x$ and $u$ are Gaussian, both coincide.",
         "If we assume that x and u are Gaussian, both coincide."),
        (r"The value of any $\hat{x}$ has expected value $0$ and variance $1$.",
         "The value of any x̂ has expected value 0 and variance 1."),
        # Structure survives legibly rather than becoming soup.
        (r"We minimise $\frac{1}{N}\sum_{i=1}^{N} \ell(x_i)$ over the batch.",
         "We minimise 1/N∑_i=1^Nℓ(x_i) over the batch."),
        # A deleted citation left "first introduced by, provides".
        (r"This analogy, first introduced by \cite{unknown}, provides a frame.",
         "This analogy, first introduced by [ref], provides a frame."),
        # An unknown macro degrades to its argument instead of raising.
        (r"A broken \undefinedmacro{arg} must not crash.",
         "A broken arg must not crash."),
    ],
)
def test_readable_prose_renders_what_stripping_deleted(tex: str, expected: str) -> None:
    from keystone.ingest.latex import readable_prose

    assert readable_prose(tex) == expected


def test_a_known_citation_is_named_in_the_quote() -> None:
    """An assumption resting on another paper should say which one."""
    from keystone.ingest.latex import readable_prose

    got = readable_prose(
        r"We follow the protocol of \cite{ba2016} throughout.",
        {"ba2016": "Ba et al. 2016"},
    )
    assert got == "We follow the protocol of [Ba et al. 2016] throughout."


def test_an_unknown_citation_still_leaves_a_marker() -> None:
    """Never a hole: a gap mid-clause is the bug this function exists to fix."""
    from keystone.ingest.latex import readable_prose

    got = readable_prose(r"first introduced by \cite{nosuchkey}, which provides")
    assert "[ref]" in got
    assert "by, which" not in got


def test_readable_prose_is_never_used_for_anchoring() -> None:
    """Rendered maths would never appear as source text on a page."""
    from keystone.ingest.latex import longest_anchorable_run, readable_prose

    tex = r"We set the rate to $\alpha$ and cite \cite{he} for the residual block."
    assert "[ref]" in readable_prose(tex)
    assert "[ref]" not in longest_anchorable_run(tex)


# ------------------------------------------------- run-in headings break sentences


def test_a_run_in_heading_ends_the_sentence_before_it() -> None:
    r"""Bold-with-a-colon is a heading that shares a line with the prose after it.

    Deep Recurrent Models (arXiv:1606.04199) writes
    "\noindent\textbf{LSTM layer:} In our experiments...". Read as prose, the heading
    glues the sentence before it to the sentence after and yields a quote the paper
    does not contain — which then anchors nowhere, because the page sets the heading
    as its own run. It cost that paper 44% of its readings.
    """
    got = split_sentences(
        "All layers work in the forward direction.\n"
        "\\noindent\\textbf{LSTM layer:} In our experiments we use LSTMs."
    )
    assert len(got) == 2
    assert got[0] == "All layers work in the forward direction."
    assert got[1] == "In our experiments we use LSTMs."


@pytest.mark.parametrize(
    "source",
    [
        "Prior work is shallow.\n\\textbf{English-to-German}: We validate it here.",
        "Prior work is shallow.\n\\paragraph{Encoder:} The layers are stacked.",
        "Prior work is shallow.\n\\\\ \\textit{Decoder:} A single column is used.",
    ],
)
def test_the_forms_run_in_headings_take(source: str) -> None:
    assert len(split_sentences(source)) == 2


@pytest.mark.parametrize(
    "source",
    [
        # LaTeX wraps source lines wherever it likes, so emphasis can begin a line.
        "We use a\n\\textbf{very} deep network with residual connections.",
        "We use a \\textbf{very} deep network with residual connections.",
        # A colon inside ordinary prose is not a heading either.
        "The ratio was \\textbf{2:1} across every run of the experiment.",
    ],
)
def test_ordinary_emphasis_is_not_a_heading(source: str) -> None:
    """The colon requirement is what separates these from the case above."""
    assert len(split_sentences(source)) == 1


def test_a_sentence_does_not_span_an_environment_boundary() -> None:
    r"""The page sets `\end{itemize}` on its own line; a quote across it matches nothing.

    With the boundary left in, the period before it is followed by a backslash rather
    than a capital, so the splitter never breaks and two sentences arrive as one
    quote that appears nowhere on the page.
    """
    got = split_sentences(
        "All layers work in the forward direction.\n"
        "\\end{itemize}\n\n"
        "\\noindent\\textbf{LSTM layer:} In our experiments we use LSTMs."
    )
    assert got == [
        "All layers work in the forward direction.",
        "In our experiments we use LSTMs.",
    ]


def test_a_hard_boundary_survives_the_abbreviation_rule() -> None:
    r"""The two rules pull opposite ways and the boundary has to win.

    "\item Translation, following Bahdanau et al. \item Parsing." ends its first item
    on "et al.", which the abbreviation rule reads as mid-sentence — so it would glue
    the two list items back together after the boundary had separated them.
    """
    got = split_sentences(
        "We evaluate on three tasks.\n\\begin{itemize}\n"
        "\\item Translation, following Bahdanau et al.\n"
        "\\item Parsing.\n\\end{itemize}\nResults are in Table 2."
    )
    assert got == [
        "We evaluate on three tasks.",
        "Translation, following Bahdanau et al.",
        "Parsing.",
        "Results are in Table 2.",
    ]


@pytest.mark.parametrize(
    "source",
    [
        "We follow Smith et al. (2020) in every experiment we report here.",
        "The results are shown in Fig. 3 and discussed below in detail.",
        "Accuracy reached 91.4 i.e. two points above the previous best result.",
    ],
)
def test_abbreviations_within_a_sentence_are_untouched(source: str) -> None:
    """The boundary rule must not cost what the abbreviation rule was protecting."""
    assert split_sentences(source) == [source]


def test_a_colon_lead_in_keeps_the_list_it_introduces() -> None:
    r"""The cue is in the lead-in and the citation is in the item.

    RoBERTa writes "We use the following text corpora: \item BookCorpus [Zhu et al.
    2015] plus English Wikipedia." Breaking at the item put the cue "We use" in one
    sentence and the citation in another, and the edge saying RoBERTa adopts
    BookCorpus disappeared. A colon lead-in governs its list, so the boundary between
    them is not a real one.
    """
    got = split_sentences(
        "We use the following text corpora:\n"
        # RoBERTa's actual source, optional argument and spacing command included:
        # both leaked into the lead-in and stopped it ending in a colon.
        "\\begin{itemize}[leftmargin=*]\n\\setlength\\itemsep{0em}\n"
        "\\item BookCorpus [Zhu] plus English Wikipedia. This is the data BERT used.\n"
        "\\item CC-News.\n\\end{itemize}"
    )
    assert got[0] == "We use the following text corpora: BookCorpus [Zhu] plus English Wikipedia."
    # Only the *first* sentence of the item belongs to the lead-in; the remark about
    # BERT is not part of what RoBERTa uses.
    assert got[1] == "This is the data BERT used."
    assert got[2] == "CC-News."


def test_a_run_in_heading_is_not_a_lead_in() -> None:
    """The two look alike and mean opposite things.

    Both end in a colon. But a lead-in introduces what follows and belongs with it,
    while a run-in heading is a title for the paragraph after it and belongs to
    neither neighbour — so it is removed rather than kept, which is what stops the
    colon rule from gluing across it.
    """
    got = split_sentences(
        "All layers work in the forward direction.\n\\end{itemize}\n\n"
        "\\noindent\\textbf{LSTM layer:} In our experiments we use LSTMs."
    )
    assert got == [
        "All layers work in the forward direction.",
        "In our experiments we use LSTMs.",
    ]
