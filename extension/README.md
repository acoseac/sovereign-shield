# Sovereign Shield — Gemini guard (Chrome MV3, MVP)

A browser extension that redacts Swiss and EU identifiers **before** they leave your
machine for Gemini, then restores them in the reply so the conversation still reads
normally. Everything happens in the page. Nothing is uploaded, no API key, no server.

It reuses the exact detector from the [sovereign-shield](https://github.com/acoseac/sovereign-shield)
library — the same `web/lib/shield.ts` that is kept byte-for-byte in parity with the
Python source. Detection is regex + checksum (Swiss AHV, IBAN worldwide, Italian/
Spanish/French/Dutch national IDs, card via Luhn, plus phone and email), so clean text
passes through untouched and there are no false positives.

> **Status: MVP / experiment.** The design is grounded in real Gemini traffic (see
> below), but Google's wire format is private and changes often. Treat this as a
> working proof of concept, not a hardened product. Test it before you rely on it.

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

Confirmed by inspecting live `gemini.google.com` traffic:

- **Transport is `XMLHttpRequest`, not `fetch`.** A fetch-only hook (the approach most
  ChatGPT extensions use) would silently do nothing on Gemini. This hooks XHR.
- **The generate call is** `POST /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`
  (`rt=c` streaming), with the prompt inside the url-encoded `f.req` field. We match on
  `StreamGenerate`. It is *not* `batchexecute` — that path only carries side RPCs (history,
  titling). Verified live: an earlier `batchexecute`/`aPya6c` matcher never fired.
- **The response stream is length-prefixed** (each chunk announces its byte count), so
  restoring values by editing `responseText` desyncs the parser and hangs generation. We
  let the stream parse untouched and swap token→value in the **rendered DOM** (a
  `MutationObserver`) instead. Verified live.
- **The page enforces Trusted Types + a strict CSP**, so you cannot inject a `<script>`
  to patch the page's XHR. The only way in is a manifest `world: "MAIN"` content script,
  which is CSP-exempt. That is why the guard is split in two (below).

## Architecture

Two content scripts, because the worlds have complementary powers:

| File | World | Can it… | Job |
| --- | --- | --- | --- |
| `interceptor.ts` | `MAIN` | page's real `XMLHttpRequest` ✓, `chrome.*` ✗ | patch `open`/`send`, tokenize the enabled categories in `f.req` on `StreamGenerate`, rehydrate the rendered DOM, emit per-redaction events (category only) |
| `bridge.ts` | `ISOLATED` | `chrome.*` ✓, page globals ✗ | push settings to the page (`data-ss-*`), forward redaction events to the worker, answer the popup |
| `background.ts` | service worker | `chrome.action` ✓ | paint the per-tab badge, swap the active/paused icon, single writer for the activity log |
| `popup.ts` / `options.ts` | extension pages | `chrome.*` ✓ | on/off, per-category toggles, activity log + Clear |

They share the DOM but not their globals, so they pass two values through `data-*`
attributes on `<html>`: `data-ss-enabled` (bridge → guard), `data-ss-kept`
(guard → bridge → popup), and `data-ss-build` (a build stamp, so a reload can be verified
from the page — unpacked extensions keep running old code until you hit ↻ on the card).

The request rewrite is **structure-agnostic**: it walks every *string* in the `f.req`
JSON and tokenizes it (numbers — timestamps, request ids — are left alone), so it does
not depend on Google's exact array layout and survives their frequent reshuffles.

## Settings, badge & activity log

- **Toolbar badge** — how many identifiers were kept local on the current Gemini tab (resets per page load).
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
select `extension/dist`. Open `gemini.google.com`, click the toolbar icon to confirm the
guard is on, and send a message containing a (synthetic!) identifier.

`npm run typecheck` runs `tsc --noEmit` if you want types checked; the build itself uses
esbuild and does not require it.

## Known limits (read before trusting it)

- **Fail-open.** If the body parser ever throws, the guard lets the original request
  through rather than break your Gemini. That favours availability over secrecy — a
  production build should fail-closed (abort the send). See the comment in
  `interceptor.ts`.
- **Format-dependent.** We match the `StreamGenerate` endpoint + the `f.req` envelope. If
  Google renames the endpoint or restructures the payload, the guard stops acting until the
  selector is updated. It fails safe (passes traffic through), not loud.
- **Structured identifiers only.** Names and street addresses are out of scope — they
  need an NER model, which this does not ship (same boundary as the core library).
- **Re-encoding.** The outgoing body is re-serialised via `URLSearchParams`; standard
  url-encoding, but if Gemini ever depends on an exact byte layout this could matter.
- **Not in CI.** This sub-project has its own `package.json` and is built manually; the
  repo's Python + web pipelines do not touch it yet.

## Privacy

The value↔token map lives only in page memory for the life of the tab. It is never
persisted, never sent anywhere. The only thing stored (via `chrome.storage.local`) is
the on/off toggle.
