# CLAUDE.md

Orientation for working in this repo. Kept short on purpose — it links to the
authoritative file rather than restating it. Update it when an invariant changes.

## What this is

`sovereign-shield` is a local-first PII shield for LLM traffic. It is **three
independent deliverables** with **three separate release lanes** — don't conflate them:

| Part | Path | Ships as | Release doc |
|---|---|---|---|
| Python proxy / library | `src/sovereign_shield/`, `tests/` | PyPI `sovereign-shield-ch`, tag `vX.Y.Z` | [RELEASING.md](RELEASING.md) |
| Web demo (shield.ars.md) | `web/` | Vercel | [web/README.md](web/README.md) |
| Chrome extension | `extension/` | Chrome Web Store, tag `extension-vX.Y.Z` | [extension/RELEASING.md](extension/RELEASING.md) |

## The one cross-cutting invariant: shield parity

The PII detection logic exists in **three parity-locked copies**. Changing detection
in one without the others fails CI:

1. **Python is the source of truth** — `src/sovereign_shield/` (`pii`, `shield`).
2. **`web/lib/shield.ts`** is a byte-for-byte TypeScript port. `python scripts/gen_shield_vectors.py --check`
   holds `web/lib/shield/parity-vectors.json` current; `npm run parity` (in `web/`) asserts
   the TS reproduces the Python vectors.
3. **The extension reuses the TS port directly** — `extension/src/tokenize.ts` does
   `import { detectPii } from "../../web/lib/shield.ts"` and esbuild bundles it in. So
   `web/lib/shield.ts` is a **build dependency of the extension**; don't move/rename it
   without fixing that import.

Workflow when you touch detection: edit Python → regenerate vectors → confirm `web`
parity → the extension picks it up on its next build.

## Extension (the active surface)

Read the header comment of [`extension/src/interceptor.ts`](extension/src/interceptor.ts)
first — it is the best map of the live transports.

**Architecture — three content scripts (`extension/manifest.json`):**
- `interceptor.ts` — **MAIN world**, `document_start`. Patches the page's real
  `fetch`/`XHR` to redact the outgoing prompt, and restores tokens in the reply. MAIN
  world is required: Gemini's Trusted-Types + CSP block a script injected from an
  isolated world.
- `bridge.ts` — ISOLATED world. Bridges MAIN ↔ extension storage (settings, activity
  log) via `window.postMessage` + `data-ss-*` attributes on `<html>`.
- `indicator.ts` — ISOLATED world. The pre-send **pill** (counts identifiers before you
  send). Purely additive: `pointer-events:none`, never mutates the composer, **cannot
  block a send** (rule this out first when a send breaks).

**Transport is per-site** — only the one transport each site actually uses is hooked
(so we never initiate a site's unrelated cross-origin beacons):
- **Gemini** → XHR `StreamGenerate`, url-encoded `f.req` (`kind: "freq"`).
- **ChatGPT / Claude** → `fetch`, JSON body (`kind: "json"`).

**Load-bearing invariants (each one has a shipped bug behind it):**
- **Byte-faithful rewrite** — [`extension/src/rewrite.ts`](extension/src/rewrite.ts).
  When nothing is redacted, return the request body **unchanged**; a clean prompt must
  reach the provider exactly as the page composed it. The old freq path re-encoded the
  whole body through a `URLSearchParams` round-trip even on clean text — it dropped the
  trailing `&` and re-percent-encoded `' ( ) ! ~`, and **the Gemini "thinking" model
  rejected the send** (the default model tolerated it, which is why it looked
  intermittent). When redaction *does* happen, swap only the `f.req` value in place.
  Pinned by [`extension/test/rewrite.test.ts`](extension/test/rewrite.test.ts) — do not
  reintroduce a whole-body re-serialize. Rationale:
  [ADR 0002](docs/adr/0002-byte-faithful-request-rewriting.md).
- **Fail-open** — any parse surprise returns the original body untouched. The guard never
  blocks traffic it cannot handle.
- **Rehydrate in the DOM, not the stream** — token→value restore runs on painted text
  nodes via a MutationObserver, never inside the response stream. Gemini's stream is
  length-prefixed; rewriting a chunk desyncs the parser and hangs generation. Composers
  (contenteditable/textarea) are skipped so we never edit what the user is typing.
- **Guard defaults ON** — if the bridge hasn't set the flag yet, redact anyway (fail-safe).
  Smokescreen is the exception: it defaults **OFF**, because it changes what the model sees.
- **Smokescreen stand-ins are re-detectable** — [`extension/src/surrogate.ts`](extension/src/surrogate.ts).
  `alice.morgan@example.org` *is* a valid email, unlike `[EMAIL_1]`. Two rules follow:
  never mint a stand-in for a checksum-validated category (a valid fake AHV/IBAN could be a
  **real** person's number — a category is eligible only if it has a vendored pool), and
  never re-tokenize a value already in `tokenValue` (re-sent history and pasted-back replies
  would otherwise mint a *second* stand-in and break rehydration). The DOM rehydrator's fast
  path must ask `session.mayNeedRehydration()`, never test for `"["` — stand-ins have no
  bracket. Rationale: [ADR 0004](docs/adr/0004-smokescreen-surrogates.md).

**Debugging a reload:** `interceptor.ts` stamps `document.documentElement.dataset.ssBuild`.
MV3 installs the MAIN-world patch at `document_start`, so **open tabs keep the old code
until hard-reloaded** — after reloading the unpacked extension, hard-reload the chat tab
and check `document.documentElement.dataset.ssBuild` in its console.

**Build / test (from `extension/`):**
```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test test/*.test.ts
npm run build       # → dist/ (chrome://extensions → Load unpacked)
npm run package     # → sovereign-shield-<version>.zip for the store
```

**Release landmines** (full procedure in [extension/RELEASING.md](extension/RELEASING.md)):
- Version lives in `extension/manifest.json`. Tag **`extension-vX.Y.Z`**, never bare
  `vX.Y.Z` (that namespace is the PyPI proxy).
- **Never publish a GitHub _Release_ from an extension tag** — `release.yml` fires on any
  published Release and would ship the **Python** package to PyPI. A plain pushed tag
  triggers nothing; that's what we want.
- The Chrome Web Store requires each upload's `version` to be **strictly greater** than
  what's already in the system — you cannot resubmit or replace the same version number.
  Item id `fbdenbfhigickkdcokpchmklopkfkkbf`; listing copy is `extension/STORE_LISTING.md`
  (keep in sync on user-facing changes).

## Python proxy & web demo (quick reference)

- **Proxy** — root [README.md](README.md). Dev: `pip install -e ".[dev]"`, then
  `ruff check . && ruff format --check . && mypy && pytest`.
- **Web** — [web/README.md](web/README.md). Dev: `npm run dev`; CI runs
  `npm run parity && npm run build`.

## Conventions

- Branch off `main`, open a PR, **squash-merge**, delete the branch. Land only with CI
  green — jobs are `python (lint · type · test · parity)`, `web (shield parity · build)`,
  `extension (typecheck · test · build)`, plus SonarCloud + Vercel.
- **Always wait for the review bots before merging.** CodeRabbit and Gemini Code Assist
  comment on every PR, typically within ~6 minutes of opening it. Give them that window,
  then read the comments, apply the fixes that hold up, and push. If a round produced many
  fixes, wait for a **second** round on the new commits before merging — the bots re-review
  each push, and a fix can introduce its own problem. Evaluate critically: they are often
  right, but they also assert things that are simply wrong, so verify before applying and
  say which suggestions you rejected and why.
  - **Sign commits (`git commit -s`) BEFORE opening the PR.** The `dco` job requires a
    `Signed-off-by:` trailer matching each commit's author; fixing it afterwards means a
    force-push, and **a force-push mid-review makes CodeRabbit abort** ("head commit changed
    during the review"). Recover with a `@coderabbitai review` comment.
  - Gemini Code Assist has a **daily quota** and simply posts a quota warning instead of a
    review once it's exhausted — don't wait on it in that case.
- Disjoint changes open as **parallel** PRs against `main`, not stacked.
- Architecture decisions live in `docs/adr/`.
