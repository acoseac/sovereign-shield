"""Deterministic, offline Swiss/EU PII detection.

This module is the compliance-shield counterpart to :mod:`sovereign_shield.leak`: tiny,
dependency-free (stdlib ``re`` only), and deterministic. It exists because the
FADP / EU data-protection boundary — like a leaked secret — cannot be trusted
to a model's own judgement, and an ML NER model (Presidio/spaCy) would be
non-deterministic, heavy, and inherit the same social-engineering blind spots
that let an LLM judge miss a plain-sight leak (ADR 0013). A regex + checksum
scanner cannot be talked out of a match.

Each detector is a two-stage *shape then verify* pipeline: a cheap regex finds
candidate spans, then a checksum (EAN-13 for AHV, ISO-7064 mod-97 for IBAN,
Luhn for card PANs) rejects look-alikes so the fail-closed containment breaker
does not trip on every random 13-digit string. The check digit math always runs
on the separator-stripped value, so ``756.1234.5678.97`` and ``756 1234 5678 97``
validate identically.

A :class:`PiiHit` never carries the raw matched value — only a *masked* marker
(e.g. ``756.XXXX.XXXX.97``) safe to log or persist, mirroring a strict
log/artifact redaction discipline. Callers that
need the raw span for record comparison use the private :func:`_detect_raw`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


class PiiCategory(StrEnum):
    """The kinds of personal data the shield recognises."""

    AHV_AVS = "ch_ahv"  # Swiss social-security number (AHV/AVS)
    IBAN = "iban"  # CH/LI bank account
    PHONE_CH = "ch_phone"
    EMAIL = "email"
    CREDIT_CARD = "credit_card"  # PAN, Luhn-validated
    IT_CF = "it_cf"  # Italian Codice Fiscale
    ES_DNI = "es_dni"  # Spanish DNI / NIE
    FR_NIR = "fr_nir"  # French NIR (INSEE social-security no.)
    NL_BSN = "nl_bsn"  # Dutch BSN (burgerservicenummer)
    DOB = "dob"  # date of birth — off by default (high false-positive)


@dataclass(frozen=True)
class PiiHit:
    """One detector hit.

    ``marker`` is a masked, non-identifying rendering of the match (safe to log
    and persist); the raw value is deliberately not retained. ``start``/``end``
    are the span in the scanned text so a caller can redact in place.
    """

    category: PiiCategory
    marker: str
    start: int
    end: int


# --------------------------------------------------------------------------- #
# checksums — the false-positive filter. Each strips separators first.
# --------------------------------------------------------------------------- #
def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def _ean13_ok(value: str) -> bool:
    """Validate the EAN-13 / GTIN check digit used by the 13-digit AHV number.

    Weights alternate 1,3,1,3,… over the first 12 digits (left→right); the
    check digit is ``(10 - (sum % 10)) % 10``.
    """
    d = _digits(value)
    if len(d) != 13:
        return False
    s = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(d[:12]))
    return (10 - (s % 10)) % 10 == int(d[12])


def _iban_mod97_ok(value: str) -> bool:
    """ISO 7064 mod-97-10: move the first four chars to the end, map letters
    A-Z to 10-35, interpret as an integer, valid iff ``mod 97 == 1``."""
    iban = re.sub(r"[^0-9A-Za-z]", "", value).upper()
    if len(iban) < 5:
        return False
    rearranged = iban[4:] + iban[:4]
    try:
        digits = "".join(str(int(c, 36)) if c.isalpha() else c for c in rearranged)
        return int(digits) % 97 == 1
    except ValueError:
        return False


def _luhn_ok(value: str) -> bool:
    d = _digits(value)
    if not (13 <= len(d) <= 19):
        return False
    total, parity = 0, len(d) % 2
    for i, ch in enumerate(d):
        n = int(ch)
        if i % 2 == parity:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


# ISO 13616 IBAN length per country (total chars) — paired with mod-97 so a random
# "XX00…" that happens to pass the modulus is still rejected on country + length.
_IBAN_LEN: dict[str, int] = {
    "AD": 24, "AE": 23, "AL": 28, "AT": 20, "AZ": 28, "BA": 20, "BE": 16, "BG": 22,
    "BH": 22, "BR": 29, "BY": 28, "CH": 21, "CR": 22, "CY": 28, "CZ": 24, "DE": 22,
    "DK": 18, "DO": 28, "EE": 20, "EG": 29, "ES": 24, "FI": 18, "FO": 18, "FR": 27,
    "GB": 22, "GE": 22, "GI": 23, "GL": 18, "GR": 27, "GT": 28, "HR": 21, "HU": 28,
    "IE": 22, "IL": 23, "IS": 26, "IT": 27, "JO": 30, "KW": 30, "KZ": 20, "LB": 28,
    "LC": 32, "LI": 21, "LT": 20, "LU": 20, "LV": 21, "MC": 27, "MD": 24, "ME": 22,
    "MK": 19, "MR": 27, "MT": 31, "MU": 30, "NL": 18, "NO": 15, "PK": 24, "PL": 28,
    "PS": 29, "PT": 25, "QA": 29, "RO": 24, "RS": 22, "SA": 24, "SC": 31, "SE": 24,
    "SI": 19, "SK": 24, "SM": 27, "TL": 23, "TN": 24, "TR": 26, "UA": 29, "VA": 22,
    "VG": 24, "XK": 20,
}  # fmt: skip


def _iban_ok(value: str) -> bool:
    """IBAN: a known country code, that country's exact length, and ISO-7064 mod-97."""
    iban = re.sub(r"[^0-9A-Za-z]", "", value).upper()
    if len(iban) != _IBAN_LEN.get(iban[:2], -1):
        return False
    return _iban_mod97_ok(iban)


_DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"


def _es_dni_ok(value: str) -> bool:
    """Spanish DNI/NIE: an 8-digit body (NIE prefix X/Y/Z → 0/1/2) plus a mod-23 letter."""
    s = re.sub(r"[^0-9A-Za-z]", "", value).upper()
    m = re.fullmatch(r"([XYZ]?)(\d{7,8})([A-Z])", s)
    if not m:
        return False
    prefix, digits, letter = m.groups()
    if prefix and len(digits) != 7:
        return False
    if not prefix and len(digits) != 8:
        return False
    num = int((str("XYZ".index(prefix)) if prefix else "") + digits)
    return _DNI_LETTERS[num % 23] == letter


def _fr_nir_ok(value: str) -> bool:
    """French NIR / INSEE: 13-char body + a 2-digit key = 97 - (body mod 97).

    Corsica departments 2A / 2B are substituted with 19 / 18 before the modulus.
    """
    s = re.sub(r"[^0-9A-Za-z]", "", value).upper()
    if len(s) != 15 or s[0] not in "12" or not s[13:].isdigit():
        return False
    body = s[:13].replace("2A", "19").replace("2B", "18")
    if not body.isdigit():
        return False
    return 97 - int(body) % 97 == int(s[13:])


# Codice Fiscale odd/even position conversion tables (1-indexed odd positions use _CF_ODD).
_CF_ODD: dict[str, int] = {
    "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
    "A": 1, "B": 0, "C": 5, "D": 7, "E": 9, "F": 13, "G": 15, "H": 17, "I": 19, "J": 21,
    "K": 2, "L": 4, "M": 18, "N": 20, "O": 11, "P": 3, "Q": 6, "R": 8, "S": 12, "T": 14,
    "U": 16, "V": 10, "W": 22, "X": 25, "Y": 24, "Z": 23,
}  # fmt: skip


def _cf_even(c: str) -> int:
    return int(c) if c.isdigit() else ord(c) - ord("A")


def _it_cf_ok(value: str) -> bool:
    """Italian Codice Fiscale: 16 alphanumerics; the final char is a mod-26 check letter
    over the first 15 (odd-position and even-position conversion tables)."""
    s = re.sub(r"[^0-9A-Za-z]", "", value).upper()
    if not re.fullmatch(r"[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]", s):
        return False
    total = sum(_CF_ODD[c] if i % 2 == 0 else _cf_even(c) for i, c in enumerate(s[:15]))
    return chr(ord("A") + total % 26) == s[15]


def _nl_bsn_ok(value: str) -> bool:
    """Dutch BSN: 9 digits, '11-proef' — weighted sum (last digit weight -1) is 0 (mod 11)."""
    d = _digits(value)
    if len(d) != 9 or d == "0" * 9:
        return False
    total = sum(int(c) * w for c, w in zip(d, (9, 8, 7, 6, 5, 4, 3, 2, -1), strict=True))
    return total % 11 == 0


def _norm_record(s: str) -> str:
    """Whitespace/separator-robust comparator: keep only alphanumerics, upper.

    So ``756.1234.5678.97`` and ``756 1234 5678 97`` compare equal — the fix for
    the strict, separator-sensitive :func:`sovereign_shield.leak.detect_exact_leak`.
    """
    return re.sub(r"[^0-9A-Za-z]", "", s).upper()


# --------------------------------------------------------------------------- #
# shape regexes. Ordered by priority in _detect_raw (specific/validated first).
# --------------------------------------------------------------------------- #
# AHV/AVS: prefix 756, dotted/spaced (incl. non-breaking space) or bare 13-digit.
_AHV_RE = re.compile(r"\b756[.\u00a0 ]?\d{4}[.\u00a0 ]?\d{4}[.\u00a0 ]?\d{2}\b")
# IBAN: any country + check digits, then compact or grouped in 4s (so a following word
# can't be swallowed into the match); verified by country length + mod-97.
_IBAN_RE = re.compile(
    r"\b[A-Z]{2}\d{2}(?:[0-9A-Z]{11,30}|(?: [0-9A-Z]{4}){2,7}(?: [0-9A-Z]{1,3})?)\b",
    re.IGNORECASE,
)
# Card PAN: 13-19 digits with optional space/dash grouping.
_PAN_RE = re.compile(r"\b\d(?:[ -]?\d){12,18}\b")
# Swiss phone: +41 / 0041 / national 0, then 9 significant digits.
_PHONE_CH_RE = re.compile(r"(?<!\d)(?:\+41|0041|0)(?:[ .]?\d){9}(?!\d)")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
# DOB: dd?[./-]mm?[./-](19|20)yy. High false-positive → gated off by default.
_DOB_RE = re.compile(r"\b(?:0?[1-9]|[12]\d|3[01])[.\-/](?:0?[1-9]|1[0-2])[.\-/](?:19|20)\d{2}\b")
# Spanish DNI (8 digits) / NIE (X/Y/Z + 7 digits), each closed by a mod-23 check letter.
_ES_DNI_RE = re.compile(r"\b[XYZ]?\d{7,8}[A-Z]\b", re.IGNORECASE)
# French NIR / INSEE: 15 chars (Corsica department 2A/2B allowed), spacing tolerated.
_FR_NIR_RE = re.compile(
    r"\b[12][ ]?\d{2}[ ]?\d{2}[ ]?(?:\d{2}|2[AB])[ ]?\d{3}[ ]?\d{3}[ ]?\d{2}\b", re.IGNORECASE
)
# Italian Codice Fiscale: 16 alphanumerics in the standard (non-omocodia) shape.
_IT_CF_RE = re.compile(r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b", re.IGNORECASE)
# Dutch BSN: 9 bare digits (validated by the 11-test — the false-positive filter).
_NL_BSN_RE = re.compile(r"\b\d{9}\b")


def _mask(raw: str, category: PiiCategory) -> str:
    """Render a non-identifying marker (safe to log/persist)."""
    if category is PiiCategory.AHV_AVS:
        d = _digits(raw)
        return f"756.XXXX.XXXX.{d[-2:]}" if len(d) == 13 else "756.XXXX.XXXX.XX"
    if category is PiiCategory.IBAN:
        norm = _norm_record(raw)
        return f"{norm[:2]}…{norm[-2:]} ({len(norm)})"
    if category is PiiCategory.CREDIT_CARD:
        return f"card:…{_digits(raw)[-4:]}"
    if category is PiiCategory.PHONE_CH:
        d = _digits(raw)
        return f"phone:…{d[-2:]}"
    if category is PiiCategory.EMAIL:
        local, _, domain = raw.partition("@")
        head = local[:1] if local else ""
        return f"{head}***@{domain}"
    if category is PiiCategory.IT_CF:
        return f"cf:…{_norm_record(raw)[-2:]}"
    if category is PiiCategory.ES_DNI:
        return f"dni:…{_norm_record(raw)[-2:]}"
    if category is PiiCategory.FR_NIR:
        return f"nir:…{_digits(raw)[-2:]}"
    if category is PiiCategory.NL_BSN:
        return f"bsn:…{_digits(raw)[-2:]}"
    return "dob:XXXX-XX-XX"


# (category, compiled regex, validator or None) in priority order.
_DETECTORS: list[tuple[PiiCategory, re.Pattern[str], object]] = [
    (PiiCategory.AHV_AVS, _AHV_RE, _ean13_ok),
    (PiiCategory.IBAN, _IBAN_RE, _iban_ok),
    (PiiCategory.IT_CF, _IT_CF_RE, _it_cf_ok),
    (PiiCategory.ES_DNI, _ES_DNI_RE, _es_dni_ok),
    (PiiCategory.FR_NIR, _FR_NIR_RE, _fr_nir_ok),
    (PiiCategory.PHONE_CH, _PHONE_CH_RE, None),
    (PiiCategory.EMAIL, _EMAIL_RE, None),
    (PiiCategory.CREDIT_CARD, _PAN_RE, _luhn_ok),
    (PiiCategory.NL_BSN, _NL_BSN_RE, _nl_bsn_ok),
]


def _detect_raw(text: str, *, include_dob: bool = False) -> list[tuple[PiiCategory, str, int, int]]:
    """Internal: return validated (category, raw_match, start, end) tuples.

    Detectors run in priority order; a hit whose span overlaps an
    already-accepted higher-priority hit is dropped (so a 13-digit AHV that also
    happens to pass Luhn is reported as ``ch_ahv``, not ``credit_card``). The raw
    match is returned only for in-process comparison — never persisted.
    """
    detectors = list(_DETECTORS)
    if include_dob:
        detectors.append((PiiCategory.DOB, _DOB_RE, None))

    accepted: list[tuple[PiiCategory, str, int, int]] = []
    spans: list[tuple[int, int]] = []
    for category, pattern, validator in detectors:
        for m in pattern.finditer(text):
            if validator is not None and not validator(m.group(0)):  # type: ignore[operator]
                continue
            start, end = m.start(), m.end()
            if any(start < s_end and s_start < end for s_start, s_end in spans):
                continue  # overlaps a higher-priority hit
            accepted.append((category, m.group(0), start, end))
            spans.append((start, end))
    accepted.sort(key=lambda h: h[2])
    return accepted


def detect_pii(text: str, *, include_dob: bool = False) -> list[PiiHit]:
    """Scan ``text`` for Swiss/EU PII. Returns masked hits only — no raw PII.

    Deterministic and offline. ``include_dob`` enables date-of-birth matching,
    off by default because bare dates (invoices, expiries) false-positive.
    """
    return [
        PiiHit(category=cat, marker=_mask(raw, cat), start=start, end=end)
        for cat, raw, start, end in _detect_raw(text, include_dob=include_dob)
    ]


def record_present(text: str, record: str) -> bool:
    """True iff ``record`` appears in ``text`` separator-insensitively.

    Complements :func:`sovereign_shield.leak.detect_exact_leak` (which is whitespace-strict):
    a validated structured span (AHV/IBAN/PAN) whose separator-stripped form
    equals the stripped ``record`` counts as present, so ``756 1234 5678 97``
    matches a contained ``756.1234.5678.97``. Comparison is in-process only; no
    raw value is returned.
    """
    if not record:
        return False
    target = _norm_record(record)
    return any(_norm_record(raw) == target for _, raw, _, _ in _detect_raw(text))


def redact_pii(text: str, *, include_dob: bool = False) -> str:
    """Return ``text`` with every detected PII span replaced by its masked marker.

    A no-op on text with no PII (e.g. a synthetic license key), so it is safe to
    apply unconditionally to artifact fields — it only masks what is actually PII.
    """
    hits = detect_pii(text, include_dob=include_dob)
    out = text
    for h in sorted(hits, key=lambda x: x.start, reverse=True):
        out = out[: h.start] + h.marker + out[h.end :]
    return out
