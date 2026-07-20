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

// `surrogatable` drives the pill's wording. It must never over-claim: with smokescreen on,
// an AHV/IBAN/secret is still sent as a bracket token, so the pill may not say "stand-ins
// sent instead" unless every counted value can actually take one.
test("surrogatable counts only the values that can take a stand-in", () => {
  assert.equal(summarize(`AHV ${AHV}`, undefined).surrogatable, 0, "AHV is never surrogatable");
  assert.equal(summarize(`IBAN ${IBAN}`, undefined).surrogatable, 0, "IBAN is never surrogatable");

  const email = summarize(`mail ${EMAIL}`, undefined);
  assert.equal(email.count, 1);
  assert.equal(email.surrogatable, 1, "email is surrogatable");

  const mixed = summarize(`AHV ${AHV}, IBAN ${IBAN}, mail ${EMAIL}`, undefined);
  assert.equal(mixed.count, 3);
  assert.equal(mixed.surrogatable, 1, "only the email of the three");
});

test("surrogatable dedups by value, like count", () => {
  const s = summarize(`${EMAIL} and again ${EMAIL}`, undefined);
  assert.equal(s.count, 1);
  assert.equal(s.surrogatable, 1);
});

test("a custom-rule hit is surrogatable", () => {
  const matcher = (text: string) => {
    const i = text.indexOf("Contoso");
    return i === -1 ? [] : [{ start: i, end: i + 7, label: "client" }];
  };
  const s = summarize("Contoso is the client", undefined, matcher);
  assert.equal(s.count, 1);
  assert.equal(s.surrogatable, 1);
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
