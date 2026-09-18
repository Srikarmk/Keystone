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
    document_title,
    document_body,
    expand_macros,
    longest_anchorable_run,
    split_sentences,
    strip_comments,
    readable_prose,
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
        r"|standard\s+(?:practice|setup|recipe|approach|method|algorithm"
        r"|implementation|technique|procedure|architecture|benchmark)"
        # Bare participials. These were all first-person-only ("we use", "we employ"),
        # which cost 280 of ACL-ARC's 364 `Uses` instances: an NLP paper writes
        # "employ Collins head rules (Collins 1999)" or "using an auxiliary
        # distribution (Neal & Hinton 1998)", where the "we" sits back across a clause
        # break and the cue arrives on its own. The premise check still applies, so the
        # sentence has to be about this paper for any of these to count.
        r"|using|employing|adopting|applying|re-?implement(?:ing|ed)?"
        r"|(?:as\s+)?implemented\s+(?:in|by|using)"
        # A dataset is adopted as much as a method is, and the sample showed these
        # phrasings missed entirely.
        r"|we\s+(?:look\s+at|evaluate\s+on|train\s+on|test\s+on|report\s+on))\b",
        re.I)),
    (Stance.COMPARES, re.compile(
        r"\b(?:compared?\s+(?:to|with|against)|we\s+compare|in\s+comparison\s+(?:to|with)"
        r"|outperform\w*|out-?score\w*|baselines?|versus|vs\.?"
        r"|better\s+than|worse\s+than|on\s+par\s+with|competitive\s+with)\b", re.I)),
    # No "state of the art" here. Hand-labelling 60 citation sites found that cue
    # alone responsible for 8 of 17 errors, and always the same way: "LSTMs have been
    # firmly established as state of the art approaches" describes the field's status
    # quo, it does not measure this paper against anything.
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
    # No colon: it introduces an elaboration the preceding cue still governs,
    # and "We compare with eight metrics: Bleu [cite], ..." lost its cue to it.
    r";|—|--|\.\s"
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

#: An adoption cue between a contrastive conjunction and the citation reassigns the
#: citation to the adoption: "...as opposed to required skill based on conventions in
#: the literature [cite]" follows that convention rather than disputing it.
_ADOPTION_BETWEEN = re.compile(
    r"\b(?:based\s+on|following|as\s+in|taken\s+from|borrowed\s+from"
    r"|described\s+in|proposed\s+(?:in|by))\b", re.I
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
    r"\b(?:we|our|ours|us|ourselves"
    r"|this\s+(?:paper|work|study|section|article)"
    r"|the\s+(?:present|proposed)\s+(?:paper|work|study|method|approach|model))\b",
    re.I,
)

#: A paper's own name, taken from the part of its title before the colon.
#:
#: Naming your system instead of saying "we" is the house style of the field's
#: abstracts, and the premise check could not see it: BERT writes "Unlike recent
#: language representation models \cite{peters2018,radford2018}, BERT is designed to
#: pre-train deep bidirectional representations", which is the paper contrasting itself
#: with ELMo and GPT in as many words. With only pronouns to go on that reads as a
#: remark about the field and the two edges BERT is best known for disappear.
#:
#: Only the pre-colon fragment, and only when it looks like a name: "BERT:", "ELMo:",
#: "BERTScore:", "LLaMA:". A title with no colon yields nothing rather than a guess,
#: which is why this helps BERT and not ResNet — "Deep Residual Learning for Image
#: Recognition" never names the model at all. Those papers say "our" instead.
#: Up to three capitalised words before a colon. Three rather than one because the
#: name is often a phrase — "Batch Normalization: Accelerating Deep Network Training" —
#: and taking only "Batch" would treat every sentence mentioning a batch as a sentence
#: about this paper, which is how a premise check stops checking anything.
_SELF_NAME = re.compile(
    r"^\s*([A-Z][A-Za-z0-9.+-]{1,19}(?:\s+[A-Z][A-Za-z0-9.+-]{1,19}){0,2})\s*:"
)

#: A paper naming its own contribution. Most of the field's best-known papers have no
#: colon in the title — "Attention Is All You Need", "Training Compute-Optimal Large
#: Language Models" — and say the name once, in the abstract, then use it throughout:
#: "We propose a new simple network architecture, the Transformer". Without it the
#: Transformer paper loses "In contrast to RNN sequence-to-sequence models, the
#: Transformer outperforms the BerkeleyParser", which is as clear a comparison as the
#: paper makes.
_INTRODUCES = re.compile(
    # The flag is scoped to the verb: an abstract opens with "We propose", so the
    # phrase has to match either case, while the name must stay case-sensitive or
    # every lowercase word after it would qualify.
    r"(?i:\bwe\s+(?:propose|present|introduce|call|name|term|train|release)\b)"
    # No "." in the name: with it, "the Transformer. The Transformer achieves" matched
    # as one twenty-eight character name, because the class let the name eat the
    # sentence boundary and the multi-word arm then ran on into the next sentence.
    r"[^.]{0,70}?\b(?P<name>[A-Z][A-Za-z0-9+-]{2,19}"
    r"(?:\s+[A-Z][A-Za-z0-9+-]{2,19}){0,2})\b"
)

#: Capitalised words that follow an introducing verb without being a name. Cheap guard;
#: the mention count below does most of the work.
_NOT_A_NAME = frozenset({
    "the", "we", "our", "this", "these", "a", "an", "in", "it", "its", "for", "with",
    "and", "new", "on", "to", "of", "two", "three", "table", "figure", "section",
    "english", "german", "french", "chinese", "imagenet", "wikipedia", "internet",
})

#: The field's own vocabulary, which no paper gets to claim as its name. "We present a
#: massive exploration of NMT architectures" and "we train GNNs" both name the subject
#: matter, and reading either as the paper's name would loosen the premise check on
#: exactly the papers that discuss them on every page.
#:
#: Only consulted for names read out of the abstract. A name in the title is the
#: paper's by construction, which is how GLUE keeps its own acronym.
_A_FIELD_TERM = frozenset({
    "mt", "smt", "nmt", "nlp", "nlu", "nlg", "asr", "ocr", "ir", "qa",
    "ai", "ml", "rl", "rlhf", "sgd", "adam", "em", "map", "mle", "kl",
    "cnn", "cnns", "rnn", "rnns", "gnn", "gnns", "mlp", "mlps", "lstm", "lstms",
    "gru", "grus", "gan", "gans", "vae", "vaes", "llm", "llms", "lm", "lms",
    "bleu", "rouge", "meteor", "wer", "auc", "gpu", "gpus", "tpu", "tpus",
    "sota", "iid", "relu", "pca", "svm", "svms", "knn", "hmm", "crf", "api",
    # Datasets and benchmarks. A paper trains *on* these; it is not named after them.
    # "AI safety via debate" writes "we train ... MNIST", and reading MNIST as the
    # paper's own name makes every sentence about the dataset self-referential.
    "mnist", "cifar", "cifar-10", "cifar-100", "imagenet", "coco", "squad", "wmt",
    "wikitext", "penn", "treebank", "conll", "semeval", "librispeech", "celeba",
    "openwebtext", "bookcorpus", "commoncrawl", "c4", "pile", "svhn", "stl-10",
})

#: An acronym worn as a plural is a category of thing, not one model: "GNNs", "CNNs".
_PLURAL_ACRONYM = re.compile(r"^[A-Z]{2,}s$")

#: How often a candidate has to appear before it is treated as the paper's own name.
#: A paper's model is named on nearly every page; an ordinary capitalised noun that
#: happened to follow "we propose" is not.
MIN_MENTIONS = 8

#: Where a paper names itself: the abstract and the introduction, not the related work.
INTRO_CHARS = 8000


def self_name(title: str, body: str = "") -> str:
    """What this paper calls itself.

    Two sources, title first. "BERT: Pre-training of..." says it outright; "Attention Is
    All You Need" does not, and has to be read out of "we propose ... the Transformer".

    Both are held to the same standard, which is that an ordinary word must not get
    through: treating "Attention" as the paper's own name would make every sentence
    mentioning attention a sentence about this paper, and the premise check would stop
    checking anything. The title route wants the shape of a coined name — two capitals,
    as in BERT, LLaMA, BERTScore. The abstract route wants the word used like a name,
    which means used constantly: at least :data:`MIN_MENTIONS` times in the paper, and
    not one of the field's own words (:data:`_A_FIELD_TERM`).
    """
    match = _SELF_NAME.match(title or "")
    if match is not None:
        name = match.group(1)
        if sum(1 for character in name if character.isupper()) >= 2:
            return name

    for found in _INTRODUCES.finditer(body[:INTRO_CHARS]):
        candidate = found.group("name")
        if candidate.lower() in _NOT_A_NAME or candidate.lower() in _A_FIELD_TERM:
            continue
        if _PLURAL_ACRONYM.match(candidate):
            continue
        mentions = len(re.findall(rf"\b{re.escape(candidate)}\b", body))
        if mentions >= MIN_MENTIONS:
            return candidate
    return ""


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
    """Markup stripped: the exact text the cue rules read.

    This is the site's identity as well as its input, which is why it is kept separate
    from what a reader sees. The label file keys on it, so a change to how a citation
    *renders* must not change it — otherwise every labelled row silently stops matching
    and `stance-refresh` leaves stale predictions behind under a fresh headline.
    """
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
    shown: str = ""
    """The same sentence rendered for a reader, with citations named and maths set.

    Kept apart from :attr:`sentence` because they answer different questions. A reader
    needs "we chose the baseline of Mikolov et al. 2011"; the rules and the label file
    need the exact string they were measured on, forever.
    """
    ordinal: int = 0
    """Where this citation sits in the paper, counting sites in document order.

    Needed to break a tie between equally load-bearing dependencies. The Transformer
    adopts four works in its method section, all anchored and all in the library, so
    every other test came out level and the single "stands on" headline fell to
    whichever citation key sorted first — Inception, cited for label smoothing.
    Order of first mention is the honest discriminator: a paper describes what its
    architecture is built from before it gets to training details.
    """

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "sentence": self.sentence,
            "anchorText": self.anchor_text,
            "section": self.section,
            "sectionKind": str(self.section_kind),
            "stance": str(self.stance),
            "cue": self.cue,
            "ordinal": self.ordinal,
        }


def _about_us(sentence: str, name: str) -> bool:
    """Whether a sentence is about this paper — by pronoun, or by its own name."""
    if _ABOUT_US.search(sentence):
        return True
    return bool(name) and re.search(rf"\b{re.escape(name)}\b", sentence) is not None


def _without_saying_who(
    stance: Stance, cue: str, sentence: str, leading: bool, name: str = ""
) -> bool:
    """Whether a cue describes a relation this paper is not a party to.

    Every stance is a relation *between this paper and the cited work*: adopting a
    method, arguing with a claim, measuring against a baseline. So a cue in front of
    the citation means what it appears to mean only if the sentence is about this
    paper. Chinchilla writes "Following \\cite{kaplan2020} and the training setup of
    GPT-3 \\cite{brown2020}, many of the recently trained large models have been
    trained for approximately 300 billion tokens" — the subject is other people's
    models, and reading it as Chinchilla adopting GPT-3's setup misattributes a survey
    of the field to the paper making it.

    Adoption cues were held to this from the start. Comparative ones were not, and
    scoring against SciCite showed the cost: 136 of 223 `result` readings were wrong,
    and they look like "women are disproportionately more frequently affected compared
    to men [12]", "15 of 50 SspA orthologs contain either Asp or Glu at position 92
    instead of Tyr [12]", "whereas PCV-2 has been associated with postweaning
    multisystemic wasting syndrome [12]". Every one compares two things in the subject
    matter; not one compares anything to the citing paper. A cue read without checking
    its premise yields a confident opposite rather than a vague answer, which is the
    lesson the table checks learned first.

    ``leading`` says the cue came from :data:`_PRE`. :data:`_POST` cues are exempt,
    because they describe the cited work itself — "\\cite{x} does not account for
    long-range dependencies" is a property of x whoever is writing. Cues that are
    already first-person ("we compare", "we adopt") carry their own subject.

    The cost is passive constructions: "the weights are initialised as in
    \\cite{he2015}" is a real adoption this misses. That is the trade this suite makes
    everywhere — a missed edge over a wrong one.
    """
    if stance is Stance.BACKGROUND or not leading:
        return False
    if cue.lower().startswith("we "):
        return False
    return not _about_us(sentence, name)


def classify(before: str, after: str) -> tuple[Stance, str]:
    """Decide what a citation's surroundings say about it.

    ``before`` and ``after`` are the stripped prose on either side of the citation
    inside its own sentence. Returns the stance and the exact cue that decided it.
    """
    stance, cue, _leading = _decide(before, after)
    return stance, cue


def _decide(before: str, after: str) -> tuple[Stance, str, bool]:
    """:func:`classify`, plus which table the cue came from.

    The guards need to know which: a cue in front of the citation asserts something
    about this paper, and a cue behind it asserts something about the cited work. Only
    the first kind has a premise to check.
    """
    clause = _governing_clause(before)

    for stance, pattern in _PRE:
        for match in pattern.finditer(clause):
            if _negated(clause, match.start()):
                continue
            if _CONTRASTIVE.fullmatch(match.group(0)) and (
                _INTERVENING_VERB.search(clause[match.end() :])
                or _ADOPTION_BETWEEN.search(clause[match.end() :])
            ):
                continue
            if _is_gerund(match.group(0), clause, match.end()):
                continue
            return stance, match.group(0).strip(), True

    if not _FIRST_PERSON.search(clause):
        for stance, pattern in _POST:
            match = pattern.search(after[:WINDOW])
            if match:
                return stance, match.group(0).strip(" \t'’"), False

    return Stance.BACKGROUND, "", False


#: Words that turn "following" into a noun rather than a cue. InstructGPT writes "a
#: related line of work on instruction following for navigation", where "following" is
#: the thing being studied, not the paper adopting anything. As a participle it is
#: followed by what is being followed — a determiner, or the citation itself.
_GERUND_AFTER = re.compile(r"^\s*(?:for|in|of|with|on|to|as|from|by)\b", re.I)


def _is_gerund(cue: str, clause: str, end: int) -> bool:
    """Whether a "following" is a noun in this position."""
    return cue.lower() == "following" and bool(_GERUND_AFTER.match(clause[end:]))


def _cue_already_taken(before: str, cue: str, sites: re.Pattern[str] = None) -> bool:
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
    return (sites or _CITE_SITE).search(before, at + len(cue)) is not None


def read(
    before: str,
    after: str,
    sentence: str,
    *,
    marked_before: str | None = None,
    sites: re.Pattern[str] | None = None,
    name: str = "",
) -> tuple[Stance, str]:
    """The complete reading of one citation site: cue tables, then every guard.

    Everything that decides a stance lives here rather than in the caller, because two
    callers now exist. :func:`contexts` reads a paper's LaTeX, and the external
    evaluation reads SciCite and ACL-ARC excerpts, which are plain text with the
    citation marked. If the guards lived in the LaTeX path only, the measured number
    would describe a classifier that never shipped.

    ``marked_before`` is the text before the site with its citation markers still in
    it, and ``sites`` is what a marker looks like there — `\\cite{...}` in LaTeX,
    "[12]" or "@@CITATION" in a corpus excerpt. One guard needs them: a contrastive cue
    is spent on the nearest citation after it, which cannot be checked without knowing
    where the other citations are.
    """
    stance, cue, leading = _decide(before, after)
    if stance is Stance.CONTESTS and _cue_already_taken(
        before if marked_before is None else marked_before, cue, sites
    ):
        stance, cue = Stance.BACKGROUND, ""
    if _without_saying_who(stance, cue, sentence, leading, name):
        stance, cue = Stance.BACKGROUND, ""
    return stance, cue


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


def contexts(
    latex: str,
    sections: tuple[Section, ...],
    cites: dict[str, str] | None = None,
) -> list[CitationContext]:
    """Every citation site in the paper, with what the paper says about it.

    Sections are walked rather than the whole document so each site knows where it
    sits. Where a paper says something matters: a contested citation in related work
    is positioning, and the same citation in the method is a design decision.

    ``cites`` maps a citation key to how it should read in a quotation. It affects only
    the sentence the reader is shown, never what the classifier sees: stance is decided
    on the stripped text either way, so rendering cannot move a reading. Without it,
    "As baselines we chose to use \\cite{mikolov}, and Interpolated KN 5-gram LMs"
    reaches the reader as "we chose to use , and Interpolated KN 5-gram LMs" — a
    sentence the paper does not contain, quoted as if it did.
    """
    out: list[CitationContext] = []
    ordinal = 0
    # Macros expanded first: Chinchilla's source says "We introduce \\chinchilla" and
    # FLAN's says "we call \\flan", so stripping markup without expanding leaves a hole
    # exactly where the paper names itself.
    name = self_name(
        document_title(latex),
        strip_markup(expand_macros(strip_comments(latex), user_macros(latex))),
    )
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
            shown = readable_prose(raw, cites)
            anchor_text = longest_anchorable_run(raw)
            for site in _CITE_SITE.finditer(raw):
                ordinal += 1
                before = strip_markup(raw[: site.start()])
                after = strip_markup(raw[site.end() :])
                stance, cue = read(
                    before, after, sentence,
                    marked_before=raw[: site.start()], name=name,
                )
                for key in _keys(site.group("keys")):
                    out.append(
                        CitationContext(
                            key=key,
                            sentence=sentence,
                            shown=shown,
                            anchor_text=anchor_text,
                            section=section.title,
                            section_kind=section.kind,
                            stance=stance,
                            cue=cue,
                            ordinal=ordinal,
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
        if current is None:
            best[context.key] = context
            continue
        # A more specific stance always wins; among equals keep the earliest mention,
        # so a work's recorded position is where the paper first commits to it.
        if (rank[context.stance], context.ordinal) < (
            rank[current.stance],
            current.ordinal,
        ):
            best[context.key] = context
    return best
