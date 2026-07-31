# Chrome Web Store listing — copy/paste reference

> **Status:** 0.7.0 is **live** on the Chrome Web Store (published 29 July 2026), superseding
> 0.6.0. **0.8.2 is prepared** and is the next upload. The store will not accept a version equal
> to or lower than the live one, and a number can never be reused.
>
> **0.8.0 and 0.8.1 were tagged but never uploaded**, so users go straight from 0.7.0 to 0.8.2 and
> never see either. The "What's new" note below is therefore the changelog **since 0.7.0** — write
> it that way. Both tags stay in git as a record of what was verified when; nothing needs undoing.
>
> **Unlike 0.8.1, this one DOES change the detailed description**: the ready-made rule library is a
> new user-facing feature, so the Custom Rules clause was reworded and the description must be
> re-pasted in the dashboard. Nothing changed about what is detected, redacted, stored or sent, so
> the privacy policy, the data disclosure and the permission justifications all stay correct as
> written.

Everything you paste into the Developer Dashboard when submitting the extension.
Not shipped in the package (the build only copies manifest + HTML + icons into `dist/`).

Build the upload artifact with:

```bash
cd extension && npm run package   # -> extension/sovereign-shield-<version>.zip
```

---

## Product details

**Name** (from manifest): `Sovereign Shield — LLM PII guard`

**Summary** (≤132 chars):
> Redacts identifiers, API keys & your own terms before ChatGPT/Gemini/Claude, then restores them in the reply — 100% local.

**Category:** Productivity
**Language:** English

**Detailed description** — the copy first submitted for **0.6.0**, carried forward for **0.7.0**
with one added clause (the report link, in "See Exactly What You Send"). Plain text: the dashboard
field takes no markdown, so the section labels and `•` bullets below are literal (line breaks
are preserved). The field allows ~16,000 chars, so length is not a real constraint — the old
"1,600-char limit" note was a myth.
> Sovereign Shield keeps sensitive data out of web-based AI chat assistants. Before your prompt leaves the browser, it replaces personal identifiers, developer keys, and custom sensitive terms with placeholders — then automatically restores the real values in the AI's reply so nothing sensitive leaves your machine.
>
> Everything runs 100% locally: no accounts, no API keys required, no external servers, and no tracking or analytics.
>
> How It Works
> Identifiers are checksum-validated (shape and check digits must match) so ordinary text is untouched and false positives are minimized. Secrets are matched using structured credential patterns. It acts on the message you type — not on files you attach, so redact a document or codebase before uploading it.
>
> What It Detects
> • Personal & Financial Info: Swiss AHV/AVS, global IBANs, credit cards, phone numbers, and email addresses.
> • National & Health IDs: Official tax, health, and government identity numbers across major regions (including EU, UK, Americas, and Asia).
> • Developer Secrets: Common API keys, cloud service access tokens, authentication tokens (JWTs), and PEM private keys.
> • Custom Rules: Your own custom keywords, internal code names, client names, domains, or regular expressions (regex) — plus a built-in library of ready-made rules (US Social Security numbers, UK National Insurance numbers, internal IP addresses, internal hostnames, MAC addresses) you can add with one click, no regex required.
>
> See Exactly What You Send
> A live counter above the chat box shows how many sensitive items will be kept local before you send. Click Inspect to open a side-by-side view of your prompt versus what the AI actually receives, plus a list of every active placeholder and its real value — so you can verify a redaction, remove a false positive, or swap a stand-in on the spot. When you copy the AI's reply, the real values come back too, matching what's on your screen. And if a site changes its internal API so a message would go out uninspected, you're warned instead of left guessing — with a one-click way to report it, so a moved endpoint gets fixed quickly.
>
> Optional Smokescreen Mode
> Send realistic stand-ins (e.g., alice.morgan@example.org instead of [EMAIL_1]) so AI models generate more natural, context-aware responses without seeing your real data. (Applies to emails and custom terms only; IDs, cards, and secrets always use standard placeholders.)
>
> Privacy & Control
> • Complete Granularity: Toggle specific detection categories on or off and define custom privacy rules.
> • On-Device Activity Log: Monitor redacted items locally (only metadata like type, timestamp, and site are logged — never the raw values).
> • Zero Storage: The value-to-placeholder map exists solely in your active tab's memory and is erased when closed.
>
> Open Source
> Review the source code on GitHub: https://github.com/acoseac/sovereign-shield

---

## Release notes — 0.8.2 (dashboard "What's new" field)

Written as the changelog **since 0.7.0**, because neither 0.8.0 nor 0.8.1 was ever uploaded and
no user ran either. Paste into the version's "What's new" note:

> 0.8.2 — accurate warnings, safer copying, easier rules
> • Copying a reply now restores your real values on every site. The Copy button used to bypass it — and with Smokescreen on that meant copying a realistic stand-in address instead of your real one, with no way to tell.
> • Fixed a false alarm: the "this message wasn't inspected" banner could appear on messages that had in fact been redacted correctly. Long prompts were most affected, and Gemini's Thinking model most of all. If that warning does appear and later turns out to be wrong, it now takes itself back down.
> • New: a library of ready-made rules — US Social Security numbers, UK National Insurance numbers, internal IP addresses, internal hostnames and MAC addresses — added with one click, no regular expressions needed.
> • Smokescreen stand-ins are more varied, so a long document with many contacts keeps reading naturally.
> No new permissions, and no change to what is detected, stored or sent. Still 100% local — no account, no servers, no analytics.

---

## Release notes — 0.7.0 (dashboard "What's new" field)

A reliability release. Paste into the version's "What's new" note:

> 0.7.0 — reliability
> • If the guard ever can't read an outgoing request, it now says so loudly instead of staying quiet — no message slips out unnoticed.
> • The pre-send counter now matches exactly what's redacted after you use "stop redacting this".
> • Clearer wording on the toolbar toggle (it turns the guard on or off for every site, not just the current tab).
> • When a site changes its API and a message goes out uninspected, you can now report it in one click.
> No new permissions. Still 100% local — no account, no servers, no analytics.

---

## Single purpose (dashboard field)

> Redact structured personal identifiers from prompts sent to ChatGPT, Gemini and Claude, and
> restore them in the response — entirely on the user's device.

## Permission justifications (dashboard field)

- **Host access — `chatgpt.com`, `chat.openai.com`, `gemini.google.com`, `claude.ai`:**
  The extension must read the outgoing chat request on these sites and rewrite it to replace
  identifiers with placeholders before it is sent, and restore the real values in the rendered
  reply. It runs only on these four sites; it needs no other host access.
- **`storage`:** Stores the on/off setting, the per-category toggles, smokescreen mode, and the value-free activity
  log (type + time + site) on the user's device. Nothing is transmitted.
- **No remote code:** all logic is bundled in the package; the extension loads no external scripts.

## Data disclosure (Privacy practices tab)

- Personal / sensitive user data collected or used: **No** — identifiers are processed in-page and
  never stored or transmitted; the value↔placeholder map lives only in tab memory.
- Sold to third parties: **No.** Used for unrelated purposes: **No.** Used for creditworthiness: **No.**
- Certify compliance with the Developer Program Policies + Limited Use: **Yes.**

**Privacy policy URL:** https://shield.ars.md/extension/privacy

---

## Test instructions (Access → Test instructions tab)

Leave **Username / Password blank** — the extension has no login of its own, and third-party
AI-site credentials must never be shared here. Paste this into **Additional instructions** (≤500 chars):

> No credentials needed — the extension has no account of its own (guard on by default). It acts only on gemini.google.com, chatgpt.com, chat.openai.com and claude.ai; test in your own logged-in session on any one.
>
> To verify: on Gemini, send "My AHV is 756.1234.5678.97" (synthetic, checksum-valid). The toolbar badge shows 1; in DevTools > Network the outgoing StreamGenerate request contains [AHV_1], not the digits; the reply restores it. Options page: category toggles + a value-free log.

Strongly recommended: the extension only acts on logged-in third-party sites, so an exact
synthetic-AHV recipe prevents a "couldn't observe the functionality" round-trip during the
host-permission review.

---

## Screenshots (required: ≥1, 1280×800 PNG)

Five are ready in `~/Desktop/sovereign-shield-store-screenshots/`, all exactly 1280×800.
Upload in this order (the store shows the first as the primary tile):

1. `1-gemini.png` — the pre-send pill on Gemini: "🛡️ 2 items (IBAN, Swiss AHV / AVS) will be
   kept local when you send", above a real prompt. Leads with the headline pre-send feature.
2. `2-chatgpt.png` — the same pill on ChatGPT (3 items: card, email, AHV).
3. `3-claude.png` — the same pill on Claude (2 items: AHV, Swiss phone).
4. Options UI — Guard + Smokescreen, the identifier + **all nine** "Secrets & API keys" toggles,
   the custom-rules editor, and the value-free activity log. Recaptured 27 Jul with every secret
   type ticked (so it shows the shipped default) and the dev URL bar cropped; the current capture
   is portrait, so needs a 1280×800 landscape pass (or split into two halves) before upload.
5. `5-gemini-proof.png` — a real Gemini session with DevTools showing `[AHV_1]` on the wire
   while the reply shows the restored number (the "receipts" shot).
6. **The inspector panel's Preview tab** — prompt beside redacted payload with the replaced spans
   marked (captured 27 Jul, e.g. Prompt C: a project name, an email and a Google key redacted at
   once, with the key staying a bracket token while the email becomes a stand-in). The most
   legible single proof the extension works, and it needs no DevTools — promote it above
   `5-gemini-proof.png`. Needs the 1280×800 pass too (current captures are 3188×2024).

Tiles 1–3 are designed 1280×800 promo images (exact pill markup/CSS from `indicator.ts`, now
including the **Inspect** button — see PR #61 — so regenerate them with `store-assets/render.sh`
before the next upload); 4–5 are live product captures. The two earlier web-page shots
(`1-showcase.png`, `2-tester.png`) are archived under `_archived-stale/` — they predated the
CWS-advertise update and still carried the "not yet on the Chrome Web Store" line.

---

## Submission checklist

The account, privacy policy, data disclosure and permission justifications carry forward from the
first listing **only for as long as they stay true** — a release that changes what is collected,
what is sent, or which permissions are requested needs them rewritten and re-reviewed, not carried.
For **each update** the moving parts are:

- [ ] `cd extension && npm run package` → upload `sovereign-shield-<version>.zip` (the version must
      be **strictly greater** than what is live — the store will not accept an equal or lower
      number, and a number can never be reused).
- [ ] Paste that version's **"What's new"** note into the version.
- [ ] Description: re-paste only if a user-facing clause changed. **REQUIRED for 0.8.2** — the
      Custom Rules clause now names the ready-made library.
- [ ] Screenshots: only if a pictured surface moved. Still outstanding from 0.7.0 — the refreshed
      inspector-panel and all-secrets options captures need a 1280×800 landscape pass before they
      can replace tiles 4 and 6.
- [ ] Visibility: leave as the live listing — an update is not a first submission.
- [ ] Submit → host-permission review is still manual and can take days (0.6.0 took ~4).
