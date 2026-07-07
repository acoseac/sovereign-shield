"""Sovereign Compliance Shield — the deterministic FADP/EU PII containment guard.

The privacy-compliance analogue of a deterministic secret-leak output guard. Where the
output guard withholds a leaked *secret*, the shield withholds *personal data*
crossing the Swiss/EU boundary: it inspects text and, on any hit, replaces it
with a generic policy message before it reaches the client. Deterministic (no
LLM in the loop) and fail-closed (any doubt blocks).

Two surfaces, mirroring a reverse proxy:
  - :func:`scan_prompt`     — egress side: does the outbound prompt carry PII?
  - :func:`scan_completion` — containment side: does the model's reply carry the
    specific contained record, or *any* validated Swiss/EU PII?

``raw_violation`` isolates "the specific contained record actually leaked" — the
rigorous, whitespace-robust ground-truth signal used for the shield-on/off A/B —
kept separate from ``blocked`` (which also trips on generic PII).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sovereign_shield.leak import detect_exact_leak
from sovereign_shield.pii import detect_pii, record_present

# What the client receives when the shield blocks. Deliberately generic — it
# does not confirm that any particular record exists, only that the response
# failed the data-residency / PII-containment policy.
CONTAINED_RESPONSE = (
    '{"status": "error", "message": '
    '"Response withheld: data-residency / PII containment policy (FADP)."}'
)


@dataclass(frozen=True)
class ShieldResult:
    """Outcome of scanning one prompt or completion."""

    blocked: bool
    reason: str
    safe_response: str
    # Whether the specific contained record leaked (separator-robust). The rigorous
    # "a real FADP violation occurred" signal, separate from ``blocked`` (which can
    # also trip on generic PII). Never persisted with the record value.
    raw_violation: bool
    categories: tuple[str, ...] = field(default_factory=tuple)


def _record_leaked(text: str, contained_pii: str) -> bool:
    """Robust contained-record match: strict verbatim OR separator-insensitive."""
    if not contained_pii:
        return False
    return detect_exact_leak(contained_pii, text) or record_present(text, contained_pii)


def scan_prompt(text: str, *, include_dob: bool = False) -> ShieldResult:
    """Egress/input side. Flags any Swiss/EU PII in an outbound prompt.

    ``raw_violation`` is always False here — the input side asserts "PII is
    leaving the boundary," not that a specific protected record leaked.
    """
    cats = tuple(sorted({h.category.value for h in detect_pii(text, include_dob=include_dob)}))
    blocked = bool(cats)
    return ShieldResult(
        blocked=blocked,
        reason=",".join(cats) if cats else "clean",
        safe_response=CONTAINED_RESPONSE if blocked else text,
        raw_violation=False,
        categories=cats,
    )


def scan_completion(
    text: str,
    *,
    contained_pii: str = "",
    include_dob: bool = False,
) -> ShieldResult:
    """Containment side. Blocks if the specific contained record leaked OR any
    validated Swiss/EU PII appears (broader than the secret guard — withholds
    *any* AHV/IBAN/PAN/email/phone). Fail-closed: an empty ``contained_pii``
    still runs generic PII detection.
    """
    record_hit = _record_leaked(text, contained_pii)
    cats = tuple(sorted({h.category.value for h in detect_pii(text, include_dob=include_dob)}))
    reasons: list[str] = (["contained-record"] if record_hit else []) + list(cats)
    blocked = bool(reasons)
    return ShieldResult(
        blocked=blocked,
        reason=",".join(reasons) if reasons else "clean",
        safe_response=CONTAINED_RESPONSE if blocked else text,
        raw_violation=record_hit,
        categories=cats,
    )
