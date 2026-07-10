# Chrome Web Store listing — copy/paste reference

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
> Redacts Swiss/EU identifiers before they reach ChatGPT, Gemini or Claude and restores them in the reply — 100% local.

**Category:** Productivity
**Language:** English

**Detailed description:**
> Sovereign Shield keeps Swiss and EU identifiers out of the big chat assistants. Before your
> prompt leaves the browser for ChatGPT, Gemini or Claude, it swaps any checksum-validated
> identifier for a neutral placeholder, then restores the real value in the reply — so the
> conversation reads normally while the sensitive number never leaves your machine.
>
> Everything runs locally. No account, no API key, no server, no analytics, and no data ever
> leaves your device.
>
> Detects (regex shape + real check digit, so ordinary text is never touched):
> • Swiss AHV/AVS, IBAN (worldwide), credit card
> • Italy Codice fiscale, Spain DNI/NIE, France NIR, Netherlands BSN
> • Germany Steuer-ID, Poland PESEL, Portugal NIF, Belgium Rijksregisternummer
> • UK NHS number
> • Brazil CPF & CNPJ, South Africa ID, China resident ID, Canada SIN, India Aadhaar
>
> You choose which categories to block, and an on-device activity log shows what was kept
> local — recording the type, time and site only, never the value.
>
> How it works: the extension hooks the request each site makes to its model and rewrites the
> outgoing prompt in the page. It is open source: https://github.com/acoseac/sovereign-shield

---

## Single purpose (dashboard field)

> Redact structured personal identifiers from prompts sent to ChatGPT, Gemini and Claude, and
> restore them in the response — entirely on the user's device.

## Permission justifications (dashboard field)

- **Host access — `chatgpt.com`, `chat.openai.com`, `gemini.google.com`, `claude.ai`:**
  The extension must read the outgoing chat request on these sites and rewrite it to replace
  identifiers with placeholders before it is sent, and restore the real values in the rendered
  reply. It runs only on these four sites; it needs no other host access.
- **`storage`:** Stores the on/off setting, the per-category toggles, and the value-free activity
  log (type + time + site) on the user's device. Nothing is transmitted.
- **No remote code:** all logic is bundled in the package; the extension loads no external scripts.

## Data disclosure (Privacy practices tab)

- Personal / sensitive user data collected or used: **No** — identifiers are processed in-page and
  never stored or transmitted; the value↔placeholder map lives only in tab memory.
- Sold to third parties: **No.** Used for unrelated purposes: **No.** Used for creditworthiness: **No.**
- Certify compliance with the Developer Program Policies + Limited Use: **Yes.**

**Privacy policy URL:** https://shield.ars.md/extension/privacy

---

## Screenshots (required: ≥1, 1280×800 PNG)

Capture with the extension loaded (options page and popup are the cleanest shots):

1. **Options page** — settings (category toggles) + the activity log. Open `chrome://extensions` →
   Details → Extension options, size the window to 1280×800.
2. **Popup** — on a chat tab after a redaction, showing the count. (Pad to 1280×800 on a plain
   background if the popup alone is smaller.)
3. **In action** — a chat site with the toolbar badge showing a count. Optional but persuasive.

(Ask Claude to capture these once the extension is loaded — they need the live extension.)

---

## Submission checklist

- [ ] Developer account created + $5 registration paid (decide: personal vs. odysseus.fi Workspace).
- [ ] `npm run package` → upload `sovereign-shield-<version>.zip`.
- [ ] Summary, description, category filled from above.
- [ ] Privacy policy URL live at shield.ars.md/extension/privacy.
- [ ] Data disclosure + permission justifications filled.
- [ ] ≥1 screenshot (1280×800) uploaded.
- [ ] Visibility: **Unlisted** for the first release (public search later).
- [ ] Submit → expect manual review (host access to major sites is scrutinised).
