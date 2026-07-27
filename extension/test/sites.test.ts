// The endpoint fingerprints are the single point of total failure: if `generateKind` stops
// matching, every transport hook falls through and the guard silently does nothing on that
// site. They had no tests at all — the logic lived inside interceptor.ts, which patches
// fetch/XHR and touches `document` at import, so it could not be loaded in Node. Extracting
// sites.ts made it testable; these are the cases worth pinning.
import assert from "node:assert/strict";
import test from "node:test";

import { SITES, SUPPORTED_HOSTS, generateKind, isSupportedHost, transportsFor } from "../src/sites.ts";

// Real URLs, as observed in live traffic (see interceptor.ts's header).
const GEMINI = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_x&_reqid=1&rt=c";
const CHATGPT = "https://chatgpt.com/backend-api/f/conversation";
const CHATGPT_PLAIN = "https://chatgpt.com/backend-api/conversation";
const CLAUDE = "https://claude.ai/api/organizations/8f2a/chat_conversations/1b3c/completion";

test("each site's generate URL maps to the right body kind", () => {
  assert.equal(generateKind(GEMINI), "freq");
  assert.equal(generateKind(CHATGPT), "json");
  assert.equal(generateKind(CHATGPT_PLAIN), "json", "the /f/ segment is optional");
  assert.equal(generateKind(CLAUDE), "json");
});

test("ChatGPT's conversation endpoint matches with a query string, and at the end", () => {
  assert.equal(generateKind("https://chatgpt.com/backend-api/conversation?x=1"), "json");
  assert.equal(generateKind("https://chatgpt.com/backend-api/f/conversation?stream=1"), "json");
});

test("near-miss URLs do NOT match", () => {
  // Each of these is a real-shaped call the sites make constantly. Matching one would mean
  // buffering and rewriting a body we have no model of.
  const misses = [
    "https://chatgpt.com/backend-api/conversations", // plural — the history list
    "https://chatgpt.com/backend-api/conversation/init", // trailing segment
    "https://chatgpt.com/backend-api/models",
    "https://claude.ai/api/organizations/8f2a/chat_conversations/1b3c", // no /completion
    "https://claude.ai/api/organizations/8f2a/completion", // no /chat_conversations/
    "https://gemini.google.com/_/BardChatUi/data/batchexecute",
    "https://gemini.google.com/app",
  ];
  for (const url of misses) {
    assert.equal(generateKind(url), null, url);
  }
});

test("a non-generate URL yields null rather than a default kind", () => {
  assert.equal(generateKind(""), null);
  assert.equal(generateKind("https://example.com/"), null);
});

// --- transport selection ----------------------------------------------------
// Getting this wrong is silent: hook the transport a site doesn't use and the guard installs
// cleanly, reports nothing, and never sees a single send.

test("each site gets exactly the transport it actually uses", () => {
  assert.deepEqual(transportsFor("gemini.google.com"), { xhr: true, fetch: false });
  assert.deepEqual(transportsFor("chatgpt.com"), { xhr: false, fetch: true });
  assert.deepEqual(transportsFor("chat.openai.com"), { xhr: false, fetch: true });
  assert.deepEqual(transportsFor("claude.ai"), { xhr: false, fetch: true });
});

test("an unknown host gets BOTH hooks, never neither", () => {
  // The safe direction: if the manifest gains a site nobody classified here, the guard must
  // still see its sends. A spare wrapper costs nothing; an unguarded prompt is the whole bug.
  assert.deepEqual(transportsFor("example.com"), { xhr: true, fetch: true });
  assert.deepEqual(transportsFor(""), { xhr: true, fetch: true });
});

test("subdomains of a supported host are still that host", () => {
  assert.deepEqual(transportsFor("www.claude.ai"), { xhr: false, fetch: true });
  assert.ok(isSupportedHost("www.chatgpt.com"));
});

test("a lookalike hostname is not a supported host", () => {
  // The substring test this replaced would have accepted every one of these.
  for (const host of ["claude.ai.evil.example", "notchatgpt.com", "evil-claude.ai", "geminigoogle.com"]) {
    assert.equal(isSupportedHost(host), false, host);
  }
});

test("every declared site is reachable through both lookups", () => {
  // Guards against a site being added to SITES with a host nothing routes to, or a matcher
  // that never fires.
  for (const site of SITES) {
    assert.ok(isSupportedHost(site.host), `${site.name}: host not recognised`);
    const t = transportsFor(site.host);
    assert.equal(t[site.transport], true, `${site.name}: declared transport not selected`);
  }
  assert.equal(SUPPORTED_HOSTS.length, SITES.length);
});
