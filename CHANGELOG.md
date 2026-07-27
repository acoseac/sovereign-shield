# Changelog

Notable changes to **`sovereign-shield-ch`** — the Python library and proxy. The browser
extension versions independently and is not covered here (see [`extension/`](extension/)).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project aims at
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-07-27

The detection engine grew from the Swiss/finance core into a broad international set and gained a
class of developer-secret detectors. The **identifiers** keep the original contract — shape regex
plus a checksum, so the false-positive rate stays near zero — while the **secrets** are matched on
high-signal vendor prefixes, a deliberate and bounded exception to the checksum rule
([ADR 0003](docs/adr/0003-secrets-and-custom-blocklists.md)).

### Added

- **15 national identifiers** beyond the original core, each validated by its own checksum:
  Italian codice fiscale, Spanish DNI/NIE, French NIR, Dutch BSN, German Steuer-ID, Polish PESEL,
  Portuguese NIF, Belgian Rijksregisternummer, UK NHS number, Brazilian CPF and CNPJ, South
  African ID, Chinese resident ID, Canadian SIN, and Indian Aadhaar (Verhoeff).
- **Secret and credential detection** — 9 patterns, matched on high-signal vendor prefixes rather
  than a checksum: PEM private keys, JWTs (header-validated), and AWS / Anthropic / OpenAI /
  GitHub / Google / Slack keys and tokens, plus Stripe **live** secret keys. See
  [ADR 0003](docs/adr/0003-secrets-and-custom-blocklists.md) for why relaxing the checksum rule is
  safe for this class.
- The IBAN validator now carries the 76-country ISO-13616 length table alongside the ISO-7064
  mod-97 check, so a structurally valid IBAN from any supported country is recognised.

### Fixed

- Bare-digit identifiers (BSN, PESEL, NHS, …) no longer false-positive on repeated digits or
  simple sequential runs — the kind that turn up in pasted source code and sample data.

### Notes

- Detection now spans **20 structured identifiers plus 9 secret classes**; date of birth stays
  **off by default**. Person names and street addresses remain out of scope by design — they need
  a named-entity model, which would forfeit the deterministic, zero-dependency guarantee. Plug one
  in via `extra_detectors` (see `SpanDetector`). The [README](README.md#what-it-detects) has the
  full table.

## [0.3.0] — 2026-07-09

First public releases (0.1.0–0.3.0, cut the same day). The deterministic core:

- `SovereignShield.sanitize()` / `.rehydrate()` — the tokenize → call → restore round-trip,
  fail-closed: it raises `DataLeakError` rather than let a structured identifier survive into the
  outbound text.
- Detectors: Swiss AHV/AVS (EAN-13), IBAN (mod-97), credit-card PAN (Luhn), Swiss phone, email,
  and an off-by-default date-of-birth matcher.
- An OpenAI-compatible sanitizing reverse proxy (`sovereign-shield-proxy`) with SSE streaming
  rehydration across chunk boundaries, and a LangChain wrapper (`ShieldedChatModel`). See
  [ADR 0001](docs/adr/0001-openai-compatible-proxy.md).
