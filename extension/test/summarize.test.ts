// Pure-logic tests for the pre-send indicator's count/label logic.
// Run: npm test  (node --test, native TS stripping — no runner dependency).
import assert from "node:assert/strict";
import test from "node:test";

import { Session } from "../src/tokenize.ts";
import { summarize } from "../src/summarize.ts";

// Synthetic, checksum-valid fixtures (same ones used across the repo's docs/tests).
const AHV = "756.1234.5678.97";
const IBAN = "CH9300762011623852957";
const EMAIL = "hans.muster@bluewin.ch";

test("clean text → nothing to keep local", () => {
  const s = summarize("Draft a friendly reply to the customer, no numbers here.", undefined);
  assert.equal(s.count, 0);
  assert.deepEqual(s.categories, []);
});

test("a single checksum-valid AHV → one item, labelled", () => {
  const s = summarize(`My AHV is ${AHV}.`, undefined);
  assert.equal(s.count, 1);
  assert.deepEqual(s.categories, ["Swiss AHV / AVS"]);
});

test("the same value repeated counts once (per-value dedup)", () => {
  const s = summarize(`First ${AHV}, then again ${AHV}.`, undefined);
  assert.equal(s.count, 1);
  assert.deepEqual(s.categories, ["Swiss AHV / AVS"]);
});

test("distinct identifiers across categories → count + sorted labels", () => {
  const s = summarize(`AHV ${AHV}, IBAN ${IBAN}, mail ${EMAIL}`, undefined);
  assert.equal(s.count, 3);
  assert.deepEqual(s.categories, ["Email", "IBAN", "Swiss AHV / AVS"]); // alphabetical
});

test("allowed set filters out disabled categories", () => {
  const allowed = new Set(["email"]);
  const s = summarize(`AHV ${AHV} and email ${EMAIL}`, allowed);
  assert.equal(s.count, 1); // AHV excluded
  assert.deepEqual(s.categories, ["Email"]);
});

test("a date of birth is NOT counted (guard omits DOB)", () => {
  const s = summarize("Date of birth: 1990-05-14.", undefined);
  assert.equal(s.count, 0);
});

test("count matches the tokens the guard would actually mint (Session.count)", () => {
  const text = `AHV ${AHV}, again ${AHV}, and IBAN ${IBAN}`;
  const session = new Session();
  session.tokenize(text);
  assert.equal(summarize(text, undefined).count, session.count);
});
