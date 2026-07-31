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
  isolated world. Also hosts `clipboard.ts` and `inspector.ts` — see the rehydration
  boundary below for why those two live here and not in the isolated world.
- `bridge.ts` — ISOLATED world. Bridges MAIN ↔ extension storage (settings, activity
  log) via `window.postMessage` + `data-ss-*` attributes on `<html>`.
- `indicator.ts` — ISOLATED world. The pre-send **pill** (counts identifiers before you
  send) and the **send canary**. Purely additive: `pointer-events:none`, never mutates the
  composer, **cannot block a send** (rule this out first when a send breaks). The one
  interactive child is the pill's `Inspect` button, which re-enables pointer events on
  itself only and cancels its own `mousedown` so it can't steal composer focus. It
  **renders** the count but no longer computes it — see `pending.ts`.
- `pending.ts` — MAIN world. Computes what the guard would keep local for the composer's
  current text and publishes `{count, categories, surrogatable}` on `data-ss-pending`. It runs
  in MAIN because `Session.excused` (the inspector's "stop redacting this") holds **real
  values**, and sending those to the isolated world to filter there is precisely what ADR 0005
  rules out. Only counts and labels cross. The pill falls back to computing locally if the
  attribute is missing or malformed, so a page scribbling on it degrades to the old behaviour
  rather than lying.

**Transport is per-site** — only the one transport each site actually uses is hooked
(so we never initiate a site's unrelated cross-origin beacons):
- **Gemini** → XHR `StreamGenerate`, url-encoded `f.req` (`kind: "freq"`).
- **ChatGPT / Claude** → `fetch`, JSON body (`kind: "json"`).

**Adding or changing a site is a two-file edit, and the build enforces it.** Hosts, transports
and endpoint fingerprints all live in [`extension/src/sites.ts`](extension/src/sites.ts);
`manifest.json` is static JSON and cannot import it, so `build.mjs` **fails the build** if the
two disagree. Both halves of that drift used to be silent — a host only in `sites.ts` never gets
a content script, and a host only in the manifest falls through to "unknown", which hooks *both*
transports. Pinned by [`extension/test/sites.test.ts`](extension/test/sites.test.ts).

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
- **The rehydration boundary** — real values may surface on exactly **three** surfaces:
  the painted DOM, the **clipboard** (`clipboard.ts`), and the **inspector panel**
  (`inspector.ts`). Never the stream, never `chrome.storage`, never a `postMessage`,
  never the activity log. That last one is why the inspector renders in the MAIN world —
  it's the only surface showing real values, so it runs where they already live and
  nothing has to cross — in a **closed shadow root** (`display:contents` host, so it adds
  no stacking context and `layers.ts` keeps applying), and why "stop redacting this" is
  session-only rather than persisted. The sites' Copy
  buttons serve their own markdown *source*, which the DOM rehydrator never sees; with
  smokescreen on, an unrehydrated copy hands the user a **fabricated** address that reads
  as real. Adding a fourth surface is a boundary decision, not a feature detail.
  Rationale: [ADR 0005](docs/adr/0005-rehydration-boundary.md).
- **Fail loudly when a transport moves** — the endpoint fingerprints in
  [`extension/src/sites.ts`](extension/src/sites.ts) are hardcoded on purpose;
  matching by payload *shape* would have us rewriting bodies we have no model of, against
  both fail-open and byte-faithful. The defect to fix was that breakage was **silent**, so
  `interceptor.ts` bumps `data-ss-seen` per inspected body and `indicator.ts` warns when a
  composer drains with no counter movement (`canary.ts`). Corroborators are deliberately
  generic — a list of per-site send-button selectors would rot on the same schedule as the
  endpoints, and a canary that stops warning is worse than none. Three edges learned the hard way,
  all in `canary.ts`: the baseline it measures a send against is sampled at the **send intent**,
  never at the drain (`sendBaseline`) — Gemini dispatches `StreamGenerate` *before* clearing the
  composer and the rewrite is synchronous inside `xhr.send()`, so a drain-sampled baseline already
  counts the send and the verdict is `missed` at every tick, which no grace window can fix; it
  **polls** `data-ss-seen` for up to `CANARY_GRACE_MS` (12 s) rather than
  checking once, because Gemini's Thinking model issues the generate request seconds after the
  composer clears and a fixed 3 s deadline false-fired on redacted sends; and it does **not** try
  to detect **file attachments** (out of scope — the guard rewrites the typed prompt, never
  uploads), so the warning names attachments as the likely cause instead of asserting the API
  moved. Detecting attachments would need per-site chip selectors — the same rot the canary
  avoids.
  **The warning also reaches the maintainer, but only if the user says so.** The banner offers
  a prefilled GitHub issue and a `mailto:` fallback ([`report.ts`](extension/src/report.ts)),
  carrying site + version + `data-ss-build` and **nothing else** — pinned by
  [`report.test.ts`](extension/test/report.test.ts), which asserts that no prompt content,
  redacted value, placeholder or custom term can appear in either link. This is the project's
  **only** outbound channel and it is not telemetry: the user clicks, or nothing happens. Two
  paths because most users are not developers, and requiring a GitHub sign-in at the moment
  something breaks would filter out most of the reports worth having. The `site` value must
  match a dropdown option in `.github/ISSUE_TEMPLATE/site-stopped-working.yml` exactly, which
  is why that template lists bare hostnames.
- **No session reset on SPA navigation** — ChatGPT and Claude rewrite the URL from `/` to
  `/c/<uuid>` *after* the first message of a new chat is sent, so a route-change reset
  wipes the mapping for the message streaming right then and paints `[EMAIL_1]` into its
  own reply. Growth is bounded by `MAX_MAPPINGS` (oldest evicted first) instead. Counters
  are never rewound by eviction/`forget`/`clear`: a re-typed value must get a *fresh*
  token, or the rehydrator restores the new value into an old message showing that token.
  The cost is that an evicted placeholder no longer restores in far scrollback — degraded
  display, never a leak.
- **Overlay stacking lives in `layers.ts`** — banner > panel > pill, in one place because
  it spans three files and two worlds. The breakage banner stays on top deliberately: "this
  send was not inspected" must never be covered, least of all by our own UI reassuring the
  user things are fine.
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

**Gotcha:** tests run on Node's **strip-only** TypeScript support, so `src/` must avoid
syntax it can't strip — notably constructor **parameter properties** (`constructor(private
readonly x: T)`). esbuild handles them fine, so this only shows up the moment a file gains
its first test.

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
  Item id `fbdenbfhigickkdcokpchmklopkfkkbf`; listing copy is `extension/STORE_LISTING.md`.
- **A user-facing change is not done until every surface that states a version or a feature
  set says the same thing.** This rule used to name only `STORE_LISTING.md`, and the other
  four drifted three releases behind — 0.6.0 shipped while the site and blog still advertised
  0.3.2 and none of the 0.4–0.6 features. The full list:

  | Surface | What goes stale |
  |---|---|
  | `extension/STORE_LISTING.md` | status header, "What's new" note, description, screenshots, permission justifications |
  | `web/app/extension/page.tsx` | version string + feature copy + meta description + screenshots |
  | `web/app/extension/privacy/page.tsx` | **what the extension collects, stores or sends** + the `metadata.description` |
  | `README.md` | the detector tables under *What it detects* |
  | ars.md blog — `src/pages/sovereign-shield.astro` | the extension card's version + blurb |
  | ars.md blog — post frontmatter and "this post describes X" banners | `seoTitle`/`description` and forward-pointers outlive the post's narrative |

  The blog lives in a **separate repo** (`github.com/acoseac/blog`, Astro) with its own
  `CLAUDE.md` — easy to forget precisely because it is not in this working tree.

  The privacy-policy row is not copy — it is a public claim about data handling, so a release
  that changes what is collected, sent or persisted makes it **wrong**, not merely dated. 0.7.0
  added the opt-in breakage report while the page still said nothing ever leaves your device.
  The procedure, and a grep that catches the version strings, is in
  [extension/RELEASING.md → After it goes live](extension/RELEASING.md#after-it-goes-live).

## Python proxy & web demo (quick reference)

- **Proxy** — root [README.md](README.md). Dev: `pip install -e ".[dev]"`, then
  `ruff check . && ruff format --check . && mypy && pytest`.
- **Web** — [web/README.md](web/README.md). Dev: `npm run dev`; CI runs
  `npm run parity && npm run build`.

## Conventions

- Branch off `main`, open a PR, **squash-merge**, delete the branch. Land only with CI
  green — jobs are `python (lint · type · test · parity)`, `web (shield parity · build)`,
  `extension (typecheck · test · build)`, plus SonarCloud + Vercel.
- **Wait for the review bots before merging — but don't block on them.** CodeRabbit and
  Gemini Code Assist review each PR, often within minutes. Give them a window, then apply
  the fixes that hold up and push; if a round produced many fixes, wait for a **second**
  round before merging, since the bots re-review each push and a fix can introduce its own
  problem. Evaluate critically — they are frequently right but also assert things that are
  verifiably wrong, so check before applying and say which suggestions you rejected and why.
  - **Both bots hit quotas on this account, routinely.** Gemini Code Assist has a daily
    quota; CodeRabbit applies *adaptive* Fair-Usage limits with ~51-minute cooldowns that
    repeat. On PR #50 neither produced a review across ~80 minutes and four attempts, then
    CodeRabbit's landed 7 minutes after the merge — carrying three real findings, one of
    them user-facing. So: **check once, and if both are quota-blocked, say so and ask
    whether to merge on CI alone or hold.** Don't burn a session retrying. If you do merge
    without review, check back afterwards and fix forward.
  - **Read CodeRabbit's walkthrough comment body, not the comment list.** It *edits that one
    comment in place*, so a finished review, a failure, or a rate-limit notice never shows up
    as a new comment and `gh pr view --json comments` looks unchanged. Fetch it with
    `gh api repos/OWNER/REPO/issues/comments/<id>` (note `issues/comments/<id>` — the
    `issues/<pr>/comments/<id>` form 404s) and look for "Actionable comments posted" or
    "Review limit reached".
  - **Sign commits (`git commit -s`) BEFORE opening the PR.** The `dco` job requires a
    `Signed-off-by:` trailer matching each commit's author; fixing it afterwards means a
    force-push, and **a force-push mid-review makes CodeRabbit abort** ("head commit changed
    during the review"). `@coderabbitai review` will *not* recover it — CodeRabbit is
    incremental and considers those commits reviewed. Use `@coderabbitai full review`.
- Disjoint changes open as **parallel** PRs against `main`, not stacked.
- Architecture decisions live in `docs/adr/`.
