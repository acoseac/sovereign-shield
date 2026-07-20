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
> Redacts identifiers, API keys & your own terms before ChatGPT/Gemini/Claude, then restores them in the reply — 100% local.

**Category:** Productivity
**Language:** English

**Detailed description** (keep under the 1,600-char limit — the dashboard shows a live count):
> Sovereign Shield keeps sensitive data out of the big chat assistants. Before your prompt leaves the browser for ChatGPT, Gemini or Claude, it replaces identifiers, API keys and your own custom terms with neutral placeholders, then restores the real values in the reply — so nothing sensitive ever leaves your machine.
>
> Everything runs locally. No account, no API key, no server, no analytics, and no data ever leaves your device.
>
> Identifiers match deterministically — the regex shape AND the real check digit must agree — so ordinary text is untouched and there are no false positives. Secrets and API keys are matched by their well-known shapes.
>
> What it detects:
> • Swiss AHV/AVS, IBAN (worldwide), credit card
> • Italy Codice fiscale, Spain DNI/NIE, France NIR, Netherlands BSN
> • Germany Steuer-ID, Poland PESEL, Portugal NIF, Belgium Rijksregisternummer
> • UK NHS number
> • Brazil CPF & CNPJ, South Africa ID, China resident ID, Canada SIN, India Aadhaar
> • Secrets: AWS, OpenAI, Anthropic, GitHub, Google, Slack & Stripe keys, JWTs, PEM private keys
> • Your own custom keywords or regexes — code names, client names, internal domains
>
> You stay in control: choose which categories to block, add your own rules, and an on-device activity log shows what was kept local — type, time and site only, never the value.
>
> Before you send, a live count above the chat box shows what will be kept local.
>
> The value-to-placeholder map lives only in your tab's memory and is never stored or transmitted. Names and addresses are out of scope.
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

Five are ready in `~/Desktop/sovereign-shield-store-screenshots/`, all exactly 1280×800.
Upload in this order (the store shows the first as the primary tile):

1. `1-gemini.png` — the pre-send pill on Gemini: "🛡️ 2 items (IBAN, Swiss AHV / AVS) will be
   kept local when you send", above a real prompt. Leads with the headline v0.3.0 feature.
2. `2-chatgpt.png` — the same pill on ChatGPT (3 items: card, email, AHV).
3. `3-claude.png` — the same pill on Claude (2 items: AHV, Swiss phone).
4. `4-options.png` — the options UI: the identifier + "Secrets & API keys" toggles, the custom-rules editor, and the value-free activity log. (Regenerate for 0.4.0 — the layout changed.)
5. `5-gemini-proof.png` — a real Gemini session with DevTools showing `[AHV_1]` on the wire
   while the reply shows the restored number (the "receipts" shot).

Tiles 1–3 are designed 1280×800 promo images (exact pill markup/CSS from `indicator.ts`, with
real detector output); 4–5 are live product captures. The two earlier web-page shots
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
