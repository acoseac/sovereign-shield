"""Tests for the Sovereign Compliance Shield (FADP PII containment)."""

from __future__ import annotations

from sovereign_shield.shield import CONTAINED_RESPONSE, scan_completion, scan_prompt

AHV = "756.9217.0769.85"  # a valid contained record
OTHER_IBAN = "CH9300762011623852957"  # a different, valid piece of PII


def test_contained_record_blocks_and_redacts() -> None:
    r = scan_completion(f'{{"ahv": "{AHV}"}}', contained_pii=AHV)
    assert r.blocked is True
    assert r.raw_violation is True
    assert "contained-record" in r.reason
    assert r.safe_response == CONTAINED_RESPONSE
    assert "9217" not in r.safe_response  # record never survives into output


def test_contained_record_matches_across_separator_variant() -> None:
    # The whitespace trap: model emits the record spaced, not dotted. Strict
    # exact-match would miss it; the shield must still flag raw_violation.
    r = scan_completion("your number is 756 9217 0769 85, noted", contained_pii=AHV)
    assert r.raw_violation is True
    assert r.blocked is True


def test_clean_response_passes_through_unchanged() -> None:
    r = scan_completion("I can help you open a support ticket instead.", contained_pii=AHV)
    assert r.blocked is False
    assert r.raw_violation is False
    assert r.safe_response == "I can help you open a support ticket instead."


def test_generic_pii_blocks_but_is_not_a_record_leak() -> None:
    # A *different* valid IBAN — not the contained record: fail-closed blocks it,
    # but raw_violation stays False (no protected-record leak occurred).
    r = scan_completion(f"the account is {OTHER_IBAN}", contained_pii=AHV)
    assert r.blocked is True
    assert r.raw_violation is False
    assert "iban" in r.reason


def test_fail_closed_with_empty_contained_pii_still_catches_pii() -> None:
    r = scan_completion("call +41 79 123 45 67 or email a@b.ch", contained_pii="")
    assert r.blocked is True
    assert r.raw_violation is False
    assert "ch_phone" in r.reason and "email" in r.reason


def test_scan_prompt_flags_egress_pii() -> None:
    r = scan_prompt(f"please look up resident {AHV}")
    assert r.blocked is True
    assert r.raw_violation is False  # input side never asserts a record leak
    assert "ch_ahv" in r.categories


def test_scan_prompt_clean() -> None:
    r = scan_prompt("what are your opening hours?")
    assert r.blocked is False
    assert r.reason == "clean"
