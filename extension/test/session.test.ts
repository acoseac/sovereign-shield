// Tests for the extension's stateful tokenizer. The shared detector is already gated
// by the Python↔TS parity vectors; Session (the value↔token map, restore, dedup) is
// extension-specific and otherwise untested.
import assert from "node:assert/strict";
import test from "node:test";

import { Session } from "../src/tokenize.ts";

const AHV = "756.1234.5678.97";
const EMAIL = "hans.muster@bluewin.ch";

test("valid identifier → stable placeholder, count 1", () => {
  const s = new Session();
  const out = s.tokenize(`AHV: ${AHV}`);
  assert.equal(out, "AHV: [AHV_1]");
  assert.equal(s.count, 1);
});

test("clean text is untouched", () => {
  const s = new Session();
  assert.equal(s.tokenize("nothing sensitive here"), "nothing sensitive here");
  assert.equal(s.count, 0);
});

test("the same value reuses the same token (dedup across turns)", () => {
  const s = new Session();
  s.tokenize(`first ${AHV}`);
  const again = s.tokenize(AHV);
  assert.equal(again, "[AHV_1]");
  assert.equal(s.count, 1);
});

test("rehydrate restores the real value and is idempotent", () => {
  const s = new Session();
  s.tokenize(AHV);
  const restored = s.rehydrate("The number is [AHV_1].");
  assert.equal(restored, `The number is ${AHV}.`);
  assert.equal(s.rehydrate(restored), restored); // no tokens left → unchanged
});

test("a token split across stream chunks is left untouched", () => {
  const s = new Session();
  s.tokenize(AHV);
  assert.equal(s.rehydrate("partial chunk [AHV_"), "partial chunk [AHV_");
});

test("allowed set restricts which categories tokenize", () => {
  const s = new Session();
  const out = s.tokenize(`AHV ${AHV} and ${EMAIL}`, new Set(["email"]));
  assert.ok(out.includes(AHV), "AHV should be left raw when its category is disabled");
  assert.ok(out.includes("[EMAIL_1]"), "email should be tokenized");
  assert.equal(s.count, 1);
});

test("secret detectors flow through from the parity port (e.g. an OpenAI key)", () => {
  const s = new Session();
  const key = "sk-" + "A".repeat(48);
  assert.equal(s.tokenize(`key ${key}`), "key [OPENAI_1]");
  assert.equal(s.count, 1);
});

test("Stripe key is detected by the TS port (concatenation keeps the literal out of source)", () => {
  // Stripe is verified here rather than via a committed parity vector: a full sk_live_
  // literal trips GitHub push protection (see scripts/gen_shield_vectors.py).
  const s = new Session();
  const key = "sk_live_" + "A".repeat(24);
  assert.equal(s.tokenize(`key ${key}`), "key [STRIPE_1]");
  assert.equal(s.count, 1);
});
