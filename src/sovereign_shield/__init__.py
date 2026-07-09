"""Sovereign Shield — a deterministic, offline Swiss/EU (FADP/GDPR) PII gateway.

Detect and reversibly tokenize Swiss/EU personal data so a workflow can use any
cloud LLM without the real identifiers ever leaving your jurisdiction:

    from sovereign_shield import SovereignShield

    shield = SovereignShield()
    safe, ctx = shield.sanitize("AHV 756.1234.5678.97, IBAN CH9300762011623852957")
    #   safe -> "AHV [AHV_1], IBAN [IBAN_1]"
    answer = call_any_llm(safe)                 # the model only sees placeholders
    final = shield.rehydrate(answer, ctx).text  # real values restored, on-shore

The detection core is stdlib-only (regex + checksums: AHV via EAN-13, IBAN via
ISO-7064 mod-97, card via Luhn) and deterministic — it cannot be talked out of a
match. The optional LangChain proxy lives in :mod:`sovereign_shield.gateway`
(``pip install "sovereign-shield-ch[gateway]"``).

Not legal advice; not a guarantee of FADP/GDPR compliance. See the README.
"""

from sovereign_shield.core import (
    CATEGORY_LABELS,
    DataLeakError,
    Entity,
    RehydrateResult,
    SessionContext,
    SovereignShield,
    SpanDetector,
)
from sovereign_shield.leak import detect_exact_leak
from sovereign_shield.pii import (
    PiiCategory,
    PiiHit,
    detect_pii,
    record_present,
    redact_pii,
)
from sovereign_shield.shield import (
    CONTAINED_RESPONSE,
    ShieldResult,
    scan_completion,
    scan_prompt,
)

__version__ = "0.2.0"

__all__ = [
    "CATEGORY_LABELS",
    "CONTAINED_RESPONSE",
    "DataLeakError",
    "Entity",
    "PiiCategory",
    "PiiHit",
    "RehydrateResult",
    "SessionContext",
    "ShieldResult",
    "SovereignShield",
    "SpanDetector",
    "__version__",
    "detect_exact_leak",
    "detect_pii",
    "record_present",
    "redact_pii",
    "scan_completion",
    "scan_prompt",
]
