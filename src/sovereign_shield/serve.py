"""OpenAI-compatible reverse proxy — the stateless "swap your base_url" deploy.

Point any OpenAI-compatible client at this service instead of the provider. On
``POST /v1/chat/completions`` it sanitizes the prompt (Swiss/EU identifiers →
placeholders) with :mod:`sovereign_shield` before forwarding upstream, and
rehydrates the reply on the way back — so no real identifier crosses the border.

Stateless and keyless by design:

* the token↔value map lives in memory only for the duration of one request;
* the caller's ``Authorization`` header is forwarded upstream unchanged — the
  proxy never stores a provider key.

Requires the ``proxy`` extra::

    pip install "sovereign-shield-ch[proxy]"

Run it::

    sovereign-shield-proxy                       # or: uvicorn sovereign_shield.serve:app

    # front any OpenAI-compatible endpoint (default is https://api.openai.com/v1):
    SOVEREIGN_UPSTREAM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai \\
        sovereign-shield-proxy

Then set your client's base URL to this service (e.g. ``OPENAI_BASE_URL``); its
API key flows through to the upstream unchanged.

Scope (v1): non-streaming ``/v1/chat/completions``. Streaming (SSE) is rejected
with a clear error for now — rehydrating across streamed chunks is a planned
fast-follow. Only structured identifiers are tokenized (see the package docs).
"""

from __future__ import annotations

import os
from typing import Any

try:
    import httpx
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import JSONResponse, Response
except ImportError as exc:  # pragma: no cover - only hit without the [proxy] extra
    raise ImportError(
        "sovereign_shield.serve needs FastAPI, httpx and uvicorn. "
        'Install the extra: pip install "sovereign-shield-ch[proxy]"'
    ) from exc

from sovereign_shield import DataLeakError, SessionContext, SovereignShield

UPSTREAM = os.environ.get("SOVEREIGN_UPSTREAM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
INCLUDE_DOB = os.environ.get("SOVEREIGN_INCLUDE_DOB", "").lower() in {"1", "true", "yes"}
TIMEOUT = float(os.environ.get("SOVEREIGN_TIMEOUT", "120"))
# Message separator for shared-context tokenization. A NUL can't occur inside a
# structured identifier, so join→sanitize→split is exact and can't merge spans.
_SEP = "\x00"

app = FastAPI(title="Sovereign Shield proxy", version="1")


def _forward_headers(request: Request) -> dict[str, str]:
    """Pass the caller's auth + content-type upstream; drop host/hop-by-hop headers."""
    drop = {"host", "content-length", "connection", "accept-encoding"}
    return {k: v for k, v in request.headers.items() if k.lower() not in drop}


def sanitize_messages(
    shield: SovereignShield, messages: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], SessionContext]:
    """Tokenize every string message content under ONE shared placeholder map.

    Contents are NUL-joined and sanitized in a single pass, so the same value maps
    to the same token across messages and the reply can be rehydrated against one
    context. Fail-closed: a surviving raw value raises ``DataLeakError`` upstream.
    """
    out = [dict(m) for m in messages]
    idx = [i for i, m in enumerate(out) if isinstance(m.get("content"), str)]
    if not idx:
        return out, SessionContext()
    parts = [str(out[i]["content"]).replace(_SEP, "") for i in idx]
    safe_joined, ctx = shield.sanitize(_SEP.join(parts))
    safe_parts = safe_joined.split(_SEP)
    for j, i in enumerate(idx):
        out[i]["content"] = safe_parts[j]
    return out, ctx


def _rehydrate_message(shield: SovereignShield, msg: dict[str, Any], ctx: SessionContext) -> None:
    """Restore real values in one assistant message (content + tool-call args)."""
    if isinstance(msg.get("content"), str):
        msg["content"] = shield.rehydrate(msg["content"], ctx).text
    for call in msg.get("tool_calls") or []:
        fn = call.get("function") if isinstance(call, dict) else None
        if isinstance(fn, dict) and isinstance(fn.get("arguments"), str):
            fn["arguments"] = shield.rehydrate(fn["arguments"], ctx).text


def rehydrate_response(
    shield: SovereignShield, data: dict[str, Any], ctx: SessionContext
) -> dict[str, Any]:
    """Restore real values in the assistant reply of an OpenAI chat completion."""
    for choice in data.get("choices", []):
        msg = choice.get("message") if isinstance(choice, dict) else None
        if isinstance(msg, dict):
            _rehydrate_message(shield, msg, ctx)
    return data


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"status": "ok", "upstream": UPSTREAM}


@app.post(
    "/v1/chat/completions",
    responses={
        400: {"description": "Streaming was requested; not supported yet."},
        502: {"description": "The shield refused to forward (a raw value would survive)."},
    },
)
async def chat_completions(request: Request) -> Response:
    body: dict[str, Any] = await request.json()
    if body.get("stream"):
        raise HTTPException(
            status_code=400,
            detail=(
                "Streaming is not supported by the Sovereign Shield proxy yet — "
                'set "stream": false. Streaming rehydration is a planned fast-follow.'
            ),
        )
    shield = SovereignShield(include_dob=INCLUDE_DOB)
    try:
        safe_messages, ctx = sanitize_messages(shield, body.get("messages", []))
    except DataLeakError as exc:  # fail closed — never forward if a value would survive
        raise HTTPException(status_code=502, detail=f"shield refused to forward: {exc}") from exc
    body["messages"] = safe_messages

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        upstream = await client.post(
            f"{UPSTREAM}/chat/completions", json=body, headers=_forward_headers(request)
        )
    if upstream.status_code >= 400:
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "application/json"),
        )
    data = rehydrate_response(shield, upstream.json(), ctx)
    resp = JSONResponse(data)
    resp.headers["x-sovereign-shield"] = f"kept-on-shore={ctx.total}"
    return resp


def main() -> None:
    """Console entry point (`sovereign-shield-proxy`)."""
    import uvicorn

    uvicorn.run(
        "sovereign_shield.serve:app",
        host=os.environ.get("HOST", "0.0.0.0"),  # noqa: S104 - a sidecar must bind all interfaces
        port=int(os.environ.get("PORT", "8000")),
    )
