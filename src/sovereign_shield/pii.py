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

import base64
import json
import re
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise


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
    DE_STEUERID = "de_steuerid"  # German tax ID (Steuer-IdNr)
    PL_PESEL = "pl_pesel"  # Polish PESEL
    PT_NIF = "pt_nif"  # Portuguese NIF (tax)
    BE_NRN = "be_nrn"  # Belgian National Register Number
    UK_NHS = "uk_nhs"  # UK NHS number
    BR_CPF = "br_cpf"  # Brazilian CPF
    BR_CNPJ = "br_cnpj"  # Brazilian CNPJ (company)
    ZA_ID = "za_id"  # South African ID number
    CN_ID = "cn_resident"  # Chinese resident identity card
    CA_SIN = "ca_sin"  # Canadian Social Insurance Number
    IN_AADHAAR = "in_aadhaar"  # Indian Aadhaar
    DOB = "dob"  # date of birth — off by default (high false-positive)
    # Secrets / API keys — regex-only (no checksum), anchored on high-specificity
    # vendor prefixes. Deliberately break the "checksum-validated" rule for a curated
    # low-false-positive set; see docs/adr/0003.
    PRIVATE_KEY = "private_key"  # PEM private-key block
    JWT = "jwt"  # JSON Web Token (header validated)
    AWS_KEY = "aws_key"  # AWS access key id (AKIA/ASIA)
    ANTHROPIC_KEY = "anthropic_key"  # Anthropic API key (sk-ant-…)
    OPENAI_KEY = "openai_key"  # OpenAI API key (sk-…)
    GITHUB_TOKEN = "github_token"  # noqa: S105 — category key, not a credential
    GOOGLE_API_KEY = "google_api_key"  # Google API key (AIza…)
    SLACK_TOKEN = "slack_token"  # noqa: S105 — category key, not a credential
    STRIPE_KEY = "stripe_key"  # Stripe secret key (sk_live_/rk_live_)


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


def _trivial_digit_run(d: str) -> bool:
    """True for a digit string that is a placeholder, not an identifier.

    Applied ONLY by the unanchored numeric detectors (see `_TRIVIAL_RUN_GATED`) —
    the ones whose whole shape is "N bare digits" and whose single check digit is
    their only filter. A mod-11 or Luhn digit accepts roughly 1 in 11 (or 1 in 10)
    arbitrary runs, so `0123456789` really is a checksum-valid NHS number and
    `123456789` really is a checksum-valid PT NIF. In prose that is a tolerable
    miss; in pasted source code it is not, because digit tables (`const digits =
    "0123456789"`) are everywhere and redacting one corrupts the code under review.

    Three families, all of which are issued by no scheme on earth:
      - repdigits            0000000000, 1111111111
      - ascending by 1       0123456789, 2345678901  (mod 10, so ...890... counts)
      - descending by 1      9876543210, 0987654321

    Deliberately narrow. It rejects only these exact progressions, never anything
    merely "round-looking" — a real identifier must not be lost to a heuristic.
    """
    if len(d) < 2:
        return False
    if len(set(d)) == 1:
        return True
    deltas = {(int(b) - int(a)) % 10 for a, b in pairwise(d)}
    return deltas in ({1}, {9})


# Strip everything but alphanumerics (separator-robust normalisation for checksums).
_STRIP_RE = re.compile(r"[^0-9A-Za-z]")


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
    iban = _STRIP_RE.sub("", value).upper()
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
    iban = _STRIP_RE.sub("", value).upper()
    if len(iban) != _IBAN_LEN.get(iban[:2], -1):
        return False
    return _iban_mod97_ok(iban)


_DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"


def _es_dni_ok(value: str) -> bool:
    """Spanish DNI/NIE: an 8-digit body (NIE prefix X/Y/Z → 0/1/2) plus a mod-23 letter."""
    s = _STRIP_RE.sub("", value).upper()
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
    s = _STRIP_RE.sub("", value).upper()
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
    s = _STRIP_RE.sub("", value).upper()
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


# --------------------------------------------------------------------------- #
# EU / UK / global pack. Same shape-then-checksum contract; IDs that embed a
# birth date validate it too (a real check on top of the digit checksum).
# --------------------------------------------------------------------------- #
_MDAYS = (31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)  # lenient (day-of-month) check


def _luhn_core(d: str) -> bool:
    """Length-agnostic Luhn (the card detector keeps its own 13-19 length gate)."""
    total, parity = 0, len(d) % 2
    for i, ch in enumerate(d):
        n = int(ch)
        if i % 2 == parity:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _de_steuerid_ok(value: str) -> bool:
    """German tax IdNr: 11 digits, ISO 7064 MOD 11,10 check digit; never leads with 0."""
    d = _digits(value)
    if len(d) != 11 or d[0] == "0":
        return False
    product = 10
    for c in d[:10]:
        s = (int(c) + product) % 10 or 10
        product = (s * 2) % 11
    return (11 - product) % 10 == int(d[10])


def _pl_pesel_ok(value: str) -> bool:
    """Polish PESEL: 11 digits, embedded birth date (month carries the century) + mod-10."""
    d = _digits(value)
    if len(d) != 11:
        return False
    month, day = int(d[2:4]) % 20, int(d[4:6])
    if not (1 <= month <= 12 and 1 <= day <= _MDAYS[month - 1]):
        return False
    w = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)
    total = sum(int(c) * wt for c, wt in zip(d[:10], w, strict=True))
    return (10 - total % 10) % 10 == int(d[10])


def _pt_nif_ok(value: str) -> bool:
    """Portuguese NIF: 9 digits, a valid leading type digit and a mod-11 check digit."""
    d = _digits(value)
    if len(d) != 9 or d[0] not in "1235689":
        return False
    total = sum(int(c) * (9 - i) for i, c in enumerate(d[:8]))
    check = 11 - total % 11
    return (0 if check >= 10 else check) == int(d[8])


def _be_nrn_ok(value: str) -> bool:
    """Belgian National Register No: 11 digits, birth date + mod-97 of the first 9
    (with a +2000000000 adjustment for people born in/after 2000)."""
    d = _digits(value)
    if len(d) != 11 or int(d[2:4]) > 12 or int(d[4:6]) > 31:
        return False
    body, check = int(d[:9]), int(d[9:])
    return 97 - body % 97 == check or 97 - (2_000_000_000 + body) % 97 == check


def _uk_nhs_ok(value: str) -> bool:
    """UK NHS number: 10 digits, weighted mod-11 (weights 10..2); check 11->0, 10 invalid."""
    d = _digits(value)
    if len(d) != 10:
        return False
    total = sum(int(c) * (10 - i) for i, c in enumerate(d[:9]))
    check = 11 - total % 11
    if check == 11:
        check = 0
    return check != 10 and check == int(d[9])


def _br_cpf_ok(value: str) -> bool:
    """Brazilian CPF: 11 digits, two mod-11 check digits; rejects all-identical."""
    d = _digits(value)
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        total = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        check = (total * 10) % 11 % 10
        if check != int(d[n]):
            return False
    return True


def _br_cnpj_ok(value: str) -> bool:
    """Brazilian CNPJ: 14 digits, two mod-11 check digits (weights cycle 2..9)."""
    d = _digits(value)
    if len(d) != 14 or d == d[0] * 14:
        return False
    w1 = (5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)
    w2 = (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)
    for weights, pos in ((w1, 12), (w2, 13)):
        r = sum(int(d[i]) * weights[i] for i in range(pos)) % 11
        if (0 if r < 2 else 11 - r) != int(d[pos]):
            return False
    return True


def _za_id_ok(value: str) -> bool:
    """South African ID: 13 digits, embedded birth date (YYMMDD) + Luhn over all 13."""
    d = _digits(value)
    if len(d) != 13:
        return False
    month, day = int(d[2:4]), int(d[4:6])
    if not (1 <= month <= 12 and 1 <= day <= _MDAYS[month - 1]):
        return False
    return _luhn_core(d)


def _cn_id_ok(value: str) -> bool:
    """Chinese resident ID: 18 chars (last may be X), embedded YYYYMMDD + ISO 7064 mod-11,2."""
    s = _STRIP_RE.sub("", value).upper()
    if not re.fullmatch(r"\d{17}[\dX]", s):
        return False
    year, month, day = int(s[6:10]), int(s[10:12]), int(s[12:14])
    if not (1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= _MDAYS[month - 1]):
        return False
    w = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
    total = sum(int(c) * wt for c, wt in zip(s[:17], w, strict=True))
    return "10X98765432"[total % 11] == s[17]


def _ca_sin_ok(value: str) -> bool:
    """Canadian SIN: 9 digits, Luhn; never leads with 0."""
    d = _digits(value)
    if len(d) != 9 or d[0] == "0":
        return False
    return _luhn_core(d)


# Verhoeff dihedral-group tables for the Aadhaar check digit.
_VERHOEFF_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9), (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6), (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8), (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2), (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4), (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)  # fmt: skip
_VERHOEFF_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9), (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2), (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0), (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5), (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)  # fmt: skip


def _in_aadhaar_ok(value: str) -> bool:
    """Indian Aadhaar: 12 digits, first digit 2-9, Verhoeff checksum."""
    d = _digits(value)
    if len(d) != 12 or d[0] in "01":
        return False
    c = 0
    for i, ch in enumerate(reversed(d)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def _norm_record(s: str) -> str:
    """Whitespace/separator-robust comparator: keep only alphanumerics, upper.

    So ``756.1234.5678.97`` and ``756 1234 5678 97`` compare equal — the fix for
    the strict, separator-sensitive :func:`sovereign_shield.leak.detect_exact_leak`.
    """
    return _STRIP_RE.sub("", s).upper()


def _jwt_ok(value: str) -> bool:
    """Validate a JWT by decoding its header (the segment before the first dot) and
    requiring a JSON object with an ``alg`` field. This is the false-positive filter:
    three dotted base64url runs are only moderately specific, but only a genuine JOSE
    header decodes to ``{"alg": …}``, so this makes the JWT detector airtight."""
    header = value[: value.index(".")]
    padded = header + "=" * (-len(header) % 4)
    try:
        obj = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return False
    return isinstance(obj, dict) and "alg" in obj


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
# Swiss phone: +41 / 0041 / national 0, then a national destination code (NDC) and
# the 7 remaining subscriber digits. The NDC whitelist IS the false-positive filter —
# this is the one category with no checksum to close it. The old shape was "0 plus any
# 9 digits", which matches ordinary digit runs in source code: a Go `const digits =
# "0123456789"` was tokenised as a phone number in a real review paste, and the
# redaction corrupted the pasted code. Every Swiss number is NDC(2) + 7 digits, so
# gating on the allocated NDCs rejects ~2/3 of arbitrary 10-digit runs — including
# every ascending/descending sequence — while keeping all geographic (21-91), mobile
# (74-79) and service (0800 / 084x / 086x / 087x / 090x) numbers. Codes per OFCOM's
# national numbering plan.
_PHONE_CH_RE = re.compile(
    r"(?<!\d)(?:\+41|0041|0)[ .]?"
    r"(?:2[12467]|3[1-4]|4[134]|5[12568]|6[12]|7[14-9]|8[01467]|9[01])"
    r"(?:[ .]?\d){7}(?!\d)"
)
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
# DOB: dd?[./-]mm?[./-](19|20)yy. High false-positive → gated off by default.
_DOB_RE = re.compile(r"\b(?:0?[1-9]|[12]\d|3[01])[.\-/](?:0?[1-9]|1[0-2])[.\-/](?:19|20)\d{2}\b")
# Spanish DNI (8 digits) / NIE (X/Y/Z + 7 digits), each closed by a mod-23 check letter.
_ES_DNI_RE = re.compile(r"\b[XYZ]?\d{7,8}[A-Z]\b", re.IGNORECASE)
# French NIR / INSEE: 15 chars (Corsica department 2A/2B allowed), spacing tolerated.
_FR_NIR_RE = re.compile(
    r"\b[12] ?\d{2} ?\d{2} ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}\b", re.IGNORECASE
)
# Italian Codice Fiscale: 16 alphanumerics in the standard (non-omocodia) shape.
_IT_CF_RE = re.compile(r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b", re.IGNORECASE)
# Dutch BSN: 9 bare digits (validated by the 11-test — the false-positive filter).
_NL_BSN_RE = re.compile(r"\b\d{9}\b")
# EU / UK / global pack — common separators tolerated; each closed by its checksum.
_DE_STEUERID_RE = re.compile(r"\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b")  # 11 digits, 2-3-3-3
_PL_PESEL_RE = re.compile(r"\b\d{11}\b")
_PT_NIF_RE = re.compile(r"\b\d{3} ?\d{3} ?\d{3}\b")  # 9 digits
_BE_NRN_RE = re.compile(r"\b\d{2}[. ]?\d{2}[. ]?\d{2}[- ]?\d{3}[. ]?\d{2}\b")  # 11 digits
_UK_NHS_RE = re.compile(r"\b\d{3} ?\d{3} ?\d{4}\b")  # 10 digits, 3-3-4
_BR_CPF_RE = re.compile(r"\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b")  # 11 digits
_BR_CNPJ_RE = re.compile(r"\b\d{2}[. ]?\d{3}[. ]?\d{3}[/ ]?\d{4}[- ]?\d{2}\b")  # 14 digits
_ZA_ID_RE = re.compile(r"\b\d{13}\b")
_CN_ID_RE = re.compile(r"\b\d{17}[\dXx]\b")  # 18 chars, checksum may be X
_CA_SIN_RE = re.compile(r"\b\d{3}[ -]?\d{3}[ -]?\d{3}\b")  # 9 digits
_IN_AADHAAR_RE = re.compile(r"\b\d{4} ?\d{4} ?\d{4}\b")  # 12 digits, 4-4-4

# --------------------------------------------------------------------------- #
# secret / API-key shapes. Regex-only (no checksum), anchored on high-specificity
# vendor prefixes with explicit ASCII lookarounds — NEVER \b/\w, whose Unicode
# awareness in Python would diverge from the ASCII \b/\w in the JS port and break
# byte-for-byte parity. Run FIRST (see _DETECTORS) so a base64/JWT interior can't be
# part-claimed by a numeric ID detector, which would drop the overlapping secret and
# leak the rest of it.
# --------------------------------------------------------------------------- #
_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"
    r"[\s\S]+?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"
)
_JWT_RE = re.compile(
    r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])"
)
_AWS_KEY_RE = re.compile(r"(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])")
_ANTHROPIC_KEY_RE = re.compile(
    r"(?<![A-Za-z0-9_-])sk-ant-[a-zA-Z0-9]{4,8}-[A-Za-z0-9_-]{80,120}(?![A-Za-z0-9_-])"
)
_OPENAI_KEY_RE = re.compile(
    r"(?<![A-Za-z0-9_-])sk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{20,})(?![A-Za-z0-9_-])"
)
_GITHUB_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_-])(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})(?![A-Za-z0-9_-])"
)
_GOOGLE_API_KEY_RE = re.compile(r"(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])")
_SLACK_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_-])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9_-])")
# _live_ only — _test_ keys aren't sensitive and matching them would spam dev workflows.
_STRIPE_KEY_RE = re.compile(r"(?<![A-Za-z0-9_-])(?:sk|rk)_live_[A-Za-z0-9]{24,}(?![A-Za-z0-9_-])")


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
    if category is PiiCategory.DE_STEUERID:
        return f"steuerid:…{_digits(raw)[-2:]}"
    if category is PiiCategory.PL_PESEL:
        return f"pesel:…{_digits(raw)[-2:]}"
    if category is PiiCategory.PT_NIF:
        return f"nif:…{_digits(raw)[-2:]}"
    if category is PiiCategory.BE_NRN:
        return f"nrn:…{_digits(raw)[-2:]}"
    if category is PiiCategory.UK_NHS:
        return f"nhs:…{_digits(raw)[-2:]}"
    if category is PiiCategory.BR_CPF:
        return f"cpf:…{_digits(raw)[-2:]}"
    if category is PiiCategory.BR_CNPJ:
        return f"cnpj:…{_digits(raw)[-2:]}"
    if category is PiiCategory.ZA_ID:
        return f"zaid:…{_digits(raw)[-2:]}"
    if category is PiiCategory.CN_ID:
        return f"cnid:…{_norm_record(raw)[-2:]}"
    if category is PiiCategory.CA_SIN:
        return f"sin:…{_digits(raw)[-2:]}"
    if category is PiiCategory.IN_AADHAAR:
        return f"aadhaar:…{_digits(raw)[-2:]}"
    # Secrets: the marker carries only the fixed, public discriminator prefix — never
    # a byte of the random tail (see test_marker_never_leaks_raw_value).
    if category is PiiCategory.PRIVATE_KEY:
        return "pem:…"
    if category is PiiCategory.JWT:
        return "jwt:…"
    if category is PiiCategory.AWS_KEY:
        return f"aws:{raw[:4]}…"
    if category is PiiCategory.ANTHROPIC_KEY:
        return "anthropic:sk-ant-…"
    if category is PiiCategory.OPENAI_KEY:
        return "openai:sk-…"
    if category is PiiCategory.GITHUB_TOKEN:
        return f"github:{raw[: raw.index('_') + 1]}…"
    if category is PiiCategory.GOOGLE_API_KEY:
        return "google:AIza…"
    if category is PiiCategory.SLACK_TOKEN:
        return f"slack:{raw[: raw.index('-') + 1]}…"
    if category is PiiCategory.STRIPE_KEY:
        return f"stripe:{raw[:8]}…"
    return "dob:XXXX-XX-XX"


# (category, compiled regex, validator or None) in priority order.
_DETECTORS: list[tuple[PiiCategory, re.Pattern[str], object]] = [
    # secrets / API keys — regex-only, run FIRST so a base64/JWT interior can't be
    # part-claimed by a numeric ID detector below (which would drop the overlapping
    # secret span and leak the rest of the token).
    (PiiCategory.PRIVATE_KEY, _PRIVATE_KEY_RE, None),
    (PiiCategory.JWT, _JWT_RE, _jwt_ok),
    (PiiCategory.AWS_KEY, _AWS_KEY_RE, None),
    (PiiCategory.ANTHROPIC_KEY, _ANTHROPIC_KEY_RE, None),  # before OpenAI (both start sk-)
    (PiiCategory.OPENAI_KEY, _OPENAI_KEY_RE, None),
    (PiiCategory.GITHUB_TOKEN, _GITHUB_TOKEN_RE, None),
    (PiiCategory.GOOGLE_API_KEY, _GOOGLE_API_KEY_RE, None),
    (PiiCategory.SLACK_TOKEN, _SLACK_TOKEN_RE, None),
    (PiiCategory.STRIPE_KEY, _STRIPE_KEY_RE, None),
    (PiiCategory.AHV_AVS, _AHV_RE, _ean13_ok),
    (PiiCategory.IBAN, _IBAN_RE, _iban_ok),
    (PiiCategory.IT_CF, _IT_CF_RE, _it_cf_ok),
    (PiiCategory.ES_DNI, _ES_DNI_RE, _es_dni_ok),
    (PiiCategory.FR_NIR, _FR_NIR_RE, _fr_nir_ok),
    # strong pack (date / mod-97 / double check digit) — safe to run early.
    (PiiCategory.BE_NRN, _BE_NRN_RE, _be_nrn_ok),
    (PiiCategory.PL_PESEL, _PL_PESEL_RE, _pl_pesel_ok),
    (PiiCategory.BR_CPF, _BR_CPF_RE, _br_cpf_ok),
    # length-overlaps the card PAN (13/14/18 digits) → must precede CREDIT_CARD.
    (PiiCategory.BR_CNPJ, _BR_CNPJ_RE, _br_cnpj_ok),
    (PiiCategory.ZA_ID, _ZA_ID_RE, _za_id_ok),
    (PiiCategory.CN_ID, _CN_ID_RE, _cn_id_ok),
    # medium (single check digit + structure).
    (PiiCategory.DE_STEUERID, _DE_STEUERID_RE, _de_steuerid_ok),
    (PiiCategory.PT_NIF, _PT_NIF_RE, _pt_nif_ok),
    (PiiCategory.PHONE_CH, _PHONE_CH_RE, None),
    (PiiCategory.EMAIL, _EMAIL_RE, None),
    (PiiCategory.CREDIT_CARD, _PAN_RE, _luhn_ok),
    # weak (single check digit, no anchoring) — last, so a stronger detector wins first.
    (PiiCategory.UK_NHS, _UK_NHS_RE, _uk_nhs_ok),
    (PiiCategory.IN_AADHAAR, _IN_AADHAAR_RE, _in_aadhaar_ok),
    (PiiCategory.NL_BSN, _NL_BSN_RE, _nl_bsn_ok),
    (PiiCategory.CA_SIN, _CA_SIN_RE, _ca_sin_ok),
]

# Categories whose entire shape is "N bare digits", so a single check digit is the only
# thing standing between them and any digit run in the text. These — and only these —
# additionally reject the placeholder progressions in `_trivial_digit_run`.
#
# Not gated, on purpose: AHV/IBAN/CF/DNI/NIR/NRN/CPF/CNPJ/CN-ID carry a literal prefix,
# an embedded date or an alphabetic component, so a bare progression cannot reach them.
# CREDIT_CARD is excluded too — Luhn plus the 13-19 digit window is weak, but the
# canonical test PANs live in exactly this space and silently dropping one would be a
# worse failure than the false positive it prevents.
_TRIVIAL_RUN_GATED = frozenset(
    {
        PiiCategory.UK_NHS,
        PiiCategory.NL_BSN,
        PiiCategory.PL_PESEL,
        PiiCategory.ZA_ID,
        PiiCategory.CA_SIN,
        PiiCategory.PT_NIF,
        PiiCategory.IN_AADHAAR,
        PiiCategory.DE_STEUERID,
    }
)


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
            if category in _TRIVIAL_RUN_GATED and _trivial_digit_run(_digits(m.group(0))):
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
