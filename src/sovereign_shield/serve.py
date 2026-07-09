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

Streaming (SSE, ``"stream": true``) is supported: placeholders are rehydrated
across chunk boundaries by holding back only a trailing fragment that could still
grow into a token, so a token split over two chunks (``[AH`` + ``V_1]``) is still
restored correctly. Only structured identifiers are tokenized (see the package docs).
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import AsyncIterator
from typing import Any

try:
    import httpx
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import JSONResponse, Response, StreamingResponse
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
# A trailing fragment that could still grow into a placeholder like [AHV_1] — held
# back while streaming so a token split across chunks is never emitted half-done.
_TOKEN_PARTIAL_RE = re.compile(r"\[[A-Z]*_?\d*$")

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


class _StreamRehydrator:
    """Per-channel rehydrator for streamed text.

    ``feed`` appends a piece to a channel's buffer, emits everything that can't be
    part of a not-yet-complete token, and holds the rest back until the next piece.
    A channel is a stream of text (assistant content, or one tool-call's arguments).
    """

    def __init__(self, shield: SovereignShield, ctx: SessionContext) -> None:
        self._shield = shield
        self._ctx = ctx
        self._buf: dict[str, str] = {}

    def feed(self, channel: str, text: str) -> str:
        buf = self._buf.get(channel, "") + text
        m = _TOKEN_PARTIAL_RE.search(buf)
        # Hold back a plausible trailing token fragment (bounded so a long "[AAAA…"
        # that never closes can't buffer forever).
        cut = m.start() if (m is not None and len(buf) - m.start() <= 40) else len(buf)
        self._buf[channel] = buf[cut:]
        return self._shield.rehydrate(buf[:cut], self._ctx).text if cut else ""

    def flush(self, channel: str) -> str:
        rest = self._buf.pop(channel, "")
        return self._shield.rehydrate(rest, self._ctx).text if rest else ""

    def flush_content(self) -> dict[int, str]:
        """Flush any held content channels; returns {choice_index: leftover_text}."""
        out: dict[int, str] = {}
        for channel in [c for c in self._buf if c.startswith("c")]:
            text = self.flush(channel)
            if text:
                out[int(channel[1:])] = text
        return out


def _rehydrate_delta(delta: dict[str, Any], reh: _StreamRehydrator, i: int) -> None:
    if isinstance(delta.get("content"), str):
        delta["content"] = reh.feed(f"c{i}", delta["content"])
    for tc in delta.get("tool_calls") or []:
        fn = tc.get("function") if isinstance(tc, dict) else None
        if isinstance(fn, dict) and isinstance(fn.get("arguments"), str):
            fn["arguments"] = reh.feed(f"t{i}.{tc.get('index', 0)}", fn["arguments"])


def _rehydrate_chunk(chunk: dict[str, Any], reh: _StreamRehydrator) -> None:
    """Rehydrate the deltas in one streamed ``chat.completion.chunk`` in place."""
    for choice in chunk.get("choices", []):
        if not isinstance(choice, dict):
            continue
        i = choice.get("index", 0)
        delta = choice.get("delta")
        if isinstance(delta, dict):
            _rehydrate_delta(delta, reh, i)
        if choice.get("finish_reason") is not None:
            tail = reh.flush(f"c{i}")
            if tail:
                target = choice.setdefault("delta", {})
                if isinstance(target, dict):
                    target["content"] = (target.get("content") or "") + tail


async def _nonstream_chat(
    body: dict[str, Any], headers: dict[str, str], shield: SovereignShield, ctx: SessionContext
) -> Response:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        upstream = await client.post(f"{UPSTREAM}/chat/completions", json=body, headers=headers)
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


async def _stream_chat(
    body: dict[str, Any], headers: dict[str, str], shield: SovereignShield, ctx: SessionContext
) -> StreamingResponse:
    async def gen() -> AsyncIterator[bytes]:
        reh = _StreamRehydrator(shield, ctx)
        async with (
            httpx.AsyncClient(timeout=TIMEOUT) as client,
            client.stream(
                "POST", f"{UPSTREAM}/chat/completions", json=body, headers=headers
            ) as upstream,
        ):
            if upstream.status_code >= 400:
                yield b"data: " + await upstream.aread() + b"\n\ndata: [DONE]\n\n"
                return
            async for line in upstream.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    yield f"data: {payload}\n\n".encode()
                    continue
                _rehydrate_chunk(chunk, reh)
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode()
        leftover = reh.flush_content()
        if leftover:
            final = {
                "choices": [{"index": i, "delta": {"content": t}} for i, t in leftover.items()]
            }
            yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n".encode()
        yield b"data: [DONE]\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"x-sovereign-shield": f"kept-on-shore={ctx.total}"},
    )


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"status": "ok", "upstream": UPSTREAM}


@app.post(
    "/v1/chat/completions",
    responses={502: {"description": "The shield refused to forward (a raw value would survive)."}},
)
async def chat_completions(request: Request) -> Response:
    body: dict[str, Any] = await request.json()
    shield = SovereignShield(include_dob=INCLUDE_DOB)
    try:
        body["messages"], ctx = sanitize_messages(shield, body.get("messages", []))
    except DataLeakError as exc:  # fail closed — never forward if a value would survive
        raise HTTPException(status_code=502, detail=f"shield refused to forward: {exc}") from exc
    headers = _forward_headers(request)
    if body.get("stream"):
        return await _stream_chat(body, headers, shield, ctx)
    return await _nonstream_chat(body, headers, shield, ctx)


def main() -> None:
    """Console entry point (`sovereign-shield-proxy`)."""
    import uvicorn

    uvicorn.run(
        "sovereign_shield.serve:app",
        host=os.environ.get("HOST", "0.0.0.0"),  # noqa: S104 - a sidecar must bind all interfaces
        port=int(os.environ.get("PORT", "8000")),
    )
