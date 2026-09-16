"""Reading a paper's bibliography out of its own source.

The field split is heuristic and says so — bibliography styles differ, and a wrong
title is worse than no title. These cases are the ones that were actually wrong on the
corpus, because a reference's title is not just displayed: citations are resolved
against it, so a field-split artefact becomes a wrong edge.
"""

from __future__ import annotations

from keystone.ingest.bibliography import parse


def _one(bbl: str):
    references = parse(bbl)
    assert len(references) == 1, references
    return references[0]


def test_a_url_before_the_title_is_not_part_of_the_title() -> None:
    r"""The cleaners strip the \url macro and leave its argument as text.

    A style that prints the link first produced
    "http://arxiv.org/abs/1904.09675 Bertscore: Evaluating text generation with BERT",
    which is visible in the reader and is also what citations get matched against.
    """
    reference = _one(r"""
\bibitem{zhang2019bertscore}
Tianyi Zhang, Varsha Kishore, and Yoav Artzi.
\newblock \url{http://arxiv.org/abs/1904.09675} Bertscore: Evaluating text
  generation with BERT.
\newblock \emph{ICLR}, 2020.
""")
    assert reference.title == "Bertscore: Evaluating text generation with BERT"
    assert reference.arxiv_id == "1904.09675"
    # `raw` is the paper's own text and stays exact, which is what it is for.
    assert "arxiv.org" in reference.raw


def test_a_trailing_url_is_removed_too() -> None:
    reference = _one(r"""
\bibitem{hoffmann2022chinchilla}
Jordan Hoffmann and others.
\newblock Training compute-optimal large language models, 2022.
\newblock URL \url{https://arxiv.org/abs/2203.15556}.
""")
    assert reference.title == "Training compute-optimal large language models, 2022"
    assert reference.arxiv_id == "2203.15556"


def test_the_identifier_is_still_found_when_written_inline() -> None:
    reference = _one(r"""
\bibitem{devlin2019bert}
Jacob Devlin and others.
\newblock BERT: pre-training of deep bidirectional transformers.
\newblock \emph{arXiv preprint arXiv:1810.04805}, 2018.
""")
    assert reference.arxiv_id == "1810.04805"
    assert reference.title.startswith("BERT")


def test_a_style_with_no_newblocks_offers_only_raw() -> None:
    """Where the split is unknowable the fields stay empty rather than being guessed."""
    reference = _one(r"""
\bibitem{vaswani2017}
A.~Vaswani et~al., Attention is all you need, NIPS 2017.
""")
    assert reference.title == ""
    assert "Attention is all you need" in reference.raw


def test_the_year_is_the_last_one_mentioned() -> None:
    """Entries often carry an original year and a reprint year; the later one is the
    citation's."""
    reference = _one(r"""
\bibitem{lecun1989}
Y.~LeCun.
\newblock Backpropagation applied to handwritten zip code recognition.
\newblock \emph{Neural Computation}, 1989. Reprinted 1998.
""")
    assert reference.year == 1998
