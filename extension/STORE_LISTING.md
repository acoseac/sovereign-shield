# Chrome Web Store listing — copy/paste reference

> **Status:** 0.6.0 submitted for review (July 2026), superseding the pending 0.5.0. The copy
> below is what went in.

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

**Detailed description** — this is the copy submitted for **0.6.0**. Plain text: the dashboard
field takes no markdown, so the section labels and `•` bullets below are literal (line breaks
are preserved). The field allows ~16,000 chars, so length is not a real constraint — the old
"1,600-char limit" note was a myth.
> Sovereign Shield keeps sensitive data out of web-based AI chat assistants. Before your prompt leaves the browser, it replaces personal identifiers, developer keys, and custom sensitive terms with placeholders — then automatically restores the real values in the AI's reply so nothing sensitive leaves your machine.
>
> Everything runs 100% locally: no accounts, no API keys required, no external servers, and no tracking or analytics.
>
> How It Works
> Identifiers are checksum-validated (shape and check digits must match) so ordinary text is untouched and false positives are minimized. Secrets are matched using structured credential patterns.
>
> What It Detects
> • Personal & Financial Info: Swiss AHV/AVS, global IBANs, credit cards, phone numbers, and email addresses.
> • National & Health IDs: Official tax, health, and government identity numbers across major regions (including EU, UK, Americas, and Asia).
> • Developer Secrets: Common API keys, cloud service access tokens, authentication tokens (JWTs), and PEM private keys.
> • Custom Rules: Your own custom keywords, internal code names, client names, domains, or regular expressions (regex).
>
> See Exactly What You Send
> A live counter above the chat box shows how many sensitive items will be kept local before you send. Click Inspect to open a side-by-side view of your prompt versus what the AI actually receives, plus a list of every active placeholder and its real value — so you can verify a redaction, remove a false positive, or swap a stand-in on the spot. When you copy the AI's reply, the real values come back too, matching what's on your screen. And if a site changes its internal API so a message would go out uninspected, you're warned instead of left guessing.
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
4. `4-options.png` — the options UI: the identifier + "Secrets & API keys" toggles, the custom-rules editor, and the value-free activity log. (Regenerate for 0.6.0 — still shows the pre-smokescreen layout.)
5. `5-gemini-proof.png` — a real Gemini session with DevTools showing `[AHV_1]` on the wire
   while the reply shows the restored number (the "receipts" shot).
6. **New for 0.6.0** — the inspector panel's Preview tab, prompt beside redacted payload with
   the replaced spans marked. It is the most legible single proof the extension works, and it
   needs no DevTools to read, so consider promoting it above `5-gemini-proof.png`.

Tiles 1–3 are designed 1280×800 promo images (exact pill markup/CSS from `indicator.ts`, now
including the **Inspect** button — see PR #61 — so regenerate them with `store-assets/render.sh`
before the next upload); 4–5 are live product captures. The two earlier web-page shots
(`1-showcase.png`, `2-tester.png`) are archived under `_archived-stale/` — they predated the
CWS-advertise update and still carried the "not yet on the Chrome Web Store" line.

---

## Submission checklist

- [ ] Developer account created + $5 registration paid (decide: personal vs. odysseus.fi Workspace).
- [ ] `npm run package` → upload `sovereign-shield-<version>.zip`.
- [ ] Summary, description, category filled from above.
- [ ] Privacy policy URL live at shield.ars.md/extension/privacy.
- [ ] Data disclosure + permission justifications filled; remote code = **No**.
- [ ] Test instructions filled (Access tab) — no credentials, synthetic-AHV recipe above.
- [ ] ≥1 screenshot (1280×800) uploaded.
- [ ] Visibility: **Unlisted** for the first release (public search later).
- [ ] Submit → expect manual review (host access to major sites is scrutinised).
