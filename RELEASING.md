# Releasing

`sovereign-shield-ch` publishes to PyPI via **Trusted Publishing** (OIDC) — no API
token or secret is stored in the repo. The [`Release`](.github/workflows/release.yml)
workflow builds the sdist + wheel, runs `twine check --strict`, and uploads
whenever a **GitHub Release** is published.

## One-time setup — already done

`sovereign-shield-ch` has published since v0.1.0, so Trusted Publishing is configured and
there is nothing to do here for a normal release. Kept for reference, and in case the
publisher ever has to be re-registered: it was set up as a **pending publisher** at
<https://pypi.org/manage/account/publishing/> with these exact values:

| Field | Value |
|---|---|
| PyPI Project Name | `sovereign-shield-ch` |
| Owner | `acoseac` |
| Repository name | `sovereign-shield` |
| Workflow name | `release.yml` |
| Environment name | `pypi` |

Then, in the GitHub repo, create an **environment** named `pypi`
(Settings → Environments → New environment). Optionally add yourself as a
required reviewer so a publish can't run without a manual approval — the workflow
already references `environment: pypi`.

(Optional) Register the same as a pending publisher on
<https://test.pypi.org/manage/account/publishing/> if you want to rehearse
against TestPyPI first.

## Cutting a release

1. Bump the version — **single source of truth** is `__version__` in
   [`src/sovereign_shield/__init__.py`](src/sovereign_shield/__init__.py)
   (hatchling reads it; `pyproject.toml` has no separate version to sync).
2. Commit and merge to `main` (CI green).
3. Tag and publish a GitHub Release matching the version:
   ```bash
   gh release create v0.1.0 --title v0.1.0 --generate-notes
   ```
4. The `Release` workflow runs automatically: build → `twine check --strict` →
   publish to PyPI via OIDC. Watch it under the **Actions** tab (and approve the
   `pypi` environment if you enabled a required reviewer).

## Local dry run

Reproduce exactly what CI does, without publishing:

```bash
pip install -e ".[dev]" build twine
python -m build
twine check --strict dist/*
# inspect the wheel is package-only (no web/ demo):
python -m zipfile -l dist/*.whl
```
