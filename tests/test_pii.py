"""Tests for the deterministic Swiss/EU PII detectors (compliance shield)."""

from __future__ import annotations

from sovereign_shield.pii import (
    PiiCategory,
    _ean13_ok,
    _es_dni_ok,
    _fr_nir_ok,
    _iban_mod97_ok,
    _iban_ok,
    _it_cf_ok,
    _jwt_ok,
    _luhn_ok,
    _nl_bsn_ok,
    _norm_record,
    _pt_nif_ok,
    _trivial_digit_run,
    _uk_nhs_ok,
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


def test_phone_ch_accepts_every_allocated_ndc_form() -> None:
    # Geographic, mobile and service numbers, in each separator style the shape allows.
    for text in (
        "+41 79 123 45 67",
        "079 123 45 67",
        "0041 79 123 45 67",
        "0791234567",
        "+41.79.123.45.67",
        "+41 22 767 11 11",
        "021 123 45 67",
        "0313456789",
        "091 123 45 67",
        "0800 123 456",
        "0848 800 800",
    ):
        assert PiiCategory.PHONE_CH in {h.category for h in detect_pii(text)}, text


def test_phone_ch_rejects_digit_runs_that_are_not_swiss_numbers() -> None:
    # ch_phone is the one category with no checksum, so the NDC whitelist carries the
    # whole false-positive load. These all matched the old "0 + any 9 digits" shape; the
    # first two are real lines from a Go source file that got redacted mid-paste.
    for text in (
        'const digits = "0123456789"',
        'const hexChars = "0123456789ABCDEF"',
        "0000000000",
        "0987654321",
        "0101010101",
        "0234567890",
    ):
        assert PiiCategory.PHONE_CH not in {h.category for h in detect_pii(text)}, text


def test_trivial_digit_run_families() -> None:
    for d in ("0000000000", "1111111111", "0123456789", "2345678901", "9876543210", "0987654321"):
        assert _trivial_digit_run(d), d
    # Ascending/descending are mod 10, so a run that wraps past 9 or 0 still counts.
    assert _trivial_digit_run("8901234567")
    assert _trivial_digit_run("2109876543")
    # Nothing merely round-looking, and a single digit is not a progression.
    for d in ("500000018", "943476591", "111222333", "1", "", "1234567891", "1123456789"):
        assert not _trivial_digit_run(d), d


def test_trivial_digit_runs_are_rejected_despite_valid_check_digits() -> None:
    # Each of these PASSES the check digit of the category that would claim it — a single
    # mod-11 digit accepts roughly 1 in 11 arbitrary runs — so the checksum alone cannot
    # keep them out. They are placeholders in source code, never issued identifiers.
    assert _pt_nif_ok("123456789")  # genuinely a valid NIF
    assert _uk_nhs_ok("0123456789")  # genuinely a valid NHS number
    for text in (
        "123456789",
        "0123456789",
        'const digits = "0123456789"',
        'const hexChars = "0123456789ABCDEF"',
        "0000000000",
        "9876543210",
        "1234567890",
        "0987654321",
    ):
        assert detect_pii(text) == [], text


def test_trivial_run_guard_leaves_real_identifiers_alone() -> None:
    # The guard is narrow on purpose: only exact progressions, never merely round-looking
    # numbers. Every gated category must still detect a genuine value.
    for text, category in (
        ("500000018", PiiCategory.PT_NIF),
        ("943 476 5919", PiiCategory.UK_NHS),
        ("111222333", PiiCategory.NL_BSN),
        ("90051512340", PiiCategory.PL_PESEL),
        ("9001015009086", PiiCategory.ZA_ID),
        ("130 692 544", PiiCategory.CA_SIN),
        ("2341 2341 2346", PiiCategory.IN_AADHAAR),
        ("11223344553", PiiCategory.DE_STEUERID),
    ):
        assert category in {h.category for h in detect_pii(text)}, text


def test_trivial_run_guard_does_not_touch_anchored_categories() -> None:
    # AHV/IBAN/PAN carry a prefix, mod-97 or Luhn over a 13-19 digit window, so a bare
    # progression cannot reach them — and the canonical test PAN must survive.
    assert PiiCategory.AHV_AVS in {h.category for h in detect_pii(AHV_SEED)}
    assert PiiCategory.CREDIT_CARD in {h.category for h in detect_pii(PAN_VISA)}
    assert PiiCategory.IBAN in {h.category for h in detect_pii(IBAN_CH)}


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


# --------------------------------------------------------------------------- #
# EU identifiers (all synthetic-but-valid)
# --------------------------------------------------------------------------- #
IBAN_DE = "DE89 3704 0044 0532 0130 00"
IBAN_FR = "FR14 2004 1010 0505 0001 3M02 606"
IBAN_NL = "NL91 ABNA 0417 1643 00"
IBAN_ES = "ES91 2100 0418 4502 0005 1332"
DNI_ES = "12345678Z"
NIE_ES = "X1234567L"
NIR_FR = "185012751230073"
CF_IT = "RSSMRA85T10A562S"
BSN_NL = "111222333"


def test_iban_broadened_to_all_countries() -> None:
    for iban in (IBAN_DE, IBAN_FR, IBAN_NL, IBAN_ES):
        assert {h.category for h in detect_pii(iban)} == {PiiCategory.IBAN}
    assert _iban_ok("ZZ89370400440532013000") is False  # unknown country
    assert _iban_ok("DE8937040044053201300") is False  # wrong length for DE
    assert detect_pii("DE89370400440532013001") == []  # tampered check digits


def test_es_dni_nie() -> None:
    assert {h.category for h in detect_pii(f"DNI {DNI_ES}")} == {PiiCategory.ES_DNI}
    assert {h.category for h in detect_pii(NIE_ES)} == {PiiCategory.ES_DNI}
    assert _es_dni_ok("12345678A") is False  # wrong check letter
    assert detect_pii("order 12345678A closed") == []


def test_fr_nir() -> None:
    assert {h.category for h in detect_pii(f"NIR {NIR_FR}")} == {PiiCategory.FR_NIR}
    assert {h.category for h in detect_pii("1 85 01 27 512 300 73")} == {PiiCategory.FR_NIR}
    assert _fr_nir_ok("185012751230074") is False  # tampered key


def test_it_codice_fiscale() -> None:
    assert {h.category for h in detect_pii(f"CF {CF_IT}")} == {PiiCategory.IT_CF}
    assert _it_cf_ok("RSSMRA85T10A562A") is False  # wrong check letter


def test_nl_bsn_eleven_test() -> None:
    assert {h.category for h in detect_pii(BSN_NL)} == {PiiCategory.NL_BSN}
    assert _nl_bsn_ok("111222334") is False  # fails the 11-test
    assert detect_pii("111222334") == []  # so it is never flagged


def test_detects_mixed_eu_document() -> None:
    doc = f"IBAN {IBAN_DE}, DNI {DNI_ES}, CF {CF_IT}, BSN {BSN_NL}"
    cats = [h.category for h in detect_pii(doc)]
    assert cats == [
        PiiCategory.IBAN,
        PiiCategory.ES_DNI,
        PiiCategory.IT_CF,
        PiiCategory.NL_BSN,
    ]


def test_eu_markers_never_leak_raw() -> None:
    for text in (IBAN_DE, DNI_ES, NIR_FR, CF_IT, BSN_NL):
        hits = detect_pii(text)
        assert hits
        norm = _norm_record(text)
        for h in hits:
            assert norm not in h.marker


# --------------------------------------------------------------------------- #
# EU / UK / global pack (all synthetic, valid-by-construction). The CPF, CNPJ and
# NHS values are the canonical published test numbers, so these also spot-check
# that the algorithms match the real specs, not just themselves.
# --------------------------------------------------------------------------- #
PACK_VALID: dict[PiiCategory, str] = {
    PiiCategory.DE_STEUERID: "11223344553",
    PiiCategory.PL_PESEL: "90051512340",
    # 500000018, not the 123456789 this used to be: that is a checksum-valid NIF but also
    # a trivial digit run, which _trivial_digit_run now rejects (see the tests above).
    PiiCategory.PT_NIF: "500000018",
    PiiCategory.BE_NRN: "85073003328",
    PiiCategory.UK_NHS: "9434765919",
    PiiCategory.BR_CPF: "11144477735",
    PiiCategory.BR_CNPJ: "11222333000181",
    PiiCategory.ZA_ID: "9001015009086",
    PiiCategory.CN_ID: "110101199001011237",
    PiiCategory.CA_SIN: "130692544",
    PiiCategory.IN_AADHAAR: "234123412346",
}


def test_pack_each_valid_detected_as_its_category() -> None:
    for category, value in PACK_VALID.items():
        assert {h.category for h in detect_pii(value)} == {category}, category


def test_pack_tampered_rejected() -> None:
    for category, value in PACK_VALID.items():
        bad = value[:-1] + str((int(value[-1]) + 1) % 10)  # bump check digit
        assert category not in {h.category for h in detect_pii(bad)}, category


def test_pack_separator_formatted() -> None:
    assert {h.category for h in detect_pii("CPF 111.444.777-35")} == {PiiCategory.BR_CPF}
    assert {h.category for h in detect_pii("NHS 943 476 5919")} == {PiiCategory.UK_NHS}
    assert {h.category for h in detect_pii("CNPJ 11.222.333/0001-81")} == {PiiCategory.BR_CNPJ}
    assert {h.category for h in detect_pii("BE 85.07.30-033.28")} == {PiiCategory.BE_NRN}


# --------------------------------------------------------------------------- #
# secrets / API keys — regex-only detectors (no checksum). All values synthetic;
# length-exact tails built with `* n` so a miscount can't weaken a test.
# --------------------------------------------------------------------------- #
JWT_HS256 = (
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
)
PEM_EC = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIB" + "A" * 40 + "\n-----END EC PRIVATE KEY-----"

SECRETS_VALID: dict[PiiCategory, str] = {
    PiiCategory.AWS_KEY: "AKIAIOSFODNN7EXAMPLE",
    PiiCategory.GITHUB_TOKEN: "ghp_" + "A" * 36,
    PiiCategory.ANTHROPIC_KEY: "sk-ant-api03-" + "A" * 95,
    PiiCategory.OPENAI_KEY: "sk-svcacct-" + "A" * 40,
    PiiCategory.GOOGLE_API_KEY: "AIza" + "A" * 35,
    PiiCategory.SLACK_TOKEN: "xoxb-" + "1234567890abcdef",
    PiiCategory.STRIPE_KEY: "sk_live_" + "A" * 24,
    PiiCategory.JWT: JWT_HS256,
    PiiCategory.PRIVATE_KEY: PEM_EC,
}


def test_secret_each_valid_detected_as_its_category() -> None:
    for category, value in SECRETS_VALID.items():
        assert {h.category for h in detect_pii(value)} == {category}, category


def test_secret_markers_never_leak_raw() -> None:
    # The marker carries only the fixed public prefix — never a byte of the random tail.
    for value in SECRETS_VALID.values():
        tail = value[-16:]
        for h in detect_pii(value):
            assert tail not in h.marker


def test_anthropic_precedes_openai() -> None:
    # Both start "sk-"; sk-ant-… must resolve to anthropic_key, never openai_key.
    for value in ("sk-ant-api03-" + "A" * 95, "sk-ant-oat01-" + "B" * 100):
        assert {h.category for h in detect_pii(value)} == {PiiCategory.ANTHROPIC_KEY}


def test_openai_legacy_and_service_account() -> None:
    assert {h.category for h in detect_pii("sk-" + "A" * 48)} == {PiiCategory.OPENAI_KEY}
    assert {h.category for h in detect_pii("sk-svcacct-" + "A" * 40)} == {PiiCategory.OPENAI_KEY}


def test_stripe_underscore_not_confused_with_openai() -> None:
    # sk_live_ (underscore) is Stripe; sk- (dash) is OpenAI — the two never collide.
    assert {h.category for h in detect_pii("sk_live_" + "A" * 24)} == {PiiCategory.STRIPE_KEY}


def test_jwt_header_validated() -> None:
    assert _jwt_ok(JWT_HS256) is True
    # alg:none still declares an alg → a real (if unsigned) JWT.
    assert _jwt_ok("eyJhbGciOiJub25lIn0.eyJzdWIiOiJhbm9uIn0." + "A" * 20) is True
    # header decodes to JSON without an alg key → rejected.
    assert _jwt_ok("eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiIxIn0." + "A" * 16) is False
    # so a JWT-shaped string whose header isn't {"alg": …} is never flagged.
    assert detect_pii("eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiIxIn0." + "A" * 16) == []


def test_jwt_wins_over_embedded_numeric_id() -> None:
    # A valid ZA ID (9001015009086) inside the payload must NOT be split out as za_id:
    # the JWT claims the whole span first, so the rest of the token never leaks.
    token = "eyJhbGciOiJIUzI1NiJ9.eyJ-9001015009086-abcdefghij." + "A" * 16
    assert [h.category for h in detect_pii(token)] == [PiiCategory.JWT]


def test_secret_too_short_not_flagged() -> None:
    assert detect_pii("AKIA" + "A" * 12) == []  # needs 16 chars after AKIA
    assert detect_pii("sk-shorttoken") == []


def test_secret_and_pii_co_occur() -> None:
    hits = detect_pii("key AKIAIOSFODNN7EXAMPLE and AHV 756.9217.0769.85")
    assert [h.category for h in hits] == [PiiCategory.AWS_KEY, PiiCategory.AHV_AVS]
