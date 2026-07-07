# Sovereign Shield

**Use any cloud LLM. Keep the personal data in Switzerland.**

A deterministic, offline gateway for Swiss/EU (FADP / GDPR) personal data. It
tokenizes structured identifiers **locally** — turning `756.1234.5678.97` into
`[AHV_1]` — so a prompt can go to Gemini, Claude, or any model without a real
identifier ever crossing the border, then restores the real values in the reply
on the way back. Detection is regex + checksum, not ML: zero dependencies, zero
latency, and it **cannot be talked out of a match**.

> ⚠️ **Disclaimer.** Sovereign Shield is an engineering utility that aids
> programmatic privacy mitigation. It is **not** an automated guarantee of
> regulatory compliance under the Swiss Federal Act on Data Protection (FADP) or
> the EU GDPR, and it is **not legal advice**. Context-dependent leak vectors
> (free-text names, encoded data, semantics) can still slip past a structural,
> deterministic layer. Use it alongside a DPIA where required, audit logs, and
> human review — as the outer, deliberately-dumb layer of a defence-in-depth stack.

[**See it live → kevin.ars.md**](https://kevin.ars.md) · deterministic, in-browser, no API key.

## Install

```bash
pip install sovereign-shield              # core: stdlib-only, zero dependencies
pip install "sovereign-shield[gateway]"   # + the optional LangChain proxy
```

Requires Python 3.12+.

## Quickstart

```python
from sovereign_shield import SovereignShield

shield = SovereignShield()

raw = ("Guten Tag. Meine AHV-Nummer ist 756.1234.5678.97. Bitte die Praemie auf "
       "IBAN CH9300762011623852957 zurueckerstatten. Erreichbar unter "
       "+41 79 214 88 03 oder hans.muster@bluewin.ch.")

# 1. De-identify locally. `safe` is all that crosses the border.
safe, ctx = shield.sanitize(raw)
#   safe -> "Guten Tag. Meine AHV-Nummer ist [AHV_1]. Bitte die Praemie auf
#            IBAN [IBAN_1] zurueckerstatten. Erreichbar unter [PHONE_1] oder [EMAIL_1]."
print(ctx.audit())   # {'ch_ahv': 1, 'iban': 1, 'ch_phone': 1, 'email': 1}

# 2. Call any cloud LLM on the placeholders (it never sees a real value).
answer = call_your_llm(safe)

# 3. Restore the real values locally before serving the user.
result = shield.rehydrate(answer, ctx)
print(result.text)       # real AHV / IBAN / phone / email swapped back in
print(result.clean)      # True if the model didn't mangle a placeholder
```

`sanitize` is **fail-closed**: if any structured identifier would survive into
`safe`, it raises `DataLeakError` instead of leaking. `rehydrate` is strict and
deterministic, and reports any placeholder the model mangled or invented
(`result.leftover`) so you never ship a broken `[AHV_1` to a user.

### Transparent LangChain proxy

With the `[gateway]` extra, wrap any LangChain chat model and call it as usual —
sanitize-out and rehydrate-in happen under the hood:

```python
from langchain_google_genai import ChatGoogleGenerativeAI
from sovereign_shield.gateway import ShieldedChatModel

llm = ShieldedChatModel(ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.3))

reply = llm.invoke("Refund AHV 756.1234.5678.97 to IBAN CH9300762011623852957.")
print(reply.content)                                   # real values restored
print(reply.additional_kwargs["sovereign_shield"])     # {'kept_on_shore': 2, 'leftover': []}
```

## What it detects

Deterministic *shape regex + checksum* — the checksum rejects look-alikes so the
guard never trips on a random 13-digit string. Separators are stripped first, so
`756.1234.5678.97` and `756 1234 5678 97` validate identically.

| Category | Identifier | Validation |
|---|---|---|
| `ch_ahv` | Swiss AHV / AVS number | EAN-13 check digit |
| `iban` | CH / LI IBAN | ISO-7064 mod-97 |
| `credit_card` | Card PAN | Luhn |
| `ch_phone` | Swiss phone | shape only |
| `email` | Email | shape only |
| `dob` | Date of birth | off by default (bare dates false-positive) |

**Scope: structured identifiers only.** Person names and street addresses are
*not* detected — they need an NER model, which would forfeit the deterministic,
zero-dependency guarantee. Plug your own via `SovereignShield(extra_detectors=[...])`
(see `SpanDetector`); overlapping spans are dropped fail-closed.

**Not encoding-robust.** A model that base64s or ciphers an identifier defeats the
regex. Separator/whitespace reformatting is handled; encoding is not.

## How it works

The thesis, proven in the [K.E.V.I.N.](https://github.com/acoseac/kevin) red-team
research this is extracted from: you can't close a data leak from *inside* the
model — a jailbreak, a pretext, or a forced output schema will make it disclose.
So you put a **deterministic, offline boundary** around the model instead. Sovereign
Shield is that boundary, as a library: detect → tokenize → (model) → restore.

The browser demo ships a TypeScript port of the exact same detectors, kept
**byte-for-byte in parity** with this Python source by a generated vector suite —
so redaction on the client and on the server can never silently drift.

## Development

```bash
pip install -e ".[dev]"
pytest                                        # unit + round-trip suite
ruff check . && ruff format --check . && mypy
python scripts/gen_shield_vectors.py --check  # Python parity vectors current
cd web && npm install && npm run parity       # TS shield reproduces them exactly
```

The `web/` directory is the live demo (Next.js). See [web/README.md](web/README.md).

## Credits & license

Extracted from the [K.E.V.I.N.](https://github.com/acoseac/kevin) adversarial-testing
project; background in the [FADP AI-gateway write-up](https://www.ars.md/blog).
Licensed under [Apache-2.0](LICENSE).
