"""Tests for the tokenize → rehydrate round-trip engine (SovereignShield.core)."""

from __future__ import annotations

import pytest

from sovereign_shield import (
    DataLeakError,
    Entity,
    SessionContext,
    SovereignShield,
    detect_pii,
)

# Synthetic-but-checksum-valid reference values.
AHV = "756.9217.0769.85"
IBAN = "CH9300762011623852957"
EMAIL = "hans.muster@bluewin.ch"


# --------------------------------------------------------------------------- #
# the round-trip
# --------------------------------------------------------------------------- #
def test_round_trip_restores_exactly() -> None:
    shield = SovereignShield()
    raw = f"AHV {AHV}, refund to IBAN {IBAN}, reach me at {EMAIL}."
    safe, ctx = shield.sanitize(raw)

    # Nothing real crosses the boundary; placeholders take their place.
    for value in (AHV, IBAN, EMAIL):
        assert value not in safe
    assert "[AHV_1]" in safe and "[IBAN_1]" in safe and "[EMAIL_1]" in safe

    # Restoring the sanitized text reproduces the original byte-for-byte.
    restored = shield.rehydrate(safe, ctx)
    assert restored.text == raw
    assert restored.clean

    # And a model reply that echoes the placeholders comes back personalised.
    reply = "We'll refund [AHV_1]'s charge to [IBAN_1] and confirm by email to [EMAIL_1]."
    out = shield.rehydrate(reply, ctx)
    assert out.clean
    assert AHV in out.text and IBAN in out.text and EMAIL in out.text


def test_sanitize_leaves_no_detectable_pii() -> None:
    shield = SovereignShield()
    safe, _ = shield.sanitize(f"{AHV} / {IBAN} / {EMAIL} / +41 79 123 45 67")
    assert detect_pii(safe) == []


def test_clean_text_is_a_no_op() -> None:
    shield = SovereignShield()
    clean = "What are your opening hours?"
    safe, ctx = shield.sanitize(clean)
    assert safe == clean
    assert ctx.total == 0
    restored = shield.rehydrate(clean, ctx)
    assert restored.text == clean
    assert restored.clean


# --------------------------------------------------------------------------- #
# stable placeholders + audit
# --------------------------------------------------------------------------- #
def test_repeated_value_gets_one_stable_token() -> None:
    shield = SovereignShield()
    safe, ctx = shield.sanitize(f"first {AHV} then again {AHV}")
    assert len({e.token for e in ctx.entities}) == 1  # one token
    assert ctx.total == 2  # two spans
    assert safe.count("[AHV_1]") == 2


def test_audit_counts_by_category() -> None:
    shield = SovereignShield()
    _, ctx = shield.sanitize(f"AHV {AHV}, IBAN {IBAN}, email {EMAIL}")
    assert ctx.audit() == {"ch_ahv": 1, "iban": 1, "email": 1}
    assert ctx.total == 3


# --------------------------------------------------------------------------- #
# rehydrate: self-delimiting tokens, order independence, leftover reporting
# --------------------------------------------------------------------------- #
def test_tokens_self_delimit_and_order_independent() -> None:
    # [AHV_1] must never fracture [AHV_11]; result is the same in either order.
    shield = SovereignShield()
    e1 = Entity(start=0, end=0, category="ch_ahv", token="[AHV_1]", value="ONE")
    e11 = Entity(start=0, end=0, category="ch_ahv", token="[AHV_11]", value="ELEVEN")
    text = "see [AHV_11] and [AHV_1]"

    forward = shield.rehydrate(text, SessionContext(entities=(e1, e11)))
    reverse = shield.rehydrate(text, SessionContext(entities=(e11, e1)))
    assert forward.text == "see ELEVEN and ONE"
    assert reverse.text == forward.text
    assert forward.clean


def test_rehydrate_flags_unknown_placeholder() -> None:
    # The model invents a token that was never issued; strict restore leaves it,
    # and the report surfaces it so the caller never ships it to a user.
    shield = SovereignShield()
    _, ctx = shield.sanitize(f"IBAN {IBAN}")
    out = shield.rehydrate("Sent to [IBAN_1], cc [IBAN_2].", ctx)
    assert IBAN in out.text  # the real token restored
    assert not out.clean
    assert out.leftover == ("[IBAN_2]",)


def test_str_of_result_is_the_text() -> None:
    shield = SovereignShield()
    _, ctx = shield.sanitize(f"IBAN {IBAN}")
    out = shield.rehydrate("paid [IBAN_1]", ctx)
    assert str(out) == out.text


# --------------------------------------------------------------------------- #
# fail-closed egress + overlap guard (with a pluggable custom detector)
# --------------------------------------------------------------------------- #
def test_sanitize_fails_closed_when_a_raw_value_would_survive() -> None:
    # A custom detector that only flags the FIRST occurrence of a repeated value:
    # the second copy would survive sanitization, so sanitize must refuse.
    def first_bond(text: str) -> list[tuple[int, int, str]]:
        i = text.find("Bond")
        return [(i, i + 4, "name")] if i >= 0 else []

    shield = SovereignShield(extra_detectors=[first_bond])
    with pytest.raises(DataLeakError):
        shield.sanitize("Bond met Bond")


def test_overlap_guard_drops_the_overlapping_custom_span() -> None:
    # A greedy custom span covering the whole text overlaps the structured AHV;
    # the structured hit wins and the custom span is dropped (fail-closed).
    def greedy(text: str) -> list[tuple[int, int, str]]:
        return [(0, len(text), "name")]

    shield = SovereignShield(extra_detectors=[greedy])
    _, ctx = shield.sanitize(f"AHV {AHV}")
    assert ctx.total == 1
    assert ctx.entities[0].category == "ch_ahv"
