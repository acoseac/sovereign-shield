# ADR 0003 — Secret detection & user-defined custom blocklists

**Status:** Accepted · **Date:** July 2026

## Context

The shield detected 20 identifier types — national IDs, IBANs, cards, email, phone
— every one validated by a checksum, which is why it can claim "no false positives".
That covers privacy/compliance data but misses the class of secrets that developers
and engineering teams leak most: API keys, access tokens, JWTs, private keys, and
org-internal names (project code names, client names, internal domains). Those users
still refrained from pasting stack traces and config files into ChatGPT/Claude.

Two capabilities close that gap, and they have fundamentally different natures:

- **Secrets / API keys** are *fixed, well-known shapes* — the same for everyone. They
  belong in the shared detection engine so all three deliverables (Python proxy, web
  demo, extension) gain them at once.
- **Custom blocklists** are *per-user runtime configuration*. There is no universal
  ground truth to parity-lock; they can only live where the config lives.

## Decision

### 1. Secret detectors are first-class, parity-locked — but regex-only

Nine detectors (`private_key`, `jwt`, `aws_key`, `anthropic_key`, `openai_key`,
`github_token`, `google_api_key`, `slack_token`, `stripe_key`) are added to the
source of truth (`src/sovereign_shield/pii.py`), mirrored byte-for-byte in the TS
port (`web/lib/shield.ts`), and pinned by the generated parity vectors. This
**deliberately relaxes the "checksum-validated" rule**: secrets have no check digit,
so they are matched by anchored, high-specificity vendor prefixes instead (`AKIA…`,
`sk-ant-…`, `ghp_…`, `-----BEGIN … PRIVATE KEY-----`). JWTs additionally validate
their header (base64url-decode → JSON object with an `alg` key) to stay airtight. We
accept the small residual false-positive risk this trades for the coverage, and keep
it low by refusing generic high-entropy / `api_key=…` heuristics (they trip on UUIDs,
hashes and git SHAs) — the custom blocklist is the opt-in escape hatch for
org-specific shapes.

Two constraints keep the ports identical and safe:

- **Explicit ASCII lookarounds, never `\b`/`\w`.** Python's boundaries are
  Unicode-aware; JS's are ASCII. `(?<![A-Za-z0-9_-]) … (?![A-Za-z0-9_-])` matches
  identically in both engines. `[\s\S]` (never `.`/`DOTALL`) spans multi-line PEM.
- **Secrets run first in the detector list.** A base64/JWT interior can contain a
  `-`-bounded 13-digit run that a numeric ID detector (`za_id`, `nl_bsn`) would
  otherwise claim, dropping the overlapping secret span and leaking the rest of the
  token. Claiming the whole secret span first neutralizes this. Token prefixes stay
  pure-uppercase-letters (`OPENAI`, not `OPENAI_KEY`) so `core.py`'s leftover-token
  regex `\[[A-Z]+_\d+\]` still recognizes them.

### 2. Custom blocklists are extension-only and never touch parity

The custom keyword/regex layer (`extension/src/custom.ts`) is not in the shared
engine and not parity-locked — it is user runtime config with no Python equivalent.
It runs alongside the built-in detectors inside `Session.tokenize`, and custom
matches **lose to built-in PII on overlap** (mirroring the Python core `_spans`
rule), so a custom rule can never shadow a real identifier.

Because user regex is the one input that can hang a synchronous send — the guard's
load-bearing "never block a send" invariant — safety is layered:

- **Literal substring is the default; regex is an explicit per-rule opt-in.** Literal
  rules are compiled to an escaped RegExp (so they can never ReDoS) and are
  whole-word by default so a short code name doesn't rewrite the middle of a longer
  identifier during generation.
- **Catastrophic patterns are rejected statically** (a nested-quantifier check that
  never executes the pattern) at both save time and compile time, plus a save-time
  timing probe on a short pathological input for the slow patterns the static check
  misses. Invalid/unsafe regexes are shown inline in options and **never written to
  storage**, so they cannot reach the send path.
- **Match-time caps** (skip oversized inputs, cap matches per rule, advance past
  zero-width matches) and a **fail-open** try/catch: any surprise yields zero custom
  hits and leaves built-in redaction fully intact.

Config crosses to the MAIN world as a **JSON** `data-ss-custom` attribute (not the
comma-joined channel used for categories — patterns can contain commas), parsed in a
try/catch. Custom redactions mint `[CUSTOM_n]` tokens and surface in the pill (by the
rule's own label) and the activity log (category-only — the matched value and the
label are never persisted).

## Consequences

- Secret detection ships across the proxy, web demo, and extension from one change;
  the extension picks it up on its next build. Regenerate parity vectors whenever a
  detector changes (`python scripts/gen_shield_vectors.py`, then `npm run parity`).
- The "no false positives" claim now applies only to the checksum-validated
  identifiers; secrets are shape-matched and custom rules are user-defined. UI and
  store copy say so.
- A determined user can still write a pathological regex that slows their own send;
  the static check, timing probe, and match-time caps make this rare and bounded, and
  it is self-inflicted on the user's own machine.
