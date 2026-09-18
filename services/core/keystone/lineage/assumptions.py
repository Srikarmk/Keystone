"""What a paper takes as given.

Every paper rests on things it does not establish. Some it inherits from work it cites,
some it demonstrates in its own tables, and some it simply asserts and moves past. The
third kind is where a result is most likely to be fragile, and no paper labels them.

They are, however, *written down*. Authors announce their assumptions in a small and
stable set of phrases — "we assume", "for simplicity", "it is well known that",
"we conjecture" — because the conventions of the genre require it. So this needs no
model and no inference: it reads the sentence, reports it verbatim, and says which of
three things the paper offers in support.

The support classification is the part that matters, and it is decidable:

* **cited** — the sentence cites a source, so the assumption leans on other work.
* **shown** — the sentence points at the paper's own table, figure or theorem.
* **bare** — neither. The paper states it and continues.

"Nine assumptions, four of them bare" is a true, checkable sentence about a
well-reviewed paper, which is exactly what the numeric audit could never produce.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from keystone.graph.models import Section, SectionKind
from keystone.ingest.latex import (
    blank_environments,
    expand_macros,
    longest_anchorable_run,
    readable_prose,
    split_sentences,
    strip_comments,
    strip_markup,
    user_macros,
)

_CITE = re.compile(
    r"\\(?:cite|citep|citet|citealp|citealt|citeyear|autocite)"
    r"\s*(?:\[[^\]]*\])*\s*\{(?P<keys>[^}]+)\}"
)
_REF = re.compile(r"\\(?:ref|eqref|autoref|cref|Cref|vref)\s*\{(?P<target>[^}]+)\}")

_OPAQUE = (
    "equation", "equation*", "align", "align*", "gather", "gather*", "multline",
    "eqnarray", "eqnarray*", "displaymath", "split", "tabular", "tabularx", "table",
    "table*", "figure", "figure*", "verbatim", "lstlisting", "algorithm",
    "algorithmic", "thebibliography",
)


class Kind(StrEnum):
    """What sort of thing the paper is taking for granted."""

    STATED = "stated"
    """Announced as an assumption: "we assume", "under the assumption that"."""

    SIMPLIFYING = "simplifying"
    """Scope deliberately narrowed: "for simplicity", "we restrict attention to"."""

    CONVENTIONAL = "conventional"
    """Deferred to the field: "it is well known that", "it is standard practice"."""

    CONJECTURAL = "conjectural"
    """Offered as a belief: "we conjecture", "we believe", "presumably"."""

    CONDITIONAL = "conditional"
    """A precondition the result needs: "provided that", "as long as"."""


class Support(StrEnum):
    """What the paper offers for it, in the same sentence.

    Named for what is observable, not for what it implies. A citation in the sentence
    is a citation in the sentence; whether that citation actually establishes the
    assumption is a judgement this cannot make, so it is not claimed. The reader gets
    the sentence and the reference and can decide.
    """

    CITED = "cited"
    """The sentence cites a source."""

    SHOWN = "shown"
    """The sentence points at the paper's own table, figure, theorem or equation."""

    BARE = "bare"
    """Neither. Asserted and left there."""


#: Cues, most specific first. Each has to be anchored so that it reads as the author
#: announcing an assumption rather than as an ordinary use of the word: "assuming"
#: qualifies, "the assumption of independence is violated" does not.
_CUES: tuple[tuple[Kind, re.Pattern[str]], ...] = (
    (Kind.STATED, re.compile(
        r"\b(?:we\s+(?:assume|assumed|posit|postulate)"
        r"|assuming\s+(?:that|a|an|the)?"
        r"|under\s+the\s+assumption"
        r"|we\s+(?:hypothesis|hypothesiz|hypothesis)\w*"
        r"|suppose\s+(?:that|a|an|the)"
        r"|let\s+us\s+assume"
        r"|is\s+assumed\s+to"
        r"|are\s+assumed\s+to)\b", re.I)),
    (Kind.SIMPLIFYING, re.compile(
        r"\b(?:for\s+(?:simplicity|ease\s+of\s+(?:exposition|presentation|notation)"
        r"|tractability|brevity|clarity)"
        r"|without\s+loss\s+of\s+generality"
        r"|we\s+(?:restrict|limit)\s+(?:our\s+)?(?:attention|analysis|scope|study)"
        r"|we\s+(?:consider|examine|study|evaluate)\s+only"
        r"|we\s+focus\s+(?:only\s+)?on"
        r"|we\s+(?:omit|ignore|disregard|set\s+aside|leave\s+out)"
        r"|we\s+do\s+not\s+(?:consider|model|address|attempt))\b", re.I)),
    (Kind.CONVENTIONAL, re.compile(
        r"\b(?:it\s+is\s+(?:well[-\s]known|widely\s+(?:known|believed|accepted)"
        r"|generally\s+(?:known|accepted|believed)|common(?:ly)?\s+(?:known|assumed)"
        r"|standard(?:\s+practice)?|customary|conventional)"
        r"|as\s+is\s+(?:well[-\s]known|standard|customary)"
        r"|conventional\s+wisdom"
        r"|it\s+is\s+widely\s+held)\b", re.I)),
    (Kind.CONJECTURAL, re.compile(
        r"\b(?:we\s+(?:conjecture|speculate|suspect|believe|expect|anticipate)"
        r"|we\s+attribute\s+this\s+to"
        r"|presumably|intuitively"
        r"|it\s+is\s+likely\s+that"
        r"|(?:this|which)\s+(?:is\s+)?likely\s+(?:because|reflects|indicates)"
        r"|our\s+(?:intuition|hypothesis)\s+is)\b", re.I)),
    # No "if and only if" here, and no bare "holds if": those are the language of a
    # theorem's own statement, not of a precondition the paper is taking on. Including
    # them turned every lemma in a theory paper into an assumption.
    (Kind.CONDITIONAL, re.compile(
        r"\b(?:provided\s+that|as\s+long\s+as|so\s+long\s+as"
        r"|requires?\s+that|required\s+that"
        r"|is\s+valid\s+only\s+(?:if|when)"
        r"|only\s+(?:holds|applies|works)\s+(?:if|when))\b", re.I)),
)

#: Negated cues are not cues. "We do not assume the data is i.i.d." is the paper
#: removing an assumption, and recording it as one inverts the claim — the same trap
#: the stance classifier fell into with "we did not depart from".
_NEGATOR = re.compile(r"\b(?:not|n't|never|neither|nor)\b\s*$", re.I)

#: Reference targets that constitute the paper showing its work. A `\ref` to a section
#: is navigation, not evidence, so it does not count as support.
_EVIDENCE_KINDS = frozenset({"table", "figure", "equation", "theorem", "lemma",
                             "proposition", "corollary", "algorithm"})

#: Short sentences are fragments — a stray "we assume" in a caption or a list item
#: with no assumption attached to read.
MIN_CHARS = 40


@dataclass(frozen=True, slots=True)
class Assumption:
    """One thing a paper takes as given, as the paper worded it."""

    sentence: str
    """Markup stripped — what the reader is shown."""
    anchor_text: str
    """The longest run of the sentence that appears in the PDF verbatim.

    A citation renders as "[11]" and inline maths as positioned glyphs, so the
    stripped sentence has holes where the page has content. Matching the longest clean
    run instead is what gets an assumption onto a page.
    """
    kind: Kind
    support: Support
    cue: str
    """The exact words that identified it. Shown, so the reader can disagree."""
    section: str
    section_kind: SectionKind
    cites: tuple[str, ...]
    refs: tuple[str, ...]

    @property
    def is_bare(self) -> bool:
        return self.support is Support.BARE

    def to_dict(self) -> dict:
        return {
            "sentence": self.sentence,
            "anchorText": self.anchor_text,
            "kind": str(self.kind),
            "support": str(self.support),
            "cue": self.cue,
            "section": self.section,
            "sectionKind": str(self.section_kind),
            "cites": list(self.cites),
            "refs": list(self.refs),
        }


def identify(raw: str, label_kinds: dict[str, str]) -> tuple[Kind, str] | None:
    """Whether a sentence announces an assumption, and which kind.

    ``raw`` is the sentence's own LaTeX, so citations and references are still in it.
    Returns ``None`` when nothing is announced — which is most sentences, and is the
    honest answer rather than a weak guess.
    """
    text = strip_markup(raw)
    for kind, pattern in _CUES:
        for match in pattern.finditer(text):
            if _NEGATOR.search(text[max(0, match.start() - 20) : match.start()]):
                continue
            return kind, match.group(0).strip()
    return None


def support_for(raw: str, label_kinds: dict[str, str]) -> Support:
    """What the sentence offers in support of what it assumes."""
    if _CITE.search(raw):
        return Support.CITED
    for match in _REF.finditer(raw):
        for target in match.group("target").split(","):
            if label_kinds.get(target.strip(), "") in _EVIDENCE_KINDS:
                return Support.SHOWN
    return Support.BARE


def extract(
    latex: str,
    sections: tuple[Section, ...],
    label_kinds: dict[str, str],
    cites: dict[str, str] | None = None,
) -> list[Assumption]:
    """Every assumption the paper states, with what it offers for each.

    ``cites`` maps a citation key to how it should read in a quotation — "Ba et al.
    2016" rather than a bare marker — so an assumption that leans on another paper
    names it in the sentence the reader is shown.
    """
    out: list[Assumption] = []
    seen: set[str] = set()

    for section in sections:
        source = section.source or ""
        if not source.strip():
            continue
        body = blank_environments(
            expand_macros(strip_comments(source), user_macros(latex)), _OPAQUE
        )
        for raw in split_sentences(body):
            sentence = strip_markup(raw)
            if len(sentence) < MIN_CHARS or sentence in seen:
                continue

            found = identify(raw, label_kinds)
            if found is None:
                continue
            kind, cue = found
            seen.add(sentence)

            out.append(
                Assumption(
                    # Shown to a reader, so elided maths becomes an ellipsis rather
                    # than a hole. The anchor still uses the exact text.
                    sentence=readable_prose(raw, cites),
                    anchor_text=longest_anchorable_run(raw),
                    kind=kind,
                    support=support_for(raw, label_kinds),
                    cue=cue,
                    section=section.title,
                    section_kind=section.kind,
                    cites=tuple(
                        dict.fromkeys(
                            key.strip()
                            for match in _CITE.finditer(raw)
                            for key in match.group("keys").split(",")
                            if key.strip()
                        )
                    ),
                    refs=tuple(
                        dict.fromkeys(
                            target.strip()
                            for match in _REF.finditer(raw)
                            for target in match.group("target").split(",")
                            if target.strip()
                        )
                    ),
                )
            )
    return out


def tally(assumptions: list[Assumption]) -> dict[str, int]:
    """Counts the reader is owed up front, so the total is not a bare number."""
    return {
        "total": len(assumptions),
        "cited": sum(1 for a in assumptions if a.support is Support.CITED),
        "shown": sum(1 for a in assumptions if a.support is Support.SHOWN),
        "bare": sum(1 for a in assumptions if a.support is Support.BARE),
    }
