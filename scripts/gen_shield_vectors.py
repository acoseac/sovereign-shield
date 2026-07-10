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
