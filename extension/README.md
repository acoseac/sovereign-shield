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

**Install** it from the [Chrome Web Store](https://chromewebstore.google.com/detail/sovereign-shield-%E2%80%94-llm-pi/fbdenbfhigickkdcokpchmklopkfkkbf),
or build it from source ([below](#build--load)).

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
| `clipboard.ts` | `MAIN` | the page's `copy` event + `navigator.clipboard` | rehydrate what you copy, so the clipboard matches the screen |
| `inspector.ts` | `MAIN` | the live value↔placeholder map | the pre-send diff and the mapping drawer — MAIN because it's the only surface that shows real values, so nothing has to cross a world boundary |
| `indicator.ts` | `ISOLATED` | `chrome.*` ✓, composer DOM ✓ | the pre-send pill, its `Inspect` button, and the send canary |
| `bridge.ts` | `ISOLATED` | `chrome.*` ✓, page globals ✗ | push settings to the page (`data-ss-*`), forward redaction events to the worker, answer the popup |
| `background.ts` | service worker | `chrome.action` ✓ | paint the per-tab badge, swap the active/paused icon, single writer for the activity log |
| `popup.ts` / `options.ts` | extension pages | `chrome.*` ✓ | on/off, per-category toggles, activity log + Clear |

They share the DOM but not their globals, so they pass values through `data-*` attributes on
`<html>`: `data-ss-enabled` (bridge → guard), `data-ss-kept` (guard → bridge → popup),
`data-ss-seen` (guard → indicator, the inspected-request counter behind the send canary), and
`data-ss-build` (a build stamp, so a reload can be verified from the page — unpacked extensions
keep running old code until you hit ↻ on the card).

The request rewrite is **structure-agnostic**: it walks every *string* in the parsed
body and tokenizes it (numbers — timestamps, request ids — left alone), so it does not
depend on any provider's exact field layout and survives their reshuffles.

## Settings, badge & activity log

- **Toolbar badge** — how many identifiers were kept local on the current tab (resets per page load).
- **Fail-open alert** — if a body-parse error ever lets a request through unredacted, the badge turns **red with `!`** so the bypass is never silent.
- **Uninspected-send warning** — if a message goes out that the guard never got a look at (the likeliest cause being that the site moved its internal API), an amber banner says so and the badge turns amber `?`. Distinct from fail-open on purpose: there the guard read the body and fumbled it, here it never saw it, and the remedy differs. See [below](#when-a-site-changes-its-api).
  The banner offers **Report this** (a prefilled GitHub issue) and an email fallback. Both are yours to click or ignore — there is no telemetry here, so a report is the only way we learn a site broke. They carry the site, the extension version and the build stamp, and **never any part of your prompt**; `test/report.test.ts` asserts exactly that.
- **Stale-tab banner** — after you update the extension, tabs that were already open show a "reload this tab" nudge; their old content script can't protect you until reloaded (`chrome://extensions` ↻ updates the code, not the open tabs).
- **Popup** (click the icon) — on/off toggle, the live count, and a link to the full page.
- **Options page** (the popup link, or `chrome://extensions` → Details → Extension options) — choose which categories to block, and view the activity log.
- **Activity log** — records **type + time + site only, never the value** (not even masked). A rolling window of the last 200 events with a one-click Clear. The value↔placeholder map stays in page memory and is never written to disk, so the "nothing sensitive is persisted" promise holds.
- **Smokescreen mode** (opt-in, off by default) — see below.

## The inspector panel

The pre-send pill has an **Inspect** button. It opens a side panel with two tabs:

- **Preview** — your prompt and what the provider actually receives, side by side, with the
  replaced spans marked on both. The preview is computed by the *same* session object that will
  do the real send, so the placeholders it shows are the placeholders the model gets — not a
  plausible-looking re-derivation that could disagree.
- **Mappings** — every live `placeholder ↔ value` pair this tab is holding. **Next stand-in**
  rotates a smokescreen value to another one from the vetted pool (free text is not offered: a
  hand-typed stand-in could be a real person's address). **Stop redacting** excuses a false
  positive for the rest of the tab's life.

Two things the panel tells you rather than hides: excusing a value is **never written to disk**,
so a reload redacts it again, and messages already sent keep their placeholder and stop being
restored on screen. It shows real values, so close it before you share your screen.

## What you copy matches what you see

Every supported site renders markdown, and its **Copy** button serves the markdown *source* —
which is not what's painted on screen. Without this, copying a reply gave you `[EMAIL_1]`; with
smokescreen on it gave you a **fabricated** address that reads as real, straight into whatever
you pasted it into. Copying now restores the real values, in both the plain-text and rich-text
flavours, so a paste into Gmail or Slack matches what you were reading.

## When a site changes its API

These are private, undocumented endpoints and they do move. The guard matches them by URL and
deliberately does *not* fall back to guessing from the payload's shape — that would mean
rewriting request bodies it has no model of.

What it does instead is notice. Every inspected request bumps a counter; if you send a message
and the counter doesn't move, an amber banner tells you the prompt went out **as you typed it**.
Silent breakage is the failure mode that actually costs you something, so it's the one that's
engineered against. If you see that banner,
[open an issue](https://github.com/acoseac/sovereign-shield/issues) — it means the matcher needs
updating.

## Smokescreen mode

Models get noticeably worse at *generative* work — draft this email, fix the grammar,
reformat this — when the prompt is full of `[EMAIL_1]`. They address the placeholder, or
write copy that reads wrong once the real value comes back. Smokescreen sends a realistic
stand-in instead:

```
you type:   "Reply to hans.muster@bluewin.ch about the invoice"
sent:       "Reply to alice.morgan@example.org about the invoice"   ← reads naturally
you see:    "...I've drafted a reply to hans.muster@bluewin.ch..."   ← restored as usual
```

**It applies to emails and your custom terms only.** IDs, IBANs, cards and secrets always
use bracket placeholders, and always will: a checksum-*valid* fake AHV or IBAN could be a
real person's actual number, so the guard never invents one. Stand-in addresses use only
[RFC 2606](https://www.rfc-editor.org/rfc/rfc2606) reserved domains (`example.org`), which
cannot route mail.

Two honest caveats. Restoration matches the stand-in literally (word-boundary fenced, and
case-insensitively, so re-casing survives) — if the model *reformats* it, the text keeps the
harmless stand-in instead of the real value. And a transcript no longer announces that
redaction happened the way `[EMAIL_1]` did; the pre-send pill says so instead.
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

`npm run typecheck` runs `tsc --noEmit` and `npm test` runs the unit tests (`node --test`
over the pure detector/summary logic — no test-runner dependency); the build itself uses
esbuild and needs neither. CI runs typecheck + test + build on every push and PR.

To cut a new version (bump → package → tag `extension-v*` → Chrome Web Store) and to
regenerate the store screenshots and promo tile, see [RELEASING.md](RELEASING.md)
(the generators live in [`store-assets/`](store-assets/)).

## Known limits (read before trusting it)

- **Fail-open.** If the body parser ever throws, the guard lets the original request
  through rather than break your chat (and flips the badge red `!`). That favours
  availability over secrecy — a production build should fail-closed. See `interceptor.ts`.
- **Settings ride on the DOM — a hostile first-party page could disable the guard.** The
  bridge writes `data-ss-enabled` / `data-ss-cats` on `<html>`; the MAIN-world interceptor
  reads them. Any script on a supported site can set `data-ss-enabled="off"` to switch the
  guard off silently. This is accepted, not overlooked: the interceptor shares the MAIN
  world with the page, so no channel between them is truly page-opaque — and a page hostile
  enough to disable the guard can already read what you type straight from its own input
  box. The guard defends against a site's *normal* egress, not a site actively attacking you.
- **Format-dependent.** We match each site's known generate endpoint (Gemini
  `StreamGenerate`, ChatGPT `/backend-api/…/conversation`, Claude `/…/completion`). If a
  provider renames its endpoint or restructures the payload, the guard stops acting on
  that site until the selector is updated — it fails safe (passes traffic through).
- **Structured identifiers only.** Names and street addresses are out of scope — they
  need an NER model, which this does not ship (same boundary as the core library).
- **Typed prompt only — not attachments.** The guard rewrites the outgoing prompt; a **file you
  upload** (a document, a codebase) rides a separate request the guard doesn't touch and reaches
  the provider as-is. Attachments are an unguarded channel by design. This is also why the
  uninspected-send banner names attachments as the likely cause before suggesting the API moved.
- **Re-encoding.** The outgoing body is re-serialised (JSON re-stringify, or
  `URLSearchParams` for Gemini); standard encodings, but if a provider ever depends on an
  exact byte layout this could matter.
- **Native "Copy" / "Edit message" can surface a token.** The guard restores values in the
  *rendered* reply, but the site's own React/Vue state still holds the tokenized string. If
  you use the platform's built-in Copy button or re-open a past prompt with "Edit", you may
  see or copy `[AHV_1]` rather than the value. Copy from the visible text, or keep the
  original to hand. Intercepting the page's clipboard/edit paths would fix it but adds real
  regression risk, so it is left as a known limit for now.
- **Token split across DOM nodes.** Rehydration runs per text node. In the rare case a
  streaming UI paints one token across separate sibling nodes
  (`<span>[AHV_</span><span>1]</span>`) instead of one growing text node, the halves never
  match and stay redacted. Not observed on the three supported sites (short tokens render
  atomically), so it is noted rather than pre-emptively engineered around.
## Troubleshooting

- **Gemini sometimes needs a second Enter.** If a pasted message doesn't send on the first
  Enter — the text just sits in the composer — press Enter again, or click the send arrow
  (▲). This is Gemini's own editor dropping the first Enter when it fires before the send
  handler is wired; it reproduces with this extension **fully removed** (confirmed by an
  A/B test). The guard only rewrites the outgoing network request and has no code in the
  keypress/submit path, so it cannot be what swallows the Enter. Pausing about a second
  after pasting, before hitting Enter, also avoids it.

## Privacy

The value↔token map lives only in page memory for the life of the tab. It is never
persisted, never sent anywhere. The only things stored (via `chrome.storage.local`) are
your settings (on/off, category toggles) and the value-free activity log (type + time +
site).
