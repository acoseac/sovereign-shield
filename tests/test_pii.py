"""Tests for the deterministic Swiss/EU PII detectors (compliance shield)."""

from __future__ import annotations

from sovereign_shield.pii import (
    PiiCategory,
    _ean13_ok,
    _iban_mod97_ok,
    _luhn_ok,
    _norm_record,
    detect_pii,
)

# Canonical, synthetic-but-valid reference values.
AHV_VALID = "756.9217.0769.85"  # official Swiss AVS specimen (EAN-13 valid)
AHV_SEED = "756.1234.5678.97"  # the shield's synthetic seed (check digit 7)
IBAN_CH = "CH9300762011623852957"  # ISO 13616 CH example
IBAN_LI = "LI21088100002324013AA"  # Liechtenstein example
PAN_VISA = "4111111111111111"  # Luhn-valid test PAN
PAN_MC = "5555555555554444"  # Luhn-valid test PAN


# --------------------------------------------------------------------------- #
# checksums
# --------------------------------------------------------------------------- #
def test_ean13_accepts_valid_ahv_any_separator() -> None:
    assert _ean13_ok("7569217076985") is True
    assert _ean13_ok("756.9217.0769.85") is True
    assert _ean13_ok("756 9217 0769 85") is True  # separators stripped first


def test_ean13_rejects_bad_check_digit_and_wrong_length() -> None:
    assert _ean13_ok("7569217076984") is False  # last digit should be 5
    assert _ean13_ok("75692170769") is False  # too short


def test_iban_mod97() -> None:
    assert _iban_mod97_ok(IBAN_CH) is True
    assert _iban_mod97_ok("CH93 0076 2011 6238 5295 7") is True  # grouped
    assert _iban_mod97_ok(IBAN_LI) is True
    assert _iban_mod97_ok("CH0000000000000000000") is False


def test_luhn() -> None:
    assert _luhn_ok(PAN_VISA) is True
    assert _luhn_ok("4111 1111 1111 1111") is True
    assert _luhn_ok("4111111111111112") is False
    assert _luhn_ok("1234567890123456") is False


def test_norm_record_is_separator_insensitive() -> None:
    assert _norm_record("756.9217.0769.85") == _norm_record("756 9217 0769 85")
    assert _norm_record("ch93 0076") == "CH930076"


# --------------------------------------------------------------------------- #
# detect_pii
# --------------------------------------------------------------------------- #
def test_detects_each_category() -> None:
    cats = {h.category for h in detect_pii(f"AHV {AHV_VALID}")}
    assert PiiCategory.AHV_AVS in cats
    assert {h.category for h in detect_pii(f"IBAN {IBAN_CH}")} == {PiiCategory.IBAN}
    assert {h.category for h in detect_pii(f"card {PAN_VISA}")} == {PiiCategory.CREDIT_CARD}
    assert {h.category for h in detect_pii("reach me at hans.muster@bluewin.ch")} == {
        PiiCategory.EMAIL
    }
    assert PiiCategory.PHONE_CH in {h.category for h in detect_pii("call +41 79 123 45 67")}


def test_rejects_checksum_lookalikes() -> None:
    # A key-shaped but checksum-invalid AHV / IBAN / PAN must not be flagged.
    assert detect_pii("756.1234.5678.96") == []  # bad AHV check digit
    assert detect_pii("CH0000000000000000000") == []  # bad IBAN
    assert detect_pii("4111111111111112") == []  # bad Luhn


def test_ahv_wins_over_pan_on_overlap() -> None:
    # The 13-digit AHV must be categorised ch_ahv, never credit_card, even if
    # its digits would also satisfy a PAN shape.
    hits = detect_pii(AHV_SEED)
    assert [h.category for h in hits] == [PiiCategory.AHV_AVS]


def test_marker_never_leaks_raw_value() -> None:
    for text, needle in [(AHV_VALID, "9217"), (IBAN_CH, "623852957"), (PAN_VISA, "1111111111")]:
        hits = detect_pii(text)
        assert hits
        for h in hits:
            assert needle not in h.marker


def test_dob_is_off_by_default() -> None:
    assert detect_pii("born 03.07.1986") == []
    assert any(
        h.category is PiiCategory.DOB for h in detect_pii("born 03.07.1986", include_dob=True)
    )


def test_clean_text_has_no_hits() -> None:
    assert detect_pii("I can help you open a support ticket instead.") == []
