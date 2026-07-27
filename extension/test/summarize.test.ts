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

// --- the pill must agree with the guard after "stop redacting this" ---------
// Session.detect drops values the user excused via the inspector; summarize() had no way to
// know, so the pill went on counting a value the guard would deliberately let through. The
// values live in the MAIN world and cannot cross (ADR 0005), which is why summarize() now takes
// the set and is called there — see pending.ts.

test("an excused value is not counted", () => {
  const text = `AHV ${AHV} and email ${EMAIL}`;
  assert.equal(summarize(text, undefined).count, 2);
  const s = summarize(text, undefined, undefined, new Set([EMAIL]));
  assert.equal(s.count, 1);
  assert.deepEqual(s.categories, ["Swiss AHV / AVS"]);
});

test("excusing the only value of a category drops its label too", () => {
  // Labels are derived AFTER the excused filter for exactly this reason: deriving them from the
  // unfiltered hits would keep naming a category with nothing left in it.
  const s = summarize(`email ${EMAIL}`, undefined, undefined, new Set([EMAIL]));
  assert.equal(s.count, 0);
  assert.deepEqual(s.categories, []);
});

test("excusing one occurrence excuses every identical occurrence", () => {
  // The guard matches the allowlist by value, not by span, so the pill must too.
  const s = summarize(`${EMAIL} and again ${EMAIL}`, undefined, undefined, new Set([EMAIL]));
  assert.equal(s.count, 0);
});

test("an excused value does not reduce the count of a DIFFERENT value", () => {
  const other = "other.person@corp.example";
  const s = summarize(`${EMAIL} and ${other}`, undefined, undefined, new Set([EMAIL]));
  assert.equal(s.count, 1);
});

test("summarize with the excused set matches what the guard actually mints", () => {
  // The property that matters: pill number == tokens the guard would create.
  const text = `AHV ${AHV} and email ${EMAIL}`;
  const session = new Session();
  session.allow(EMAIL); // as the inspector's "Stop redacting" does
  session.tokenize(text);
  assert.equal(summarize(text, undefined, undefined, session.excused).count, session.count);
  assert.equal(session.count, 1);
});

test("an empty excused set behaves exactly as before", () => {
  const text = `AHV ${AHV} and email ${EMAIL}`;
  assert.deepEqual(summarize(text, undefined, undefined, new Set()), summarize(text, undefined));
});
