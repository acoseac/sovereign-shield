// decodePending reads an attribute off <html>, which lives in a DOM the page can write to.
// Everything it returns feeds the pill's copy ("N items (…) will be kept local"), so a page
// script could otherwise make the guard appear to promise something it will not do. Treated as
// untrusted input throughout: anything that isn't the exact shape we published is rejected, and
// the caller falls back to computing its own summary.
import assert from "node:assert/strict";
import test from "node:test";

import { decodePending } from "../src/pending.ts";

const good = JSON.stringify({ c: 2, k: ["Email", "Swiss AHV / AVS"], s: 1 });

test("a well-formed summary round-trips", () => {
  assert.deepEqual(decodePending(good), {
    count: 2,
    categories: ["Email", "Swiss AHV / AVS"],
    surrogatable: 1,
  });
});

test("absent or empty means 'nothing published'", () => {
  assert.equal(decodePending(undefined), null);
  assert.equal(decodePending(""), null);
});

test("malformed or hostile payloads are rejected, never partially trusted", () => {
  const bad = [
    "not json",
    "null",
    "[]", // arrays are objects but carry none of the fields
    '"a string"',
    "42",
    JSON.stringify({ c: 2 }), // missing k and s
    JSON.stringify({ c: "2", k: [], s: 0 }), // count as a string
    JSON.stringify({ c: -1, k: [], s: 0 }), // negative count
    JSON.stringify({ c: 1, k: "Email", s: 0 }), // categories not an array
    JSON.stringify({ c: 1, k: [1, 2], s: 0 }), // categories not strings
    JSON.stringify({ c: 1, k: [], s: "1" }), // surrogatable as a string
    JSON.stringify({ c: Number.NaN, k: [], s: 0 }), // NaN survives JSON as null, but guard anyway
  ];
  for (const raw of bad) {
    assert.equal(decodePending(raw), null, raw);
  }
});

test("a zero-count summary is valid, not falsy-rejected", () => {
  // Distinct from "nothing published": the pill hides on 0, and must not fall back to its own
  // count instead — falling back would resurrect the excused value it was told to drop.
  assert.deepEqual(decodePending(JSON.stringify({ c: 0, k: [], s: 0 })), {
    count: 0,
    categories: [],
    surrogatable: 0,
  });
});
