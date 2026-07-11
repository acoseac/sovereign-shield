# Sovereign Shield — LLM PII guard (Chrome MV3)

A browser extension that redacts Swiss, EU and international identifiers **before** they leave
your machine for **Gemini, ChatGPT, or Claude**, then restores them in the reply so the
conversation still reads normally. Everything happens in the page. Nothing is uploaded,
no API key, no server.

It reuses the exact detector from the [sovereign-shield](https://github.com/acoseac/sovereign-shield)
library — the same `web/lib/shield.ts` that is kept byte-for-byte in parity with the
Python source. Detection is regex + checksum — Swiss AHV, IBAN worldwide, card (Luhn), and
national/tax/health IDs across the EU (IT/ES/FR/NL/DE/PL/PT/BE), UK, Brazil, South Africa,
China, Canada and India, plus phone and email — so clean text passes through untouched and
there are no false positives.

> **Status: experiment.** The design is grounded in real traffic from each site (see
> below), but these wire formats are private and change often. Treat this as a working
> proof of concept, not a hardened product. Test it before you rely on it.

## What it does

```
you type:   "Refund AHV 756.1234.5678.97 to IBAN CH9300762011623852957"
                     │
   guard tokenizes the outgoing request  ▼
sent to Gemini: "Refund [AHV_1] to [IBAN_1]"      ← real numbers never leave the page
                     │
   Gemini replies about [AHV_1] / [IBAN_1]         ▼
   guard restores them as you read the stream
you see:    "...the refund for AHV 756.1234.5678.97 to IBAN CH9300762011623852957..."
```

## How we know it works this way

Endpoints confirmed by inspecting live traffic on each site:

| Site | Generate endpoint | Transport | Body |
| --- | --- | --- | --- |
| Gemini | `…/BardFrontendService/StreamGenerate` | `XMLHttpRequest` | url-encoded `f.req` |
| ChatGPT | `chatgpt.com/backend-api/f/conversation` | `fetch` | JSON (`messages[].content.parts[]`) |
| Claude | `claude.ai/api/organizations/*/chat_conversations/*/completion` | `fetch` | JSON (`prompt`) |

The guard hooks **both `fetch` and `XMLHttpRequest`** and matches by URL — whichever
transport a site uses, the matching hook rewrites the request body. Design points that
drove the shape:

- **Gemini uses XHR, not `fetch`** — a fetch-only hook (the usual ChatGPT-extension
  approach) is a no-op there; ChatGPT/Claude use `fetch`. Hooking both covers all three.
- **Structure-agnostic body rewrite** — it walks every *string* in the parsed body and
  tokenizes it, leaving numbers/ids/enums alone. No dependency on any provider's exact
  field layout, so it survives their churn. The only per-site step is unwrapping the body
  (Gemini's `f.req` vs raw JSON).
- **The response is restored in the rendered DOM, not the stream.** Gemini's stream is
  length-prefixed (each chunk announces its byte count), so editing `responseText` desyncs
  the parser and hangs generation. A `MutationObserver` swaps token→value in the painted
  text nodes instead — transport- and site-agnostic, so one rehydrator covers all three.
- **Gemini enforces Trusted Types + a strict CSP**, so you cannot inject a `<script>` to
  patch the page's fetch/XHR. A manifest `world: "MAIN"` content script (CSP-exempt) is
  the only way in. That is why the guard is split in two (below).

## Architecture

Two content scripts, because the worlds have complementary powers:

| File | World | Can it… | Job |
| --- | --- | --- | --- |
| `interceptor.ts` | `MAIN` | page's real `fetch`/`XMLHttpRequest` ✓, `chrome.*` ✗ | patch `fetch` + XHR `open`/`send`, tokenize enabled categories in each site's generate body, rehydrate the rendered DOM, emit per-redaction events (category only) |
| `bridge.ts` | `ISOLATED` | `chrome.*` ✓, page globals ✗ | push settings to the page (`data-ss-*`), forward redaction events to the worker, answer the popup |
| `background.ts` | service worker | `chrome.action` ✓ | paint the per-tab badge, swap the active/paused icon, single writer for the activity log |
| `popup.ts` / `options.ts` | extension pages | `chrome.*` ✓ | on/off, per-category toggles, activity log + Clear |

They share the DOM but not their globals, so they pass two values through `data-*`
attributes on `<html>`: `data-ss-enabled` (bridge → guard), `data-ss-kept`
(guard → bridge → popup), and `data-ss-build` (a build stamp, so a reload can be verified
from the page — unpacked extensions keep running old code until you hit ↻ on the card).

The request rewrite is **structure-agnostic**: it walks every *string* in the parsed
body and tokenizes it (numbers — timestamps, request ids — left alone), so it does not
depend on any provider's exact field layout and survives their reshuffles.

## Settings, badge & activity log

- **Toolbar badge** — how many identifiers were kept local on the current tab (resets per page load).
- **Fail-open alert** — if a body-parse error ever lets a request through unredacted, the badge turns **red with `!`** so the bypass is never silent.
- **Stale-tab banner** — after you update the extension, tabs that were already open show a "reload this tab" nudge; their old content script can't protect you until reloaded (`chrome://extensions` ↻ updates the code, not the open tabs).
- **Popup** (click the icon) — on/off toggle, the live count, and a link to the full page.
- **Options page** (the popup link, or `chrome://extensions` → Details → Extension options) — choose which categories to block, and view the activity log.
- **Activity log** — records **type + time + site only, never the value** (not even masked). A rolling window of the last 200 events with a one-click Clear. The value↔placeholder map stays in page memory and is never written to disk, so the "nothing sensitive is persisted" promise holds.
- **Icons** — generated from `icons/shield.svg` via `npm run icons`; a greyed variant shows when the guard is off.

## Build & load

```bash
cd extension
npm install
npm run build          # -> extension/dist
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `extension/dist`. Open Gemini, ChatGPT or Claude, click the toolbar icon to confirm
the guard is on, and send a message containing a (synthetic!) identifier.

`npm run typecheck` runs `tsc --noEmit` if you want types checked; the build itself uses
esbuild and does not require it.

## Known limits (read before trusting it)

- **Fail-open.** If the body parser ever throws, the guard lets the original request
  through rather than break your chat (and flips the badge red `!`). That favours
  availability over secrecy — a production build should fail-closed. See `interceptor.ts`.
- **Format-dependent.** We match each site's known generate endpoint (Gemini
  `StreamGenerate`, ChatGPT `/backend-api/…/conversation`, Claude `/…/completion`). If a
  provider renames its endpoint or restructures the payload, the guard stops acting on
  that site until the selector is updated — it fails safe (passes traffic through).
- **Structured identifiers only.** Names and street addresses are out of scope — they
  need an NER model, which this does not ship (same boundary as the core library).
- **Re-encoding.** The outgoing body is re-serialised (JSON re-stringify, or
  `URLSearchParams` for Gemini); standard encodings, but if a provider ever depends on an
  exact byte layout this could matter.
- **Not in CI.** This sub-project has its own `package.json` and is built manually; the
  repo's Python + web pipelines do not touch it yet.

## Privacy

The value↔token map lives only in page memory for the life of the tab. It is never
persisted, never sent anywhere. The only things stored (via `chrome.storage.local`) are
your settings (on/off, category toggles) and the value-free activity log (type + time +
site).
