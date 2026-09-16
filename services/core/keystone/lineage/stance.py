"""What a paper says about each work it cites.

A citation is not a neutral pointer. "Following \\cite{ba2016layer} we normalise each
layer" and "Unlike \\cite{ba2016layer}, we normalise across the batch" are opposite
statements about the same paper, and the difference is written down in the prose — it
does not have to be inferred.

Two disciplines carry over from the check suite, both learned the hard way:

**A cue is only a cue where it sits.** "Unlike earlier heuristics, we use the optimiser
of \\cite{kingma2015adam}" contains the word *unlike*, and attributing it to Kingma
reverses the paper's meaning. So a cue counts only inside the clause that governs the
citation — the same failure as matching ``"sum"`` inside ``"summarization"``, which
produced 21 confident false positives before it was fixed.

**Silence is an answer.** A citation with no cue is reported as ``BACKGROUND``, never
as a guess. Most citations are background: in a 91-reference paper the interesting
edges are a couple of dozen, and inventing a stance for the rest would bury them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from keystone.graph.models import Section, SectionKind
from keystone.ingest.latex import (
    blank_environments,
    document_body,
    expand_macros,
    longest_anchorable_run,
    split_sentences,
    strip_comments,
    strip_markup,
    user_macros,
)

_CITE_SITE = re.compile(
    r"\\(?:cite|citep|citet|citealp|citealt|citeyear|autocite)"
    r"\s*(?:\[[^\]]*\])*\s*\{(?P<keys>[^}]+)\}"
)

_OPAQUE = (
    "equation", "equation*", "align", "align*", "gather", "gather*", "multline",
    "eqnarray", "eqnarray*", "displaymath", "split", "tabular", "tabularx", "table",
    "table*", "figure", "figure*", "verbatim", "lstlisting", "algorithm",
    "algorithmic", "thebibliography",
)


class Stance(StrEnum):
    """What the citing sentence does with the work it cites."""

    CONTESTS = "contests"
    """Disagrees, corrects, or names a limitation. The rarest and most interesting."""

    EXTENDS = "extends"
    """Takes the cited work as a starting point and goes past it."""

    INHERITS = "inherits"
    """Adopts it wholesale — a method, a setup, a dataset, a hyperparameter."""

    COMPARES = "compares"
    """Measures against it as a baseline."""

    BACKGROUND = "background"
    """Mentioned. No stance is written down, so none is reported."""

    @property
    def is_load_bearing(self) -> bool:
        """Whether the paper's own result depends on the cited work being right.

        Inheriting someone's method makes their correctness a precondition of yours.
        Contesting or out-scoring them does not.
        """
        return self in (Stance.INHERITS, Stance.EXTENDS)


#: Cues that appear *before* the citation and govern it. Ordered most specific first:
#: "in contrast to" has to beat "contrast", and "building on" has to be tested before
#: anything matching a bare "on".
_PRE: tuple[tuple[Stance, re.Pattern[str]], ...] = (
    (Stance.CONTESTS, re.compile(
        r"\b(?:unlike|in\s+contrast\s+(?:to|with)|contrary\s+to"
        r"|in\s+opposition\s+to|differs?\s+from|diverges?\s+from|departs?\s+from"
        r"|whereas|we\s+(?:dispute|challenge|question)"
        r"|correct(?:ing|s)?\s+(?:the\s+)?(?:claim|result|error)"
        r"|contradicts?|disagrees?\s+with)\b", re.I)),
    # Contrastive conjunctions, held to a stricter test below: these contrast two
    # arbitrary things, and only sometimes is one of them the cited paper.
    (Stance.CONTESTS, re.compile(
        r"\b(?:rather\s+than|instead\s+of|as\s+opposed\s+to|in\s+lieu\s+of)\b", re.I)),
    (Stance.EXTENDS, re.compile(
        r"\b(?:we\s+(?:extend|generalis|generaliz|adapt|refine|strengthen|revisit)\w*"
        r"|build(?:ing|s)?\s+(?:up)?on|extend(?:ing|s)?\s+(?:the\s+)?(?:work|approach|method|result)"
        r"|inspired\s+by|motivated\s+by|improve(?:s|d)?\s+(?:up)?on"
        r"|starting\s+(?:from|with))\b", re.I)),
    (Stance.INHERITS, re.compile(
        r"\b(?:following|as\s+in|as\s+done\s+(?:in|by)|as\s+described\s+(?:in|by)"
        r"|as\s+proposed\s+(?:in|by)|as\s+introduced\s+(?:in|by)"
        r"|we\s+(?:use|used|adopt|adopted|follow|followed|employ|employed|apply|applied"
        r"|reuse|reused|take|took|borrow|borrowed|keep|retain)"
        r"|identical\s+to|the\s+same\s+as|taken\s+from|borrowed\s+from"
        r"|based\s+on|built\s+(?:up)?on\s+top\s+of|implementation\s+of"
        r"|standard\s+(?:practice|setup|recipe))\b", re.I)),
    (Stance.COMPARES, re.compile(
        r"\b(?:compared?\s+(?:to|with|against)|we\s+compare|in\s+comparison\s+(?:to|with)"
        r"|outperform\w*|out-?score\w*|baselines?|versus|vs\.?"
        r"|better\s+than|worse\s+than|on\s+par\s+with|competitive\s+with"
        r"|state[- ]of[- ]the[- ]art)\b", re.I)),
)

#: Cues that appear *after* the citation, where the cited work is the grammatical
#: subject: "\\cite{x} does not account for ...".
_POST: tuple[tuple[Stance, re.Pattern[str]], ...] = (
    (Stance.CONTESTS, re.compile(
        r"^\W*(?:\w+\s+){0,3}?(?:"
        # "does not" alone describes a property — the Transformer does not use
        # recurrence — so it only counts against a verb that names a shortcoming.
        r"(?:does|do|did)\s+not\s+(?:account|generalis|generaliz|handle|address"
        r"|consider|scale|apply|hold|extend|capture|support|work)"
        r"|cannot|can\s+not\s+(?:be\s+)?(?:applied|extended|used)"
        r"|fails?\s+to|failed\s+to|neglects?|overlooks?|ignores?|omits?"
        r"|is\s+(?:limited|restricted|incorrect|wrong|unable)"
        r"|are\s+(?:limited|restricted|incorrect|wrong|unable)"
        r"|suffers?\s+from|struggles?\s+(?:to|with)|breaks?\s+down"
        r")\b", re.I)),
    (Stance.EXTENDS, re.compile(
        r"^\W*(?:\w+\s+){0,3}?(?:which\s+we\s+(?:extend|generalis|generaliz|adapt)\w*)\b",
        re.I)),
    (Stance.INHERITS, re.compile(
        r"^\W*(?:'s|’s)\s+(?:approach|method|architecture|setup|recipe|code"
        r"|implementation|hyper-?parameters?)\b", re.I)),
)

#: Where a clause governing the citation can begin. A cue on the far side of one of
#: these belongs to a different claim: in "Unlike earlier heuristics, we use the
#: optimiser of \\cite{x}", the comma-plus-"we" is the boundary that saves Kingma from
#: being recorded as contested.
_CLAUSE_BREAK = re.compile(
    r";|:|—|--|\.\s"
    r"|,\s*(?:and|but|while|whereas|although|though|yet|so|because|since"
    r"|which|who|where|when|whose)\s"
    # Split *before* the pronoun, not after it. Consuming the "we" left "use the
    # optimiser of" with nothing for the INHERITS cue to match, so every
    # "Unlike X, we use Y" sentence came back as background.
    r"|,\s*(?=(?:we|it|they|this|these|our|the\s+authors)\s)",
    re.I,
)

#: Cues that contrast two things without saying which side the citation is on.
#: "Rather than to distinguish the exact structure of \\cite{qi2017pointnet}" contrasts
#: two *tasks*; PointNet is the thing being distinguished, not the thing being argued
#: with. So for these the citation has to be the object of the contrast, which fails
#: the moment a verb intervenes.
_CONTRASTIVE = re.compile(
    r"\b(?:rather\s+than|instead\s+of|as\s+opposed\s+to|in\s+lieu\s+of)\b", re.I
)

#: A verb between the cue and the citation means the contrast is between two actions.
_INTERVENING_VERB = re.compile(
    # The "to + verb" arm cannot carry the trailing \\b: in "to distinguish" there is
    # no word boundary after the matched letter, so the whole alternative never fired
    # and every verbal contrast was recorded as a dispute with the cited paper.
    r"\bto\s+[a-z]"
    r"|\b(?:is|are|was|were|be|being|has|have|had|can|could|will|would"
    r"|should|may|might|does|do|did)\b", re.I
)

#: Negation directly before a cue inverts it. VGG writes "we did **not** depart from
#: the classical ConvNet architecture of \\cite{lecun1989}" — read naively that is the
#: paper disputing LeCun, when it is the paper saying it kept his design. A negated cue
#: is dropped rather than inverted: the naive reading is provably wrong, but the
#: inverse is a guess about negation scope, and this suite does not guess.
_NEGATOR = re.compile(r"\b(?:not|n't|never|neither|nor|hardly|without)\b\s*$", re.I)

#: Any sign that the sentence is about this paper rather than about the field.
_ABOUT_US = re.compile(
    r"\b(?:we|our|ours|us|ourselves|this\s+(?:paper|work|study|section|article))\b", re.I
)


#: When the clause already has a first-person subject, the sentence is about *this*
#: paper, and a shortcoming named after the citation is this paper's own limitation
#: rather than the cited paper's. Premise before conclusion — the same rule the table
#: checks had to learn after 31 confident false positives.
_FIRST_PERSON = re.compile(
    r"\b(?:our|we|this\s+(?:paper|work|method|approach|study))\b[^.;:]*$", re.I
)

#: A cue further back than this is not governing the citation even inside one clause.
#: Measured, not chosen: at 400 characters the classifier picked up cues from the far
#: end of long method sentences; 140 keeps the clause honest without clipping the
#: ordinary "Following the setup of X et al. (2019), we ..." construction.
WINDOW = 140


@dataclass(frozen=True, slots=True)
class CitationContext:
    """One citation site: what the paper says about the work, and where it says it."""

    key: str
    sentence: str
    """Markup stripped — what the reader is shown."""
    anchor_text: str
    """The part of the sentence that can be matched against the PDF verbatim.

    Not the same string as ``sentence``: a citation renders as "[11]" on the page, so
    the stripped sentence has a hole exactly where the PDF has a number and matches
    nothing. This is the longest citation-free run, which matches character for
    character. Empty when the sentence is mostly citations.
    """
    section: str
    section_kind: SectionKind
    stance: Stance
    cue: str
    """The exact words that decided the stance. Empty for ``BACKGROUND``."""

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "sentence": self.sentence,
            "anchorText": self.anchor_text,
            "section": self.section,
            "sectionKind": str(self.section_kind),
            "stance": str(self.stance),
            "cue": self.cue,
        }


def _adopts_without_saying_who(stance: Stance, cue: str, sentence: str) -> bool:
    """Whether an adoption cue is describing somebody else's practice.

    Adopting something is a claim about *this* paper, so the sentence has to be about
    this paper. Chinchilla writes "Following \\cite{kaplan2020} and the training setup
    of GPT-3 \\cite{brown2020}, many of the recently trained large models have been
    trained for approximately 300 billion tokens" — the subject is other people's
    models, and reading it as Chinchilla adopting GPT-3's setup misattributes a survey
    of the field to the paper making it.

    Cues that are already first-person ("we follow", "we adopt") carry their own
    subject and need no check. The cost is passive constructions — "the weights are
    initialised as in \\cite{he2015}" is a real adoption this will miss — which is the
    trade this suite makes everywhere: a missed edge over a wrong one.
    """
    if not stance.is_load_bearing or cue.lower().startswith("we "):
        return False
    return not _ABOUT_US.search(sentence)


def classify(before: str, after: str) -> tuple[Stance, str]:
    """Decide what a citation's surroundings say about it.

    ``before`` and ``after`` are the stripped prose on either side of the citation
    inside its own sentence. Returns the stance and the exact cue that decided it.
    """
    clause = _governing_clause(before)

    for stance, pattern in _PRE:
        for match in pattern.finditer(clause):
            if _negated(clause, match.start()):
                continue
            if _CONTRASTIVE.fullmatch(match.group(0)) and _INTERVENING_VERB.search(
                clause[match.end() :]
            ):
                continue
            if _is_gerund(match.group(0), clause, match.end()):
                continue
            return stance, match.group(0).strip()

    if not _FIRST_PERSON.search(clause):
        for stance, pattern in _POST:
            match = pattern.search(after[:WINDOW])
            if match:
                return stance, match.group(0).strip(" \t'’")

    return Stance.BACKGROUND, ""


#: Words that turn "following" into a noun rather than a cue. InstructGPT writes "a
#: related line of work on instruction following for navigation", where "following" is
#: the thing being studied, not the paper adopting anything. As a participle it is
#: followed by what is being followed — a determiner, or the citation itself.
_GERUND_AFTER = re.compile(r"^\s*(?:for|in|of|with|on|to|as|from|by)\b", re.I)


def _is_gerund(cue: str, clause: str, end: int) -> bool:
    """Whether a "following" is a noun in this position."""
    return cue.lower() == "following" and bool(_GERUND_AFTER.match(clause[end:]))


def _cue_already_taken(before: str, cue: str) -> bool:
    """Whether an earlier citation is the one the contrastive cue is about.

    A contrastive cue takes a single object; an adopting cue distributes over a list.
    "We employ a residual connection \\cite{he} ... followed by layer normalization
    \\cite{ba}" adopts both, and must keep doing so. But BERTScore writes "In contrast
    to prior word embeddings \\cite{mikolov}, contextual embeddings, such as BERT
    \\cite{devlin} and ELMo \\cite{peters}, can generate different vector
    representations" — where the contrast is with the *first* citation and BERT and
    ELMo are examples of the favoured side. Reading the cue as governing them recorded
    BERTScore as disputing the two papers it is built on.

    So a contrastive cue is spent on the nearest citation after it. If another citation
    sits between the cue and this one, this one is not what is being argued with.
    """
    if not cue:
        return False
    at = before.lower().rfind(cue.lower())
    if at < 0:
        return False
    return _CITE_SITE.search(before, at + len(cue)) is not None


def _negated(clause: str, cue_start: int) -> bool:
    """Whether a negator sits immediately before the cue."""
    return bool(_NEGATOR.search(clause[max(0, cue_start - 24) : cue_start]))


def _governing_clause(before: str) -> str:
    """The tail of ``before`` that actually governs the citation."""
    tail = before[-WINDOW:]
    breaks = list(_CLAUSE_BREAK.finditer(tail))
    if breaks:
        tail = tail[breaks[-1].end() :]
    return tail


def contexts(latex: str, sections: tuple[Section, ...]) -> list[CitationContext]:
    """Every citation site in the paper, with what the paper says about it.

    Sections are walked rather than the whole document so each site knows where it
    sits. Where a paper says something matters: a contested citation in related work
    is positioning, and the same citation in the method is a design decision.
    """
    out: list[CitationContext] = []
    for section in sections:
        source = section.source or ""
        if not source.strip():
            continue
        body = blank_environments(
            expand_macros(strip_comments(source), user_macros(latex)), _OPAQUE
        )
        for raw in split_sentences(body):
            if "\\cite" not in raw:
                continue
            sentence = strip_markup(raw)
            if len(sentence) < 24:
                continue
            anchor_text = longest_anchorable_run(raw)
            for site in _CITE_SITE.finditer(raw):
                before = strip_markup(raw[: site.start()])
                after = strip_markup(raw[site.end() :])
                stance, cue = classify(before, after)
                if stance is Stance.CONTESTS and _cue_already_taken(
                    raw[: site.start()], cue
                ):
                    stance, cue = Stance.BACKGROUND, ""
                if _adopts_without_saying_who(stance, cue, sentence):
                    stance, cue = Stance.BACKGROUND, ""
                for key in _keys(site.group("keys")):
                    out.append(
                        CitationContext(
                            key=key,
                            sentence=sentence,
                            anchor_text=anchor_text,
                            section=section.title,
                            section_kind=section.kind,
                            stance=stance,
                            cue=cue,
                        )
                    )
    return out


def _keys(group: str) -> list[str]:
    return [key.strip() for key in group.split(",") if key.strip()]


def strongest(contexts: list[CitationContext]) -> dict[str, CitationContext]:
    """One context per cited work: the most specific thing the paper says about it.

    A paper cites the same work in several places, usually once with a real stance and
    three times in passing. Reporting all four gives the reader four rows to read
    before finding the one that says anything.
    """
    rank = {
        Stance.CONTESTS: 0,
        Stance.EXTENDS: 1,
        Stance.INHERITS: 2,
        Stance.COMPARES: 3,
        Stance.BACKGROUND: 4,
    }
    best: dict[str, CitationContext] = {}
    for context in contexts:
        current = best.get(context.key)
        if current is None or rank[context.stance] < rank[current.stance]:
            best[context.key] = context
    return best
