"""Tests for the OpenAI-compatible sanitizing reverse proxy (sovereign_shield.serve)."""

from __future__ import annotations

import asyncio
import json
import re

import pytest
from fastapi.testclient import TestClient

from sovereign_shield import serve

AHV = "756.9217.0769.85"
IBAN = "CH9300762011623852957"
TOKEN_RE = re.compile(r"\[[A-Z]+_\d+\]")

# What the stub upstream last received (set by _FakeClient.post).
CAPTURED: dict = {}


class _FakeResp:
    def __init__(self, payload: dict, status: int = 200) -> None:
        self._payload = payload
        self.status_code = status
        self.content = json.dumps(payload).encode()
        self.headers = {"content-type": "application/json"}

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    """Stub upstream: records the forwarded request and echoes back its placeholders."""

    def __init__(self, *args, **kwargs) -> None:
        # Accept and ignore httpx.AsyncClient's constructor args.
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args) -> bool:
        return False

    async def post(self, url, json=None, headers=None):
        await asyncio.sleep(0)  # a real await — this stub mimics an async client
        CAPTURED.clear()
        CAPTURED.update({"url": url, "json": json, "headers": headers})
        sent = " ".join(
            m.get("content", "") for m in json["messages"] if isinstance(m.get("content"), str)
        )
        toks = TOKEN_RE.findall(sent)
        reply = ("Noted " + ", ".join(toks) + ".") if toks else "Nothing to note."
        return _FakeResp({"choices": [{"message": {"role": "assistant", "content": reply}}]})


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(serve.httpx, "AsyncClient", _FakeClient)
    CAPTURED.clear()
    return TestClient(serve.app)


def test_healthz(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_sanitizes_out_and_rehydrates_in(client: TestClient) -> None:
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "You are helpful."},
                {"role": "user", "content": f"Refund AHV {AHV} to IBAN {IBAN}."},
            ],
        },
    )
    assert r.status_code == 200
    # What actually left the proxy: no raw PII, placeholders instead.
    forwarded = " ".join(m["content"] for m in CAPTURED["json"]["messages"])
    assert AHV not in forwarded
    assert IBAN not in forwarded
    assert "[AHV_1]" in forwarded
    assert "[IBAN_1]" in forwarded
    # What the client got back: real values restored.
    content = r.json()["choices"][0]["message"]["content"]
    assert AHV in content
    assert IBAN in content
    assert r.headers["x-sovereign-shield"] == "kept-on-shore=2"


def test_same_value_shares_one_token_across_messages(client: TestClient) -> None:
    r = client.post(
        "/v1/chat/completions",
        json={
            "messages": [
                {"role": "user", "content": f"My IBAN is {IBAN}."},
                {"role": "user", "content": f"Confirm {IBAN} please."},
            ]
        },
    )
    assert r.status_code == 200
    msgs = CAPTURED["json"]["messages"]
    assert "[IBAN_1]" in msgs[0]["content"]
    assert "[IBAN_1]" in msgs[1]["content"]
    assert IBAN not in msgs[0]["content"]
    assert IBAN not in msgs[1]["content"]


def test_no_pii_passes_through(client: TestClient) -> None:
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "What are your opening hours?"}]},
    )
    assert r.status_code == 200
    assert CAPTURED["json"]["messages"][0]["content"] == "What are your opening hours?"
    assert r.headers["x-sovereign-shield"] == "kept-on-shore=0"


def test_streaming_is_rejected(client: TestClient) -> None:
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
    )
    assert r.status_code == 400
    assert "streaming" in r.json()["detail"].lower()


def test_upstream_error_is_passed_through(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _ErrClient(_FakeClient):
        async def post(self, url, json=None, headers=None):
            await asyncio.sleep(0)
            return _FakeResp({"error": {"message": "bad key"}}, status=401)

    monkeypatch.setattr(serve.httpx, "AsyncClient", _ErrClient)
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": f"AHV {AHV}"}]},
    )
    assert r.status_code == 401
