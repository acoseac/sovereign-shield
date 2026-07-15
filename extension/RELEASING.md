# Releasing the browser extension

The Chrome extension versions **independently** from the Python proxy. This is the
end-to-end procedure for cutting an extension release and regenerating its Chrome Web
Store visuals.

> The Python/pypi package has its own flow — see the root [RELEASING.md](../RELEASING.md).

## Versioning & tags

- The extension version lives in [`manifest.json`](manifest.json) (`version`).
- Tag extension releases **`extension-vX.Y.Z`** (annotated) — **not** `vX.Y.Z`, which is
  the proxy/pypi namespace (`v0.1.0`–`v0.3.0` are proxy releases; the two lines happen to
  share numbers, which is why a bare `v0.3.0` was already taken).
- **Do not publish a GitHub _Release_ from an extension tag.** [`release.yml`](../.github/workflows/release.yml)
  fires on any published Release and would build/publish the **Python** package to PyPI. A
  plain pushed tag triggers nothing. The extension ships through the Chrome Web Store only.

## Cutting a release

1. Bump `version` in [`manifest.json`](manifest.json).
2. Build + sanity-check:
   ```bash
   cd extension
   npm ci
   npm run typecheck    # tsc --noEmit → 0 errors
   npm test             # node --test → all green
   npm run package      # → extension/sovereign-shield-<version>.zip (clean rebuild)
   ```
   Confirm the zip carries only `manifest.json` + built JS/HTML + PNG icons — no `src/`,
   no `.svg`, no stale files. (`build.mjs` wipes `dist/` first and excludes the source SVG.)
3. Open a PR and land it on `main` with CI green — the `extension` job runs
   `typecheck · test · build` ([`ci.yml`](../.github/workflows/ci.yml)).
4. Tag the release commit and push it:
   ```bash
   git tag -a extension-v<version> -m "Sovereign Shield browser extension <version>" <commit>
   git push origin extension-v<version>
   ```
5. Upload to the Chrome Web Store (manual — see below).

## Chrome Web Store submission

Dashboard: <https://chrome.google.com/webstore/devconsole> · item id
`fbdenbfhigickkdcokpchmklopkfkkbf`. All the copy/paste text (name, summary, description,
single-purpose, permission justifications, data disclosure, test instructions) lives in
[STORE_LISTING.md](STORE_LISTING.md) — keep it in sync when the extension changes.

| Asset | Size / format | Source |
|---|---|---|
| Package | `.zip` | `npm run package` → `sovereign-shield-<version>.zip` |
| Store icon | 128×128 PNG | [`icons/icon-128.png`](icons/icon-128.png) (transparent; white/red/black shield) |
| Screenshots | 1280×800, 24-bit PNG, **no alpha** | ≥1 required; we ship 5 (below) |
| Small promo tile | 440×280, 24-bit PNG, no alpha | Optional — generated (below) |
| Marquee promo tile | 1400×560 | Optional; only for Google-curated featuring. Not shipped |

**Screenshot lineup** (upload in order; #1 is the primary tile):

1. `1-gemini.png` — pre-send pill on Gemini &nbsp;⟶ _generated_
2. `2-chatgpt.png` — pre-send pill on ChatGPT &nbsp;⟶ _generated_
3. `3-claude.png` — pre-send pill on Claude &nbsp;⟶ _generated_
4. `4-options.png` — options page (toggles + value-free log) &nbsp;⟶ _live capture_
5. `5-gemini-proof.png` — Gemini reply + DevTools showing `[AHV_1]` on the wire &nbsp;⟶ _live capture_

Then set visibility and **Submit for review** (host-permission review is manual and can
take days).

## Regenerating the store visuals

Screenshots 1–3 and the promo tile are **designed tiles**, recreated from the exact pill
markup + CSS in [`src/indicator.ts`](src/indicator.ts) — pixel-clean and reproducible, no
logged-in session needed. They're built from self-contained HTML by
[`store-assets/render.sh`](store-assets/render.sh):

```bash
cd extension/store-assets
./render.sh                       # 3 screenshots (1280x800) + small promo (440x280)
./render.sh screenshots           # just the screenshots
./render.sh promo                 # just the promo tile
OUT=~/Desktop/shots ./render.sh   # choose the output dir
```

- **Editing content:** the prompts/pill text live in the `T` object in
  [`store-assets/tile.html`](store-assets/tile.html) (one entry per site); the promo tagline
  is in [`store-assets/promo-small.html`](store-assets/promo-small.html). To recompute a
  pill's item count/labels for new sample text, run it through `summarize()` in
  [`src/summarize.ts`](src/summarize.ts).
- **Pipeline notes** (baked into `render.sh`; macOS-only — needs Google Chrome + `sips`):
  renders headless at `--force-device-scale-factor=2`, then `sips` downsamples to the exact
  size (supersampling → crisp text). Chrome `--headless` can hang, so the script runs it
  detached, polls for the screenshot, then kills it, and uses `--headless=new` (old
  `--headless` is flaky). CWS wants 24-bit PNG **no alpha**, so it prints `alpha=` per file —
  an opaque background yields `alpha=no`.

Assets 4–5 are **real captures**, not generated. Re-shoot them if they drift: `4-options.png`
from the live options page, `5-gemini-proof.png` from a real Gemini session with DevTools →
Network open on the `StreamGenerate` request (the one carrying `[AHV_1]`).
