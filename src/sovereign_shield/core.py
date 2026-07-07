"""Sovereign Shield — the tokenize → call → rehydrate round-trip engine.

The deterministic detectors in :mod:`sovereign_shield.pii` say *where* the Swiss/EU
personal data is; this module turns that into a reversible boundary you can wrap
around any cloud LLM:

    shield = SovereignShield()
    safe, ctx = shield.sanitize(raw_prompt)   # real values -> [AHV_1], [IBAN_1], ...
    answer = call_any_llm(safe)               # the model only ever sees placeholders
    result = shield.rehydrate(answer, ctx)    # placeholders -> real values, on-shore

``sanitize`` is fail-closed: if any structured identifier would survive into the
outbound text it raises :class:`DataLeakError` rather than leak. ``rehydrate`` is
strict and deterministic — bracketed tokens self-delimit (``[AHV_1]`` is not a
substring of ``[AHV_11]``) — and it reports any placeholder a model mangled, so a
caller never ships a broken ``[AHV_1`` to a user.

Scope: **structured identifiers only** (AHV, IBAN, card, phone, email) — the same
deterministic core the browser demo runs. Person names and street addresses need
an NER model; plug one via ``extra_detectors`` (see :class:`SpanDetector`). None
ships here: a half-built local NER would forfeit the zero-dependency, deterministic
guarantee this library exists to provide.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Protocol

from sovereign_shield.pii import detect_pii
from sovereign_shield.shield import ShieldResult
from sovereign_shield.shield import scan_completion as _scan_completion
from sovereign_shield.shield import scan_prompt as _scan_prompt

__all__ = [
    "CATEGORY_LABELS",
    "DataLeakError",
    "Entity",
    "RehydrateResult",
    "SessionContext",
    "SovereignShield",
    "SpanDetector",
]

# Placeholder prefixes — identical to the browser demo's scheme (web/lib/gateway.ts),
# so a Python sanitize() and the TypeScript tokenizeText() mint the same tokens.
_TOKEN_PREFIX: dict[str, str] = {
    "name": "PERSON",
    "address": "ADDRESS",
    "ch_ahv": "AHV",
    "iban": "IBAN",
    "ch_phone": "PHONE",
    "email": "EMAIL",
    "credit_card": "CARD",
}

# Human labels for a data-protection (DPO) audit line.
CATEGORY_LABELS: dict[str, str] = {
    "name": "Name",
    "address": "Address",
    "ch_ahv": "AHV / AVS no.",
    "iban": "IBAN",
    "ch_phone": "Phone",
    "email": "Email",
    "credit_card": "Card",
}

# Placeholder shape, e.g. [AHV_1] — used to spot tokens a model mangled or invented.
_TOKEN_RE = re.compile(r"\[[A-Z]+_\d+\]")


class DataLeakError(RuntimeError):
    """Raised when raw PII would survive sanitization — fail-closed, never leak."""


class SpanDetector(Protocol):
    """A pluggable detector: given text, yield ``(start, end, category)`` spans.

    Lets a caller add entity types the deterministic core does not cover — most
    commonly an NER model for person names / addresses. A span overlapping a
    higher-priority structured hit is dropped (fail-closed).
    """

    def __call__(self, text: str) -> Iterable[tuple[int, int, str]]: ...


@dataclass(frozen=True)
class Entity:
    """One redacted span: its position, category, stable placeholder, and — held
    only in the in-process :class:`SessionContext` — the real value to restore."""

    start: int
    end: int
    category: str
    token: str
    value: str


@dataclass(frozen=True)
class SessionContext:
    """The token↔value map for one :meth:`SovereignShield.sanitize` call.

    Keep it in-jurisdiction: it is all that is needed to restore the real values,
    and it never has to cross the border.
    """

    entities: tuple[Entity, ...] = ()

    @property
    def total(self) -> int:
        return len(self.entities)

    def audit(self) -> dict[str, int]:
        """Per-category counts of what was kept on-shore (the DPO audit line)."""
        counts: dict[str, int] = {}
        for e in self.entities:
            counts[e.category] = counts.get(e.category, 0) + 1
        return counts


@dataclass(frozen=True)
class RehydrateResult:
    """Restored text plus a cleanliness report. ``str(result)`` yields the text."""

    text: str
    leftover: tuple[str, ...] = ()

    @property
    def clean(self) -> bool:
        """True iff no placeholder-shaped token remained after restoration."""
        return not self.leftover

    def __str__(self) -> str:
        return self.text


class SovereignShield:
    """Stateless tokenize/detokenize engine over the deterministic detectors.

    Holds only configuration, so one instance is safe to share across threads:
    every :meth:`sanitize` returns a fresh :class:`SessionContext` and nothing is
    mutated in place.
    """

    def __init__(
        self,
        *,
        include_dob: bool = False,
        extra_detectors: Sequence[SpanDetector] = (),
    ) -> None:
        self.include_dob = include_dob
        self._extra: tuple[SpanDetector, ...] = tuple(extra_detectors)

    def _spans(self, text: str) -> list[tuple[int, int, str]]:
        """Collect non-overlapping ``(start, end, category)`` spans, structured first."""
        accepted: list[tuple[int, int, str]] = []
        occupied: list[tuple[int, int]] = []

        def free(s: int, e: int) -> bool:
            return not any(s < oe and os < e for os, oe in occupied)

        # Structured identifiers win (detect_pii is already internally non-overlapping).
        for h in detect_pii(text, include_dob=self.include_dob):
            if free(h.start, h.end):
                accepted.append((h.start, h.end, h.category.value))
                occupied.append((h.start, h.end))
        # Then any pluggable detectors (e.g. an NER for names), dropping overlaps.
        for det in self._extra:
            for start, end, category in det(text):
                if 0 <= start < end <= len(text) and free(start, end):
                    accepted.append((start, end, category))
                    occupied.append((start, end))
        accepted.sort(key=lambda s: s[0])
        return accepted

    def sanitize(self, text: str) -> tuple[str, SessionContext]:
        """Replace every detected identifier with a stable placeholder.

        Returns the border-safe text and the :class:`SessionContext` needed to
        restore it. Same value ⇒ same token. Fail-closed: raises
        :class:`DataLeakError` if any raw value would survive into the output.
        """
        entities: list[Entity] = []
        value_token: dict[str, str] = {}
        counters: dict[str, int] = {}
        for start, end, category in self._spans(text):
            value = text[start:end]
            token = value_token.get(value)
            if token is None:
                prefix = _TOKEN_PREFIX.get(category, category.upper())
                counters[prefix] = counters.get(prefix, 0) + 1
                token = f"[{prefix}_{counters[prefix]}]"
                value_token[value] = token
            entities.append(
                Entity(start=start, end=end, category=category, token=token, value=value)
            )

        # Replace back-to-front so earlier spans keep their offsets.
        sanitized = text
        for e in sorted(entities, key=lambda x: x.start, reverse=True):
            sanitized = sanitized[: e.start] + e.token + sanitized[e.end :]

        # Fail-closed egress guards — a real exception, never a bare `assert`
        # (asserts are stripped under `python -O`, and this must always run).
        residual = detect_pii(sanitized, include_dob=self.include_dob)
        if residual:
            cats = ",".join(sorted({h.category.value for h in residual}))
            raise DataLeakError(f"structured PII survived sanitization: {cats}")
        for e in entities:
            if e.value and e.value in sanitized:
                raise DataLeakError(f"raw value survived sanitization (category={e.category})")

        return sanitized, SessionContext(entities=tuple(entities))

    def rehydrate(self, text: str, context: SessionContext) -> RehydrateResult:
        """Restore real values by swapping placeholders back (strict, deterministic).

        Reports any placeholder-shaped token still present afterwards — the signal
        that a model mangled or invented a token — so a caller never delivers a
        broken ``[AHV_1`` to the user.
        """
        out = text
        for e in context.entities:
            out = out.replace(e.token, e.value)
        leftover = tuple(dict.fromkeys(_TOKEN_RE.findall(out)))  # unique, order-preserving
        return RehydrateResult(text=out, leftover=leftover)

    # Deterministic block-or-pass guard, honouring this shield's `include_dob`.
    def scan_prompt(self, text: str) -> ShieldResult:
        """Egress scan: flag any Swiss/EU PII in an outbound prompt."""
        return _scan_prompt(text, include_dob=self.include_dob)

    def scan_completion(self, text: str, *, contained_pii: str = "") -> ShieldResult:
        """Containment scan: block a reply carrying the contained record or any PII."""
        return _scan_completion(text, contained_pii=contained_pii, include_dob=self.include_dob)
