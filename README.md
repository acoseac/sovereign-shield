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

[**See it live → shield.ars.md**](https://shield.ars.md) · deterministic, in-browser, no API key.

**In your browser:** the [Sovereign Shield browser extension](https://chromewebstore.google.com/detail/sovereign-shield-%E2%80%94-llm-pi/fbdenbfhigickkdcokpchmklopkfkkbf)
runs the same redact → restore round-trip *inside* ChatGPT, Gemini and Claude — **now on the
Chrome Web Store**. 100% local, no account, no API key. Source in [`extension/`](extension/).

## Install

```bash
pip install sovereign-shield-ch              # core: stdlib-only, zero dependencies
pip install "sovereign-shield-ch[gateway]"   # + the optional LangChain proxy
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

## Run it as a drop-in proxy

No code changes: run a stateless, OpenAI-compatible reverse proxy and point any
OpenAI-compatible client at it. It sanitizes the prompt, forwards it to the real
provider, and rehydrates the reply — your API key flows straight through and
nothing is stored.

```bash
pip install "sovereign-shield-ch[proxy]"
sovereign-shield-proxy   # serves on :8000, forwards to https://api.openai.com/v1
```

Point your client's base URL at it (the key still goes to the real provider):

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1")
```

Front a different provider, or run it as a container sidecar:

```bash
SOVEREIGN_UPSTREAM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai sovereign-shield-proxy
docker build -t sovereign-shield-proxy . && docker run -p 8000:8000 sovereign-shield-proxy
```

Stateless (the token↔value map lives only for the request) and keyless (your
`Authorization` header is forwarded upstream). **Streaming (`"stream": true`) is
supported** — placeholders are rehydrated across SSE chunk boundaries, so a token
split over two chunks (`[AH` + `V_1]`) is still restored correctly.

## What it detects

Deterministic *shape regex + checksum* — the checksum rejects look-alikes so the
guard never trips on a random 13-digit string. Separators are stripped first, so
`756.1234.5678.97` and `756 1234 5678 97` validate identically.

**20 identifiers** — 18 checksum-validated, plus phone and email on shape — and an
opt-in date-of-birth matcher:

| Category | Identifier | Validation |
|---|---|---|
| `ch_ahv` | Swiss AHV / AVS number | EAN-13 check digit |
| `iban` | IBAN (any country) | 76-country length table + ISO-7064 mod-97 |
| `credit_card` | Card PAN | Luhn |
| `it_cf` | Italian Codice Fiscale | check character (mod 26) |
| `es_dni` | Spanish DNI / NIE | check letter (mod 23) |
| `fr_nir` | French NIR / social security | check key (mod 97), Corsica 2A/2B |
| `nl_bsn` | Dutch BSN | 11-test |
| `de_steuerid` | German Steuer-ID | ISO 7064 MOD 11,10 |
| `be_nrn` | Belgian Rijksregisternummer | birth date + mod-97 |
| `pl_pesel` | Polish PESEL | embedded birth date + mod-10 |
| `pt_nif` | Portuguese NIF | type digit + mod-11 |
| `uk_nhs` | UK NHS number | weighted mod-11 |
| `br_cpf` | Brazilian CPF | double mod-11 |
| `br_cnpj` | Brazilian CNPJ | double mod-11 |
| `za_id` | South African ID | embedded date + Luhn |
| `cn_resident` | Chinese resident ID | date + ISO 7064 mod-11,2 |
| `ca_sin` | Canadian SIN | Luhn |
| `in_aadhaar` | Indian Aadhaar | Verhoeff |
| `ch_phone` | Swiss phone | shape + OFCOM area-code whitelist |
| `email` | Email | shape only |
| `dob` | Date of birth | **off by default** (bare dates false-positive) |

**9 secrets and credentials.** Matched on high-signal vendor prefixes rather than a
checksum — see [ADR 0003](docs/adr/0003-secrets-and-custom-blocklists.md) for why that
relaxation is safe here:

| Category | Secret | Match |
|---|---|---|
| `private_key` | PEM private key | `-----BEGIN … PRIVATE KEY-----` block |
| `jwt` | JSON Web Token | three segments, header decoded and required to carry `alg` |
| `aws_key` | AWS access key | `AKIA…` / `ASIA…` |
| `anthropic_key` | Anthropic API key | `sk-ant-…` |
| `openai_key` | OpenAI API key | `sk-…`, incl. `proj`/`svcacct`/`admin` |
| `github_token` | GitHub token | `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`, `github_pat_` |
| `google_api_key` | Google API key | `AIza…` |
| `slack_token` | Slack token | `xoxb-`/`xoxa-`/`xoxp-`/`xoxr-`/`xoxs-` |
| `stripe_key` | Stripe secret key | `sk_live_`/`rk_live_` only — never `_test_` |

**Scope: structured identifiers only.** Person names and street addresses are
*not* detected — they need an NER model, which would forfeit the deterministic,
zero-dependency guarantee. Plug your own via `SovereignShield(extra_detectors=[...])`
(see `SpanDetector`); overlapping spans are dropped fail-closed.

**Not encoding-robust.** A model that base64s or ciphers an identifier defeats the
regex. Separator/whitespace reformatting is handled; encoding is not.

**Text only — not file uploads.** The library sanitizes the text you pass it, and the browser
extension guards the prompt you type. Neither inspects the contents of a **file you attach** in a
chat UI: an uploaded document or codebase reaches the model as-is. Redact attachments before
sending, or scan them with the library first.

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

## Working out AI data protection for a team?

I help Swiss and EU organisations map how personal data actually flows into AI tools and put the
right controls around it — a hands-on **technical** assessment of data flows, redaction boundaries
and residual exposure. It supports the DPIA your DPO and legal counsel own; it is not a substitute
for their determination or legal advice. → [arsenie@odysseus.fi](mailto:arsenie@odysseus.fi) ·
[shield.ars.md/governance](https://shield.ars.md/governance)

## Credits & license

Extracted from the [K.E.V.I.N.](https://github.com/acoseac/kevin) adversarial-testing
project; background in the [FADP AI-gateway write-up](https://coseac.swiss/blog).
Licensed under [Apache-2.0](LICENSE).
