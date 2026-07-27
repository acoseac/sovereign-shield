# Security policy

Sovereign Shield is a privacy tool, so a defect in it can expose exactly the data someone
installed it to protect. Reports are welcome and taken seriously.

## Reporting a vulnerability

**Please do not open a public issue.**

Two private channels, either is fine:

- **GitHub** → the [Security tab](https://github.com/acoseac/sovereign-shield/security/advisories/new)
  ("Report a vulnerability"). Preferred — it keeps the discussion, the fix and the advisory in
  one place.
- **Email** → arsenie@odysseus.fi.

Please include the affected component (extension / Python library / proxy / web demo), the
version or commit, and enough detail to reproduce. **Do not include real personal data in a
report** — a synthetic identifier that reproduces the issue is always sufficient, and every
detector in the shield is checksum-based, so a generated value behaves identically to a real one.

This is a single-maintainer project, not a company with an on-call rota. Expect an
acknowledgement within a few days, and a fix timeline that depends on severity and on which of
the three release lanes is affected. You will be credited in the advisory unless you would rather
not be.

## What counts

Anything that breaks the guarantees the project actually makes:

- **A prompt reaching a provider unredacted** when the guard was enabled and the value is one of
  the supported categories — *all* of them, not only the checksum-validated ones. Email, Swiss
  phone, every secret and credential pattern, and an active custom rule all count. An API key
  reaching a model is as much a failure as an AHV number is.
- **Silent failure** — redaction stopping without the user being told. The extension warns when a
  send goes uninspected precisely because quiet breakage is worse than loud breakage; a path that
  evades that warning is a bug in its own right.
- **A real value crossing the rehydration boundary.** Per
  [ADR 0005](docs/adr/0005-rehydration-boundary.md), real values may surface on exactly three
  surfaces — the painted DOM, the clipboard, and the inspector panel. A value in the response
  stream, in `chrome.storage`, in a `postMessage`, or in the activity log is a boundary violation
  even if nothing leaves the machine.
- **A smokescreen stand-in that could be a real person's data.** Stand-ins come from vendored
  pools using RFC 2606 reserved domains, and checksum-validated categories are permanently
  ineligible ([ADR 0004](docs/adr/0004-smokescreen-surrogates.md)). A path that mints a
  checksum-valid synthetic identifier is a serious bug.
- **ReDoS or a hang on the send path** — the guard must never block a send.
- Anything in the Python proxy that leaks an upstream `Authorization` header or persists a token
  map beyond the request.

## What does not count

These are documented limitations, not vulnerabilities. They are stated plainly in the
[README](README.md#what-it-detects) and I would rather improve the docs than litigate them:

- **Person names and street addresses are not detected.** They have no checksum, so they need a
  named-entity model — deliberately out of scope. Plug your own in via `extra_detectors`.
- **Encoding defeats the regex.** A model that base64s or ciphers an identifier gets past a
  structural matcher. Separator and whitespace reformatting *is* handled; encoding is not.
- **Attached files are not inspected.** The extension guards the prompt you type, not the contents
  of a document or codebase you upload in the chat UI — those reach the provider as-is. Attachments
  are an unguarded channel by design; redact them beforehand.
- **A hostile first-party script on the chat site itself.** The content script shares a JS realm
  with the page. A page that is actively hunting for the extension wins, and a page that hostile
  has far shorter routes to the same data. See ADR 0005 for what is and isn't claimed here.
- **Settings live on `<html>` `data-*` attributes**, so a first-party script can switch the guard
  off. Accepted and documented in [`extension/README.md`](extension/README.md).
- **The guard is not a compliance guarantee.** It is one deterministic layer in a defence-in-depth
  stack, and it is not legal advice — see the disclaimer in the [README](README.md) and
  [NOTICE](NOTICE).

## Supported versions

Fixes land on `main` and ship in the next release of whichever lane is affected. Given the age and
size of the project, there is no long-term support branch — the current release is the supported
one.

| Lane | Where | Current |
|---|---|---|
| Chrome extension | Chrome Web Store, tag `extension-vX.Y.Z` | see [`extension/manifest.json`](extension/manifest.json) |
| Python library / proxy | PyPI `sovereign-shield-ch`, tag `vX.Y.Z` | see [`src/sovereign_shield/__init__.py`](src/sovereign_shield/__init__.py) |
| Web demo | shield.ars.md | continuously deployed from `main` |
