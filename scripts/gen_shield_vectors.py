#!/usr/bin/env python
"""Generate (or check) the shield parity vectors for the TypeScript port.

The web demo (shield.ars.md) ships a TypeScript port of `sovereign_shield.pii` +
`sovereign_shield.shield` so the shield can run in the browser. This script emits
the ground-truth verdicts from the *Python* shield; `web/scripts/parity.ts`
asserts the TS port reproduces them exactly, so the two can never silently drift.

Usage:
    python scripts/gen_shield_vectors.py           # (re)write the vectors JSON
    python scripts/gen_shield_vectors.py --check    # exit 1 if out of date
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from sovereign_shield.pii import detect_pii
from sovereign_shield.shield import scan_completion, scan_prompt

SEED = "756.1234.5678.97"
OUT = Path(__file__).resolve().parents[1] / "web" / "lib" / "shield" / "parity-vectors.json"

INPUTS = [
    "756.1234.5678.97",
    "756 1234 5678 97",
    "7561234567897",
    "756.9217.0769.85",
    "756.1234.5678.96",
    "CH9300762011623852957",
    "CH93 0076 2011 6238 5295 7",
    "LI21088100002324013AA",
    "CH0000000000000000000",
    "4111111111111111",
    "4539 1488 0343 6467",
    "4111111111111112",
    "+41 79 123 45 67",
    "079 123 45 67",
    "hans.muster@bluewin.ch",
    "I can help you open a support ticket instead.",
    '{"ahv": "756.1234.5678.97"}',
    "your AHV is 756.9217.0769.85 and IBAN CH9300762011623852957",
    "the resident 756 1234 5678 97, phone 079 123 45 67",
    "born 03.07.1986",
    "756.1234.5678.97 756.9217.0769.85",
    # EU identifiers (all synthetic; each valid unless marked tampered)
    "DE89 3704 0044 0532 0130 00",
    "FR14 2004 1010 0505 0001 3M02 606",
    "NL91 ABNA 0417 1643 00",
    "ES91 2100 0418 4502 0005 1332",
    "GB82 WEST 1234 5698 7654 32",
    "DE89370400440532013001",
    "12345678Z",
    "X1234567L",
    "12345678A",
    "185012751230073",
    "1 85 01 27 512 300 73",
    "RSSMRA85T10A562S",
    "RSSMRA85T10A562A",
    "111222333",
    "111222334",
    "IBAN DE89 3704 0044 0532 0130 00, DNI 12345678Z, CF RSSMRA85T10A562S, BSN 111222333",
    "My IBAN is CH9300762011623852957. Confirm CH9300762011623852957 please.",
    "DE89370400440532013000 THANKS",
    # EU / UK / global pack (all synthetic, valid-by-construction unless tampered)
    "11223344553",  # DE Steuer-ID
    "11223344554",  # DE Steuer-ID tampered
    "90051512340",  # PL PESEL
    "123456789",  # PT NIF
    "85.07.30-033.28",  # BE NRN (dotted)
    "85073003328",  # BE NRN (bare)
    "943 476 5919",  # UK NHS (spaced)
    "9434765919",  # UK NHS (bare)
    "111.444.777-35",  # BR CPF (formatted)
    "11144477735",  # BR CPF (bare)
    "11144477736",  # BR CPF tampered
    "11.222.333/0001-81",  # BR CNPJ (formatted)
    "11222333000181",  # BR CNPJ (bare)
    "9001015009086",  # ZA ID
    "110101199001011237",  # CN resident ID
    "130 692 544",  # CA SIN (spaced)
    "130692544",  # CA SIN (bare)
    "2341 2341 2346",  # IN Aadhaar (spaced)
    "234123412346",  # IN Aadhaar (bare)
    "NHS 943 476 5919, CPF 111.444.777-35, PESEL 90051512340, Aadhaar 2341 2341 2346",
    # secrets / API keys (all synthetic; NOT real credentials). Length-exact tails are
    # built with `* n` so the vectors can't silently drift on a hand-miscount.
    "AKIAIOSFODNN7EXAMPLE",  # AWS access key id (canonical AWS example value)
    "ghp_" + "A" * 36,  # GitHub personal access token
    "sk-ant-api03-" + "A" * 95,  # Anthropic API key
    "sk-ant-oat01-" + "B" * 100,  # Anthropic OAuth token (generalized middle segment)
    "sk-svcacct-" + "A" * 40,  # OpenAI service-account key
    "sk-" + "A" * 48,  # OpenAI legacy key
    "AIza" + "A" * 35,  # Google API key
    "xoxb-" + "1234567890abcdef",  # Slack bot token
    # NOTE: Stripe (sk_live_…) is deliberately NOT a committed vector. A full sk_live_
    # literal in this generated JSON trips GitHub push protection even though the value is
    # synthetic (GitHub's Stripe matcher has no entropy/checksum gate, unlike the ghp_/AIza/…
    # ones). The detector still ships and is covered — via string concatenation, which never
    # materializes the literal — in tests/test_pii.py (Python) and session.test.ts (TS port).
    "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIB" + "A" * 40 + "\n-----END EC PRIVATE KEY-----",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",  # JWT (HS256)
    "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhbm9uIn0."
    + "A" * 20,  # JWT alg:none → header has an alg key, detected
    "eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiIxIn0." + "A" * 16,  # JWT-shaped but header lacks alg → rejected
    "eyJhbGciOiJIUzI1NiJ9.eyJ-9001015009086-abcdefghij."
    + "A" * 16,  # payload embeds a valid ZA ID → one jwt hit, not za_id
    "key AKIAIOSFODNN7EXAMPLE and AHV 756.9217.0769.85",  # secret + PII co-occur → AWS + AHV
    "AKIA" + "A" * 12,  # too short (needs 16 after AKIA) → no hit
    "sk-shorttoken",  # too short → no hit
]


def build() -> str:
    vectors = []
    for text in INPUTS:
        sc = scan_completion(text, contained_pii=SEED)
        sp = scan_prompt(text)
        vectors.append(
            {
                "input": text,
                "contained_pii": SEED,
                "detect_pii": [
                    {
                        "category": h.category.value,
                        "marker": h.marker,
                        "start": h.start,
                        "end": h.end,
                    }
                    for h in detect_pii(text)
                ],
                "scan_completion": {
                    "blocked": sc.blocked,
                    "raw_violation": sc.raw_violation,
                    "reason": sc.reason,
                    "categories": list(sc.categories),
                },
                "scan_prompt": {
                    "blocked": sp.blocked,
                    "reason": sp.reason,
                    "categories": list(sp.categories),
                },
            }
        )
    return json.dumps(vectors, indent=2, ensure_ascii=True) + "\n"


def main() -> int:
    content = build()
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.is_file() else ""
        if current != content:
            print(
                "parity vectors are stale — run: python scripts/gen_shield_vectors.py",
                file=sys.stderr,
            )
            return 1
        print(f"parity vectors up to date ({len(INPUTS)} vectors)")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(content, encoding="utf-8")
    print(f"wrote {len(INPUTS)} parity vectors -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
