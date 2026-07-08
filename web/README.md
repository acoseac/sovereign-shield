# The Sovereign AI Gateway (shield.ars.md)

A live demo of [Sovereign Shield](../README.md): let a team use any public LLM
(Gemini, Claude, DeepSeek) while **no personal data ever leaves Switzerland**.

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
npm run parity         # verify the TS shield == the Python shield (21 vectors)
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
