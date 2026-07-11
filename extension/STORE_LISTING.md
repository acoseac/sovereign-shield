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
> Redacts Swiss, EU & international identifiers before ChatGPT/Gemini/Claude, then restores them in the reply — 100% local.

**Category:** Productivity
**Language:** English

**Detailed description** (1,349 characters — under the 1,600 limit):
> Sovereign Shield keeps Swiss, EU and international identifiers out of the big chat assistants. Before your prompt leaves the browser for ChatGPT, Gemini or Claude, it replaces any checksum-validated identifier with a neutral placeholder, then restores the real value in the reply — so the conversation reads normally while the sensitive number never leaves your machine.
>
> Everything runs locally. No account, no API key, no server, no analytics, and no data ever leaves your device.
>
> Detection is deterministic: an identifier matches only when its regex shape AND its real check digit agree, so ordinary text is never touched and there are no false positives.
>
> What it detects:
> • Swiss AHV/AVS, IBAN (worldwide), credit card
> • Italy Codice fiscale, Spain DNI/NIE, France NIR, Netherlands BSN
> • Germany Steuer-ID, Poland PESEL, Portugal NIF, Belgium Rijksregisternummer
> • UK NHS number
> • Brazil CPF & CNPJ, South Africa ID, China resident ID, Canada SIN, India Aadhaar
>
> You stay in control: choose which categories to block, and an on-device activity log shows what was kept local — type, time and site only, never the value.
>
> The value-to-placeholder map lives only in your tab's memory and is never stored or transmitted. Structured identifiers only — names and addresses are out of scope.
>
> Open source: https://github.com/acoseac/sovereign-shield

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

Four are ready in `~/Desktop/sovereign-shield-store-screenshots/`, all exactly 1280×800.
Upload in this order (the store shows the first as the primary tile):

1. `1-showcase.png` — the /extension showcase hero: what it is, at a glance.
2. `2-tester.png` — the live identifier tester (detected + "what the model receives").
3. `3-options.png` — the options UI: all 20 category toggles + the value-free activity log.
4. `4-gemini-proof.png` — a real Gemini session with DevTools showing `[AHV_1]` on the wire
   while the reply shows the restored number (the "receipts" shot; slim white bands top/bottom
   from fitting a wider capture to 1280×800).

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
