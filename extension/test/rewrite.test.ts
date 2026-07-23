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

// --- nested JSON: escapes must not be readable as text ----------------------
// Gemini's f.req is JSON inside JSON, so the inner document reached the detectors
// ESCAPE-ENCODED — `\t` as two literal characters. In "Name\tango@corp.example" the
// detector matched "tango@corp.example", eating the escape's `t`; the replacement left a
// dangling `\[`, which is invalid JSON, so the send was rejected outright. It only bites
// when a value sits right after an escape, which is why a pasted TABLE broke while prose
// did not. ChatGPT/Claude parse once and never see this.

/** Pull the inner document back out of a rewritten freq body. */
function innerOf(body: string): unknown {
  const fReq = new URLSearchParams(body).get("f.req");
  assert.ok(fReq, "f.req should still be present");
  return JSON.parse(JSON.parse(fReq)[1] as string);
}

test("freq: a value directly after a tab escape still yields parseable JSON", () => {
  const body = geminiBody("Name\tango@corp.example\tactive");
  const { body: out, changed } = rewriteBody("freq", body, new Session(), undefined);
  assert.equal(changed, true);
  const inner = innerOf(out) as [[string, ...unknown[]], ...unknown[]];
  assert.equal(inner[0][0], "Name\t[EMAIL_1]\tactive", "the escape must survive intact");
});

test("freq: newline-separated table columns redact the RIGHT value", () => {
  // The mapping must hold the real address. Eating the escape's `n` stored "nango@..." —
  // a value nobody has, which rehydration would then paint back into the reply.
  const session = new Session();
  const body = geminiBody("Alicia Ngo\nango@corp.example\nSpecialist");
  const { body: out } = rewriteBody("freq", body, session, undefined);
  const inner = innerOf(out) as [[string, ...unknown[]], ...unknown[]];
  assert.equal(inner[0][0], "Alicia Ngo\n[EMAIL_1]\nSpecialist");
  assert.equal(session.rehydrate("[EMAIL_1]"), "ango@corp.example");
});

test("freq: every escape class survives a redaction in the same string", () => {
  const body = geminiBody('a\tx@corp.example b\nc\\d "q" e\rf');
  const { body: out } = rewriteBody("freq", body, new Session(), undefined);
  const inner = innerOf(out) as [[string, ...unknown[]], ...unknown[]];
  assert.equal(inner[0][0], 'a\t[EMAIL_1] b\nc\\d "q" e\rf');
});

test("freq: a clean nested document is still returned byte-for-byte", () => {
  // The recursion must not re-serialise a subtree it did not change, or every clean prompt
  // stops being byte-identical — the exact regression ADR 0002 exists to prevent.
  const body = geminiBody("Name\tnothing sensitive\tactive");
  const { body: out, changed } = rewriteBody("freq", body, new Session(), undefined);
  assert.equal(changed, false);
  assert.equal(out, body);
});

test("a prompt that is itself pretty-printed JSON is never reformatted", () => {
  // Only round-trippable structures take the nested path. Pretty-printed JSON does not
  // re-serialise byte-for-byte, so it stays plain text and keeps the user's own whitespace.
  const pretty = '{\n  "email": "x@corp.example",\n  "n": 1\n}';
  const { body: out } = rewriteBody("json", JSON.stringify({ prompt: pretty }), new Session(), undefined);
  const parsed = JSON.parse(out) as { prompt: string };
  assert.equal(parsed.prompt, '{\n  "email": "[EMAIL_1]",\n  "n": 1\n}');
});

test("a prompt that is compact JSON is walked, not treated as text", () => {
  const compact = '{"email":"x@corp.example"}';
  const { body: out } = rewriteBody("json", JSON.stringify({ prompt: compact }), new Session(), undefined);
  const parsed = JSON.parse(out) as { prompt: string };
  assert.equal(parsed.prompt, '{"email":"[EMAIL_1]"}');
});

test("a bare scalar string is never reinterpreted as JSON", () => {
  // JSON.parse("123") succeeds and yields a number; reinterpreting would corrupt the prompt.
  for (const scalar of ["123", "true", "null", '"quoted"']) {
    const { body: out } = rewriteBody("json", JSON.stringify({ p: scalar }), new Session(), undefined);
    assert.equal((JSON.parse(out) as { p: string }).p, scalar, `scalar ${scalar}`);
  }
});
