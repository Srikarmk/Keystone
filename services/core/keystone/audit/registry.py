"""Check registration and the runner.

A check is a pure function from a :class:`Paper` to findings. No I/O, no model, no
shared state — which is what lets every one of them be unit-tested against a
hand-built fixture, and what lets the whole suite run in milliseconds for free.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass

from keystone.graph.models import Finding, Paper, Severity

CheckFunction = Callable[[Paper], Iterator[Finding]]

_SEVERITY_ORDER = {Severity.HIGH: 0, Severity.MEDIUM: 1, Severity.LOW: 2, Severity.NOTE: 3}


@dataclass(frozen=True, slots=True)
class Check:
    id: str
    title: str
    description: str
    function: CheckFunction
    deterministic: bool
    """True when the verdict comes from arithmetic alone.

    Deterministic checks cost nothing and run in seconds, which is what makes a free
    exact triage possible rather than a cheap approximate one. Tracked explicitly so
    the triage stage can select on it instead of on a hand-maintained list.
    """


_REGISTRY: dict[str, Check] = {}


def check(
    check_id: str, title: str, *, description: str = "", deterministic: bool = True
) -> Callable[[CheckFunction], CheckFunction]:
    """Register a check. Ids must be unique; a clash is a programming error."""

    def register(function: CheckFunction) -> CheckFunction:
        if check_id in _REGISTRY:
            raise ValueError(f"duplicate check id: {check_id}")
        _REGISTRY[check_id] = Check(
            id=check_id,
            title=title,
            description=description or (function.__doc__ or "").strip().split("\n")[0],
            function=function,
            deterministic=deterministic,
        )
        return function

    return register


def registered(*, deterministic_only: bool = False) -> tuple[Check, ...]:
    checks = sorted(_REGISTRY.values(), key=lambda c: c.id)
    if deterministic_only:
        checks = [c for c in checks if c.deterministic]
    return tuple(checks)


def run(paper: Paper, *, checks: Iterable[Check] | None = None) -> list[Finding]:
    """Run checks over a paper, most severe first.

    A check that raises is a bug in that check, not a finding about the paper, so it
    is allowed to propagate rather than being swallowed into a misleading clean bill.
    """
    selected = tuple(checks) if checks is not None else registered()
    findings = [finding for c in selected for finding in c.function(paper)]
    findings.sort(key=lambda f: (_SEVERITY_ORDER[f.severity], f.check_id))
    return findings
