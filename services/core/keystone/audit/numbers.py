"""Finding and parsing numbers in paper text.

Everything the audit engine does rests on reading numbers correctly, and one property
matters more than the value itself: **reported precision must survive parsing**. "94.2"
and "94.20" are the same quantity but not the same claim, and two checks depend on
telling them apart:

* GRIM asks whether a mean reported to *this many decimal places* is achievable at a
  given sample size. Read 94.2 as a float and the check becomes meaningless.
* statcheck recomputes a p-value and compares it against the reported one *at the
  reported precision*. "p = .03" agrees with a recomputed .0251; "p = .0300" does not.

So values are ``Decimal``, every token keeps the exact source text it came from, and
precision is carried as an absolute :attr:`Number.quantum` rather than a decimal-place
count — because a count stops meaning anything once a magnitude suffix or an exponent
is involved. "1.5B" is written to one decimal place but is only precise to 10^8.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# Unicode minus, en dash, and the two hyphen variants all appear as negation in
# typeset papers; which one a PDF yields depends on the font. Kept separate from the
# character class, where a literal hyphen must come first or it forms a range.
_MINUS_SIGNS = "−–‐‑-"
_SIGN_CLASS = "[-+−–‐‑]"

_NUMBER = re.compile(
    rf"""
    # A sign is only a sign when nothing runs into it. "CIFAR-100" is a dataset, not
    # negative one hundred, and "16--19" is a range, not minus nineteen. Both were
    # being read as measurements and carried into the coverage map as unverifiable
    # claims.
    (?:(?<![A-Za-z0-9\-\u2212\u2013\u2010\u2011])(?P<sign>{_SIGN_CLASS})\s?)?
    (?P<mantissa>
        \d{{1,3}}(?:,\d{{3}})+(?:\.\d+)?   # 1,234.5
      | \d+\.\d+                            # 94.2
      | \.\d+                               # .03  — the psychology convention
      | \d+                                 # 42
    )
    (?:                                     # 1.5e-3, 3 × 10^{{-4}}, 2*10**8
        \s*(?:[eE]|[×x⋅*]\s*10)\s*(?:\^|\*\*)?\s*
        (?:\{{\s*(?P<braced>{_SIGN_CLASS}?\d+)\s*\}}|(?P<exponent>{_SIGN_CLASS}?\d+))
    )?
    """,
    re.VERBOSE,
)

_PERCENT = re.compile(r"\s*(?:%|percent\b|per\s+cent\b)", re.IGNORECASE)

_ARXIV_ID = re.compile(r"\d{4}\.\d{4,5}")

# Units worth recognising in ML/CS papers. Deliberately short: a wrongly assigned unit
# is worse than no unit, since the dimension check only fires on units it is sure of.
#
# Split by what the unit *means*, because that decides whether a number is a claim the
# paper must evidence or a detail of how it was run. "28.4 BLEU" is the result; "3.5
# days" is the hardware budget. Treating a metric as configuration excludes exactly the
# numbers a coverage map exists to track.
METRIC_UNITS = frozenset({"BLEU", "ROUGE", "METEOR", "CIDEr", "mAP", "AUC", "PPL", "WER", "CER"})

CONFIG_UNITS = frozenset({
    "GB", "MB", "KB", "TB", "GiB", "MiB", "PFLOPs", "TFLOPs", "FLOPs", "FLOP",
    "GPU-hours", "GPU-days", "hours", "hour", "minutes", "minute", "seconds",
    "second", "ms", "days", "day", "epochs", "epoch", "steps", "tokens",
    "parameters", "parameter", "params", "layers", "layer", "heads", "head",
    "px", "GPUs", "GPU", "TPUs", "TPU", "examples", "prompts", "labelers",
})

_UNITS = tuple(sorted(METRIC_UNITS | CONFIG_UNITS, key=len, reverse=True))
_UNIT = re.compile(r"[ \t]*(?P<scale>[KMBT])?[ \t]*(?P<unit>" + "|".join(_UNITS) + r")\b")
_MAGNITUDE_SUFFIX = re.compile(r"(?P<scale>[KMBT])\b")

_SCALES = {
    "K": Decimal(10) ** 3,
    "M": Decimal(10) ** 6,
    "B": Decimal(10) ** 9,
    "T": Decimal(10) ** 12,
}


@dataclass(frozen=True, slots=True)
class Number:
    """One number as written, with everything needed to reason about it later."""

    value: Decimal
    raw: str  # exactly the source text, for quoting back inside a finding
    start: int
    end: int
    decimals: int  # decimal places written in the mantissa — GRIM depends on this
    quantum: Decimal  # absolute precision of the written form, after any scaling
    is_percent: bool = False
    unit: str | None = None

    @property
    def as_fraction(self) -> Decimal:
        """Value on a 0–1 scale when a percent, so 94.2% and 0.942 compare directly."""
        return self.value / 100 if self.is_percent else self.value

    @property
    def tolerance(self) -> Decimal:
        """Half the last written digit's place value, in :attr:`as_fraction` scale.

        An author writing 94.2 has stated the true value lies within 0.05 of it. Every
        numeric check compares against this rather than testing equality, because a
        rounded report is not a wrong report.
        """
        half = self.quantum / 2
        return half / 100 if self.is_percent else half

    def __str__(self) -> str:
        return self.raw


def parse_decimal(text: str) -> Decimal | None:
    """Parse one numeric literal, tolerating typeset minus signs and separators."""
    cleaned = text.strip().replace(",", "").replace(" ", "")
    for character in _MINUS_SIGNS:
        if character != "-":
            cleaned = cleaned.replace(character, "-")
    if cleaned.startswith("."):
        cleaned = "0" + cleaned
    elif cleaned.startswith("-."):
        cleaned = "-0" + cleaned[1:]
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def find_numbers(text: str, *, skip_years: bool = True) -> list[Number]:
    """Every number in a span of text, in order.

    ``skip_years`` drops bare four-digit years in the 1900–2099 range. Papers are full
    of citation years, and a check treating "2017" as a measurement produces noise that
    buries its real findings. A year carrying a unit or a percent sign is kept, since
    that is no longer a year.
    """
    out: list[Number] = []
    for match in _NUMBER.finditer(text):
        mantissa = match.group("mantissa")
        value = parse_decimal(mantissa)
        if value is None:
            continue

        sign = match.group("sign")
        if sign is not None and sign in _MINUS_SIGNS:
            value = -value

        _, _, fraction = mantissa.partition(".")
        decimals = len(fraction)
        quantum = Decimal(1).scaleb(-decimals)

        written = match.group("braced") or match.group("exponent")
        if written is not None:
            power = parse_decimal(written)
            if power is not None:
                factor = Decimal(10) ** power
                value *= factor
                quantum *= factor

        end = match.end()
        is_percent = False
        unit: str | None = None

        if percent := _PERCENT.match(text, end):
            is_percent = True
            end = percent.end()
        elif measured := _UNIT.match(text, end):
            unit = measured.group("unit")
            if measured.group("scale"):
                factor = _SCALES[measured.group("scale")]
                value *= factor
                quantum *= factor
            end = measured.end()
        elif scaled := _MAGNITUDE_SUFFIX.match(text, end):
            factor = _SCALES[scaled.group("scale")]
            value *= factor
            quantum *= factor
            end = scaled.end()

        # An arXiv identifier has the shape of a decimal and none of the meaning.
        # Left in, a bibliography turns into dozens of unverifiable "claims".
        if _ARXIV_ID.fullmatch(mantissa):
            continue

        if (
            skip_years
            and not is_percent
            and unit is None
            and decimals == 0
            and len(mantissa) == 4
            and 1900 <= value <= 2099
        ):
            continue

        out.append(
            Number(
                value=value,
                raw=text[match.start() : end],
                start=match.start(),
                end=end,
                decimals=decimals,
                quantum=quantum,
                is_percent=is_percent,
                unit=unit,
            )
        )
    return out


def same_quantity(
    a: Number, b: Number, *, relative_tolerance: Decimal = Decimal("1e-9")
) -> bool:
    """Whether two numbers denote the same quantity, accounting for percent scaling.

    A bare 0.942 and a written 94.2% are one measurement reported two ways; flagging
    them as a discrepancy would be wrong. Comparison is relative, so it behaves the
    same at 0.0001 as at 10^9.
    """
    left, right = a.as_fraction, b.as_fraction
    if left == right:
        return True
    scale = max(abs(left), abs(right))
    if scale == 0:
        return False
    return abs(left - right) / scale <= relative_tolerance


def rounds_to(exact: Decimal, reported: Number) -> bool:
    """Whether an exact value agrees with what was reported, at its written precision.

    ``exact`` is compared in :attr:`Number.as_fraction` scale, so a percent report is
    handled without the caller having to know it is one.
    """
    return abs(exact - reported.as_fraction) <= reported.tolerance
