# Contributing to Sovereign Shield

Thanks for wanting to help. This is a local-first PII shield for LLM traffic — a security
and privacy tool — so provenance and clear IP rights matter more here than in a typical
project. Two lightweight gates enforce that; both run automatically on every pull request.

## Two gates, and why

| Gate | Mechanism | What it certifies |
|---|---|---|
| **CLA** (required) | Sign once by commenting on your first PR | You grant the maintainer a broad, sublicensable copyright/patent license — see [CLA.md](CLA.md) |
| **DCO** (required) | `Signed-off-by:` line on every commit | You had the right to submit that specific commit under the project's license |

They are **not** redundant. The DCO is a per-commit, in-history certification of *origin*.
The CLA is a one-time grant of *rights* — including the right for the project to be offered
under other licenses in the future. A DCO alone does not grant relicensing rights; the CLA
is what does. You need to clear both.

### Signing the CLA

Open your PR as normal. A bot comments asking you to sign; reply on the PR with exactly:

```
I have read the CLA and I hereby sign the CLA
```

That's it — one comment, once, ever. Your signature is stored in the `cla-signatures`
branch of this repo (no third-party service). Contributing on behalf of a company? Your
employer should sign a Corporate CLA instead — open an issue and we'll sort it out.

### Signing off commits (DCO)

Add a `Signed-off-by` trailer to **every** commit — this applies to maintainers too:

```bash
git commit -s -m "your message"          # sign a new commit
git rebase --signoff origin/main         # retroactively sign a branch, then force-push
```

The trailer must match your commit author name and email. The full text you're certifying
is the [Developer Certificate of Origin](https://developercertificate.org/).

## Development

Full architecture and invariants live in [CLAUDE.md](CLAUDE.md) — read it before touching
detection logic. The essentials:

- **Branch off `main`, open a PR, squash-merge, delete the branch.** Land only with CI
  green. Disjoint changes go as **parallel** PRs, not stacked.
- **Shield parity is the one cross-cutting invariant.** PII detection exists in three
  parity-locked copies (Python is the source of truth → `web/lib/shield.ts` port → the
  extension reuses the TS). If you change detection: edit Python → regenerate vectors
  (`python scripts/gen_shield_vectors.py`) → confirm `web` parity (`npm run parity`) → the
  extension picks it up on its next build. CI fails if they drift.
- Per-area dev/test commands are in each area's README ([root](README.md), [web](web/README.md),
  [extension](extension/RELEASING.md)) and in [CLAUDE.md](CLAUDE.md).

## Reporting a security issue

Please **do not** open a public issue for a vulnerability. Email
arsenie@odysseus.fi instead, and give us a chance to fix it before disclosure.
