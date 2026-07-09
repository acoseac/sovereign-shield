# ADR 0001 — A stateless, OpenAI-compatible sanitizing proxy

**Status:** Accepted · **Date:** July 2026

## Context

The library (`sovereign_shield`) and the optional LangChain wrapper both require a
team to change application code to route calls through the shield. For adoption in
an existing Swiss/EU codebase that's high friction: the realistic ask is *"achieve
data residency without rewriting anything."*

The natural form of "no code changes" for LLM traffic is a **reverse proxy**: the
app changes only its `base_url`, and a service in between does the sanitize → call
→ rehydrate round-trip. Almost every client and SDK already speaks the
OpenAI-compatible `/v1/chat/completions` shape.

## Decision

Ship `sovereign_shield.serve` (the `[proxy]` extra + a `sovereign-shield-proxy`
console script + a `Dockerfile`): a small FastAPI service exposing
`POST /v1/chat/completions`. It tokenizes every string message content under one
shared placeholder map, forwards the sanitized body to a configurable upstream,
and rehydrates the assistant reply (content and tool-call arguments) on the way
back.

**Stateless and keyless — deliberately:**

- The token↔value map lives in memory only for the duration of one request and is
  gone afterwards. No database, no key management, no multi-tenant isolation to
  build or defend.
- The caller's `Authorization` header is forwarded upstream unchanged; the proxy
  never holds a provider credential.

Config is env-only: `SOVEREIGN_UPSTREAM_BASE_URL` (default
`https://api.openai.com/v1` — set it to any OpenAI-compatible endpoint, e.g.
Gemini's or DeepSeek's), `SOVEREIGN_INCLUDE_DOB`, `SOVEREIGN_TIMEOUT`, `HOST`,
`PORT`.

Shared-context tokenization is done by NUL-joining all string message contents,
sanitizing in a single pass, then splitting back — a NUL can't occur inside a
structured identifier, so the join/split is exact and can't merge spans across
messages. The whole pass is fail-closed: if any raw value would survive, the core
raises `DataLeakError` and the proxy returns an error rather than forwarding.

## Scope (v1) and non-goals

- **In:** non-streaming `/v1/chat/completions`; a `/healthz` check; an
  `x-sovereign-shield: kept-on-shore=<n>` audit header; upstream errors passed
  through verbatim.
- **Deferred (fast-follow):** **streaming (SSE)** — rehydrating across streamed
  chunks needs care, so `stream: true` is rejected with a clear 400 for now.
  Other endpoints (`/v1/embeddings`, `/v1/models`, …) are not proxied yet.
- **Explicit non-goal:** a multi-tenant enterprise gateway with persistence,
  key vaults, and RBAC. The value — and the moat — is that this stays a small,
  stateless, unbluffable perimeter for structured identifiers. Free-text PII
  (names/addresses) is still out of scope by design; chain an NER redactor
  upstream if needed.

## Consequences

- A Swiss team gets data residency by changing one environment variable.
- The proxy is trivial to reason about and to run (one container, no state).
- The same artifact is what a future containment benchmark should exercise, so the
  headline number describes the thing people actually deploy — not just a library
  call.
