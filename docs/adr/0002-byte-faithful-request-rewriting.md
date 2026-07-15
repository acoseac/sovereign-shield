# ADR 0002 — Byte-faithful request rewriting in the browser extension

**Status:** Accepted · **Date:** July 2026

## Context

The extension's guard (`extension/src/interceptor.ts`, MAIN world) redacts an
outgoing prompt by rewriting the body of each chat UI's generate call: Gemini over
XHR (url-encoded `f.req`, `kind: "freq"`), ChatGPT/Claude over `fetch` (JSON body,
`kind: "json"`).

The original freq path parsed the body with `URLSearchParams`, re-serialized
`f.req` through `JSON.parse → walk → JSON.stringify`, and rebuilt the whole body
with `URLSearchParams.toString()` (plus a `+`→`%20` fix-up) on **every** send —
even when nothing was redacted.

The failure that surfaced this: pasting a **clean** prompt (no checksum-valid PII)
full of ordinary punctuation into Gemini's **"thinking"** model silently failed to
send, while the default model sent the same text fine — same endpoint, same code
path. Root cause: the `URLSearchParams` round-trip is not a byte-identity even on
clean text. It drops the client's trailing `&` and re-percent-encodes `' ( ) ! ~`
(characters the page sends literally). The default `StreamGenerate` backend
tolerates the reshaped body; the stricter thinking backend rejects it. The guard
was corrupting a request it had no reason to touch.

## Decision

The guard is **byte-faithful**: a request it does not need to redact must reach the
provider **exactly** as the page composed it. The correct output for a clean prompt
is, by definition, the input — so don't re-encode it.

Implemented as a pure, DOM-free `extension/src/rewrite.ts`:

1. Walk the parsed body; a `changed` flag flips only when a string is actually
   tokenized. `Session.tokenize` returns the *same string reference* when it makes
   no substitution, so reference identity is a reliable "did this change" signal.
2. **Nothing changed → return the original body string unchanged** (both `json` and
   `freq`). This is the common case and the whole fix.
3. **Something changed →** for `freq`, swap only the `f.req` value in place inside
   the original body (`body.replace(/(^|&)(f\.req=)[^&]*/, …)`), preserving param
   order, the `at` token's encoding, and any trailing separator; for `json`,
   re-serialize (the entire body *is* the JSON).

The invariant is pinned by `extension/test/rewrite.test.ts`: byte-identity on clean
Gemini bodies (including the punctuation classes above) and a minimal in-place swap
that preserves every other byte when a value is redacted.

## Alternatives considered

- **Keep re-encoding, but "restore" the encoding differences.** Fragile — you'd be
  reverse-engineering each provider's exact encoder and chasing it as they change.
  Byte-identity sidesteps the whole problem.
- **Special-case the characters we observed** (trailing `&`, the five punctuation
  chars). Treats symptoms; the real contract is "don't mutate what you didn't
  redact."
- **Rebuild via `URLSearchParams` but guard on `changed`.** Fixes the clean case but
  still re-encodes untouched params (`at`, others) whenever redaction *does* happen.
  The in-place `f.req` swap keeps the blast radius to the redacted span alone, so
  even a PII-bearing prompt survives the strict backend.
- **Big-integer precision worry.** Gemini nests its payload as a JSON *string* inside
  `f.req`, so the outer parse/stringify never sees the big conversation IDs as
  numbers. The real risk was the encoding round-trip, not numeric precision — which
  is why the fix targets encoding faithfulness, not a number-preserving serializer.

## Consequences

- For the overwhelmingly common case (no PII in the prompt), the guard is now a
  provable **no-op**: the extension-enabled request is byte-identical to the
  extension-off request, so it cannot be the cause of a failed send. That guarantee
  is what fixed Gemini thinking-mode — no need to pin down the backend's exact
  rejection rule.
- The rewrite logic is DOM-free and unit-tested in isolation; previously it was
  entangled with the interceptor's `window`/`document` side effects and untestable.
- "Byte-faithful" is now a named, testable contract. A future refactor that
  reintroduces a whole-body re-serialize fails `rewrite.test.ts`.
- Trade-off: the redaction path assumes `f.req` is a locatable `f.req=<value>`
  parameter (true for Gemini today). If a provider's freq shape ever differs, the
  in-place swap must be revisited — but the fail-open path (return the original body
  on any parse surprise) still protects traffic in the meantime.
