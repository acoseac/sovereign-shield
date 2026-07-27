# ADR 0005 — The rehydration boundary: where real values may surface

**Status:** Accepted · **Date:** July 2026

## Context

The guard's promise has two halves. The redaction half is well covered — the request rewrite is
byte-faithful ([ADR 0002](0002-byte-faithful-request-rewriting.md)), detection is parity-locked
against the Python source, and stand-ins are constrained to vetted pools
([ADR 0004](0004-smokescreen-surrogates.md)).

The restoration half was never written down. `interceptor.ts` restored `token → value` in
**painted text nodes**, and that was simply the one place it happened. Nobody had asked which
*other* surfaces show the user their prompt or the model's reply, and whether those surfaces
agreed with the screen.

The answer turned out to be "no, and it matters". Every supported site renders markdown, and
their **Copy** buttons serve the markdown *source* held in the page's own JS state — which the
DOM rehydrator never touches. So the screen and the clipboard disagreed:

- With bracket tokens, the user copies `[EMAIL_1]` and pastes a broken draft. Annoying, obvious,
  self-correcting.
- **With smokescreen on, the user copies `alice.morgan@example.org` and pastes a *fabricated*
  address believing it is real.** ADR 0004 predicted the shape of this ("a user reading a chat
  transcript out of context can no longer tell at a glance that redaction happened") but treated
  it as a presentation concern. The clipboard is the mechanism by which it becomes a data
  integrity failure: fabricated contact details leaving in a real email.

This was reported to us as the opposite problem — that copying leaks *real* PII to the clipboard,
and we should offer a sanitized copy. That framing conflates *kept local from the provider* with
*hidden from the user*. Restoring the user's own data on screen is the entire feature; the defect
was that one surface had been left out of it.

Two new surfaces landing at the same time — the clipboard, and an inspector panel that displays
the live mapping table — made it worth deciding the general rule rather than patching each case.

## Decision

**Real values may surface on exactly three surfaces, and nowhere else.**

| Surface | Where | Why it is allowed |
|---|---|---|
| The painted DOM | `interceptor.ts` | The user reading their own conversation. The original feature. |
| The clipboard | `clipboard.ts` | What the user copies must match what they were shown. |
| The inspector panel | `inspector.ts` | The user auditing what the guard holds, on request. |

**Nowhere else** means, explicitly and permanently:

- **not the response stream** — Gemini's is length-prefixed, so rewriting a chunk desyncs the
  parser and hangs generation (this is why restoration is a DOM concern at all);
- **not `chrome.storage`** — the activity log stays category + time + host, never a value, not
  even masked. This is what makes "nothing sensitive is persisted" checkable rather than
  aspirational, and it is why the inspector's "stop redacting this" allowlist is session-only:
  persisting it would mean writing a real PII value to disk;
- **not a `postMessage`** — the MAIN↔ISOLATED bridge carries category names and bare commands.
  This is why the inspector renders in the **MAIN world**: it is the only surface that displays
  real values, so it runs in the world that already holds them, and nothing has to cross;
- **not the activity log, the badge, or any telemetry** — all of which are counts and category
  keys by construction.

### Consequences for the clipboard specifically

1. **Rehydrate, don't sanitize.** The clipboard is brought *into line with the screen*, not held
   apart from it.

2. **Which source a `copy` event will use is decided by `defaultPrevented`, and reading the wrong
   one is not cosmetic.** If the site cancelled the event, its `setData` payload is what gets
   written, so that is what we rewrite — and we do not re-take a decision already made. If nobody
   cancelled, the browser serialises the *selection*, which the DOM rehydrator already restored,
   so we touch nothing. The exception is a copy-button shim that stuffs markdown into a hidden
   textarea and calls `execCommand("copy")`; that text never passed the rehydrator, so that
   branch cancels and substitutes.

3. **`text/html` is rewritten alongside `text/plain`.** "Draft this email" → copy → paste into
   Gmail takes the HTML flavour, which is the exact journey this fix exists for. Substituted
   values are HTML-escaped, because a user's own blocklist term is arbitrary text and could
   otherwise carry `&` or `<` into the markup. Cancelling also takes the browser's own HTML
   flavour with it, so that branch has to supply it or a rich paste loses every link and list.

4. **`navigator.clipboard.write(ClipboardItem[])` is deliberately not patched.** Reading a `Blob`
   needs an `await` before the native call, which risks losing transient user activation and
   **breaking the site's copy button outright**. Failing open there costs an unrehydrated copy;
   failing closed would cost the user their copy button. `writeText` takes a synchronous string
   and is patched.

Both clipboard hooks are **idempotent**: if a site's Copy button already serves the painted text,
`rehydrate()` finds nothing to change and the clipboard is left alone. That is what makes the fix
safe without having to be certain which source each site uses today, or will use next month.

### Consequences for the inspector panel

Displaying the mapping table means putting real values somewhere the page could, in principle,
read them. Two things follow.

**Be precise about the actual exposure.** Every value in that table came from the composer, which
the site's own JS reads as the user types. The marginal exposure is values from earlier in the
session that the page has since discarded — and in practice it rendered and still holds the whole
conversation anyway. A hostile script on `chatgpt.com` is already game over by a much shorter
route than scraping our panel.

**Do not use that as a licence for carelessness.** The panel renders in a **closed shadow root**,
so `host.shadowRoot` is null and a `document.querySelector("#ss-inspector")` finds nothing;
`attachShadow` is captured at `document_start`, before any page script runs, so patching
`Element.prototype` afterwards does not hand anyone our root. That raises the bar against
opportunistic scraping without pretending to defeat a page that is actively hunting for us — we
share a JS realm with it, and that is not a boundary a content script can win outright. Alongside
it: the panel never auto-opens, the render signature is held in a class field rather than a
`data-*` attribute, and the UI says plainly that real values are on screen before you share it.

The shadow host is `display:contents` — it must add no layout, and above all must not become a
stacking context, or the panel's `z-index` would be trapped inside it and `layers.ts`'s ordering
would silently stop applying.

### Worked example: the pre-send pill (added 0.7.0)

The first thing this ADR decided in anger, and it went the way the rule predicts.

The pill counted identifiers in the isolated world while `Session` — in the MAIN world — dropped
values the user had excused via *"stop redacting this"*. So the panel and the pill disagreed
about the same prompt: the guard would send a value through, and the pill went on promising it
would be kept local.

The obvious fix is to hand the excused values to the isolated world so it can filter them out.
**That is a boundary violation**, and a clear one: those are real values, the excused set exists
*because* the user pointed at real values, and the bridge carries category names and bare
commands only. It would also have put PII into a channel the activity log and badge deliberately
keep clean.

So the computation moved to the values instead of the values moving to the computation —
`pending.ts` runs `summarize()` in the MAIN world and publishes `{count, categories,
surrogatable}` on a `data-*` attribute. Counts and category labels are the same class of thing
the activity log already carries. Two properties fall out of the boundary rather than being
bolted on:

- the isolated side treats the attribute as **untrusted input** (a page script can write it) and
  falls back to computing its own summary on anything malformed — degrading to the old, merely
  imprecise behaviour rather than to a fabricated promise;
- it deletes the second detection pipeline, so there is now one `summarize()` call, in one world,
  with the full picture.

The general shape: when a surface needs to *reflect* something derived from real values, move the
derivation to the values and let the summary cross. Only the three surfaces in the table above
ever need the values themselves.

## Consequences

- Adding a fourth surface that shows the user their conversation — a rich-text export, a
  side-panel transcript, a "copy as markdown" of our own — is a **rehydration-boundary decision**,
  not a feature detail. It belongs in this table or it must justify its absence.
- The inverse also holds: any new channel that leaves the page (a sync feature, a crash report, a
  shared session) starts from "carries no values" and has to argue its way out of it.
- The DOM rehydrator's `map` parameter (added for HTML escaping) is the extension point for a
  surface with different escaping needs. Its default is identity, so the hot path is unchanged.
- This ADR does not change detection, so the parity-locked shield and its vectors are untouched.
