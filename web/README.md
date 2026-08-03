# shield.ars.md

The public site for [Sovereign Shield](../README.md). It leads with the **browser
extension** — the shipped, installable product — and keeps the gateway demo behind it.

| Route | What it is |
|---|---|
| `/` | The extension: install CTA, a **live preview** of what the guard would send (`components/ExtensionDemo.tsx` over `lib/demo.ts`), tabbed screenshots, and the fine print in `<details>` |
| `/extension` | 308 → `/`. Must keep resolving: it is the manifest's `homepage_url` and is printed in the store listing. The redirect lives in `next.config.mjs` |
| `/extension/privacy` | Privacy policy (the URL the Chrome Web Store points at — **never move it**) |
| `/gateway` | The proxy demo below |
| `/scan`, `/how-it-works`, `/benchmark`, `/governance` | Leak Radar, explainer, utility benchmark, governance |

`lib/demo.ts` reproduces two **extension-only** behaviours (custom-term matching and
smokescreen stand-ins) rather than importing them: Vercel's root directory is `web/`, so
`../extension` is not on disk at build time. Detection itself is the real thing —
`lib/shield.ts` is the module the extension bundles.

## The gateway demo (`/gateway`)

Pick a business document full of Swiss PII, pick a model, and watch the pipeline:

1. **Your document** — real Swiss PII (name, AHV, IBAN, phone, email, address).
2. **🛡️ the shield redacts** — each identifier is swapped for a stable placeholder
   (`[PERSON_1]`, `[AHV_1]`, …). This is the only text that crosses the border.
3. **The model answers** — on the placeholders; it never sees a real value.
4. **🛡️ the shield restores** — real values are re-inserted on the way back, so the
   user gets a correct, personalised result — and 0 personal-data elements left CH.

Plus a **DPO audit** (what was kept on-shore) and a shared **"kept in Switzerland"**
counter (Upstash Redis).

**No API keys at runtime.** Detection + tokenization are deterministic and run in
the browser (a TypeScript port of `sovereign_shield.pii` / `sovereign_shield.shield`,
kept byte-for-byte in parity with the Python source). The model responses shown are
recorded runs on the **sanitized** prompts.

## Local dev

```bash
cd web
npm install
npm run dev            # http://localhost:3000
npm run parity         # verify the TS shield == the Python shield (84 vectors)
```

## Record the corpus (real model runs on sanitized prompts)

From the repo root, with provider keys in `.env` (GOOGLE / ANTHROPIC / DEEPSEEK):

```bash
pip install -e ".[gateway]" langchain-anthropic langchain-deepseek
python scripts/gen_gateway_corpus.py
```

It tokenizes each document in `scripts/gen_gateway_corpus.py` (structured PII via
the real `sovereign_shield` detectors + annotated names/addresses), **asserts no raw
PII survives** sanitization, sends the sanitized prompts to each model, and writes
`web/data/gateway.json`. Edit the documents / models there, re-run, commit, redeploy.

## Deploy (Vercel → shield.ars.md)

Root directory `web/`, with the Upstash Redis integration (the app reads either
`UPSTASH_REDIS_REST_*` or `KV_REST_API_*`). Pushing to `main` auto-deploys.

## Parity gate

```bash
python scripts/gen_shield_vectors.py --check   # Python vectors current
cd web && npm run parity                       # TS reproduces them exactly
```
