// Regression tests for the request-body rewriter. The bug these pin: the old
// freq path re-encoded the WHOLE Gemini body (URLSearchParams round-trip) even
// when nothing was redacted, dropping the trailing "&" and re-percent-encoding
// ' ( ) ! ~ — enough for the stricter Gemini "thinking" backend to reject the
// send. A clean prompt must now leave the guard byte-for-byte identical.
import assert from "node:assert/strict";
import test from "node:test";

import { Session } from "../src/tokenize.ts";
import { rewriteBody } from "../src/rewrite.ts";

const AHV = "756.1234.5678.97"; // checksum-valid Swiss AHV (see session.test.ts)

// Build a Gemini StreamGenerate body the way the page's client does: f.req holds a
// JSON string, plus an `at` anti-forgery token and the client's trailing "&".
function geminiBody(prompt: string): string {
  const inner = JSON.stringify([
    [prompt, 0, null, null, null, null, 0],
    ["en"],
    ["c_abc123", "r_def456", "rc_ghi789"],
    null, null, null, [0], 1, null, null, 1, 0,
  ]);
  const fReq = JSON.stringify([null, inner]);
  return `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent("AKz8bP:1736900000000")}&`;
}

test("freq: clean prompt is returned byte-for-byte (thinking-mode regression)", () => {
  // Every character class the old round-trip mangled: parens, !, ~, ', unicode.
  const body = geminiBody("Fix A: canInteract (!isExpanded) → what's up ✓ ~x — done!");
  const { body: out, changed } = rewriteBody("freq", body, new Session(), undefined);
  assert.equal(changed, false);
  assert.equal(out, body); // identical, not merely equivalent
});

test("freq: redaction swaps only the f.req value, preserving every other byte", () => {
  const body = geminiBody(`my AHV is ${AHV} thanks`);
  const { body: out, changed } = rewriteBody("freq", body, new Session(), undefined);
  assert.equal(changed, true);
  // `at` token and the trailing "&" survive untouched.
  assert.ok(out.includes("&at=AKz8bP%3A1736900000000&"), "at token + trailing & preserved");
  assert.ok(out.endsWith("&"), "trailing separator preserved");
  // The redacted body still decodes to a valid f.req with the token in place.
  const fReq = new URLSearchParams(out).get("f.req");
  assert.ok(fReq);
  const prompt = JSON.parse(JSON.parse(fReq)[1])[0][0];
  assert.equal(prompt, "my AHV is [AHV_1] thanks");
});

test("freq: f.req need not be the first parameter", () => {
  const inner = JSON.stringify([[`AHV ${AHV}`, 0], ["en"]]);
  const body = `at=tok&f.req=${encodeURIComponent(JSON.stringify([null, inner]))}&bl=boq_x`;
  const { body: out, changed } = rewriteBody("freq", body, new Session(), undefined);
  assert.equal(changed, true);
  assert.ok(out.startsWith("at=tok&f.req="), "leading params preserved");
  assert.ok(out.endsWith("&bl=boq_x"), "trailing params preserved");
});

test("json: clean body is returned byte-for-byte", () => {
  const body = JSON.stringify({ messages: [{ text: "what's up (test)! ~ok" }], model: "x" });
  const { body: out, changed } = rewriteBody("json", body, new Session(), undefined);
  assert.equal(changed, false);
  assert.equal(out, body);
});

test("json: redaction rewrites the body and flags changed", () => {
  const body = JSON.stringify({ text: `card AHV ${AHV}` });
  const { body: out, changed } = rewriteBody("json", body, new Session(), undefined);
  assert.equal(changed, true);
  assert.equal(JSON.parse(out).text, "card AHV [AHV_1]");
});

test("a body with no f.req is passed through untouched", () => {
  const body = "at=tok&hl=en";
  const { body: out, changed } = rewriteBody("freq", body, new Session(), undefined);
  assert.equal(changed, false);
  assert.equal(out, body);
});

test("malformed f.req JSON fails open to the original body", () => {
  const body = "f.req=not-json&at=tok";
  const { body: out, changed } = rewriteBody("freq", body, new Session(), undefined);
  assert.equal(changed, false);
  assert.equal(out, body);
});
