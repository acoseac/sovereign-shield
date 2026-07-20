// Tests for the extension-only custom keyword/regex blocklist (custom.ts) and its
// integration with the stateful tokenizer and the pre-send pill.
// Run: npm test  (node --test, native TS stripping — no runner dependency).
import assert from "node:assert/strict";
import test from "node:test";

import { acceptCustomHits, compileRules, lintRegex, type CustomRule } from "../src/custom.ts";
import { Session } from "../src/tokenize.ts";
import { summarize } from "../src/summarize.ts";

function spansOf(rules: CustomRule[], text: string): Array<[number, number]> {
  const m = compileRules(rules);
  assert.ok(m, "expected a matcher");
  return m(text).map((h) => [h.start, h.end]);
}

test("literal rule matches, case-insensitive by default", () => {
  assert.deepEqual(spansOf([{ pattern: "Apollo", isRegex: false }], "the apollo program"), [[4, 10]]);
});

test("literal rule is whole-word by default (no mid-identifier match)", () => {
  assert.deepEqual(spansOf([{ pattern: "Apollo", isRegex: false }], "ApolloService rocks"), []);
});

test("whole-word can be disabled for substring matching", () => {
  assert.deepEqual(spansOf([{ pattern: "acme", isRegex: false, wholeWord: false }], "acmecorp.io"), [
    [0, 4],
  ]);
});

test("case-sensitive literal respects case", () => {
  assert.deepEqual(
    spansOf([{ pattern: "Apollo", isRegex: false, caseSensitive: true }], "apollo"),
    [],
  );
});

test("regex rule matches", () => {
  assert.deepEqual(spansOf([{ pattern: "acme-\\d+", isRegex: true }], "ticket acme-42 open"), [
    [7, 14],
  ]);
});

test("invalid regex is dropped", () => {
  assert.equal(compileRules([{ pattern: "(", isRegex: true }]), undefined);
});

test("catastrophic nested-quantifier regex is refused", () => {
  assert.equal(compileRules([{ pattern: "(a+)+$", isRegex: true }]), undefined);
});

test("empty / whitespace patterns are dropped", () => {
  assert.equal(compileRules([{ pattern: "   ", isRegex: false }]), undefined);
});

test("acceptCustomHits: a built-in span wins on overlap", () => {
  const text = "id 756.1234.5678.97 x";
  const matcher = compileRules([{ pattern: "756", isRegex: false, wholeWord: false }]);
  assert.ok(matcher);
  const builtin: Array<[number, number]> = [[3, 19]]; // pretend the AHV span was claimed
  assert.deepEqual(acceptCustomHits(text, builtin, matcher), []);
});

test("acceptCustomHits: longest custom span wins on self-overlap", () => {
  const matcher = compileRules([
    { pattern: "alpha", isRegex: false, wholeWord: false },
    { pattern: "alphabet", isRegex: false, wholeWord: false },
  ]);
  assert.ok(matcher);
  const kept = acceptCustomHits("alphabet", [], matcher).map((h) => h.end - h.start);
  assert.deepEqual(kept, [8]); // the 8-char span wins; the overlapping "alpha" is dropped
});

test("Session tokenizes a custom match to [CUSTOM_n]", () => {
  const s = new Session();
  s.customMatcher = compileRules([{ pattern: "Project-Apollo", isRegex: false }]);
  assert.equal(s.tokenize("re: Project-Apollo launch"), "re: [CUSTOM_1] launch");
  assert.equal(s.count, 1);
});

test("Session: built-in PII wins over an overlapping custom rule", () => {
  const s = new Session();
  s.customMatcher = compileRules([{ pattern: "756", isRegex: false, wholeWord: false }]);
  assert.equal(s.tokenize("AHV 756.1234.5678.97"), "AHV [AHV_1]");
});

test("Session: custom is skipped when 'custom' is not in the allowed set", () => {
  const s = new Session();
  s.customMatcher = compileRules([{ pattern: "Apollo", isRegex: false }]);
  assert.equal(s.tokenize("Apollo", new Set(["email"])), "Apollo");
});

test("Session: a throwing matcher fails open — built-in redaction still runs", () => {
  const s = new Session();
  s.customMatcher = () => {
    throw new Error("boom");
  };
  assert.equal(s.tokenize("AHV 756.1234.5678.97"), "AHV [AHV_1]");
});

test("summarize includes custom hits and uses the rule label", () => {
  const matcher = compileRules([
    { pattern: "Project-Apollo", isRegex: false, label: "Project Apollo" },
  ]);
  const s = summarize("ship Project-Apollo now", undefined, matcher);
  assert.equal(s.count, 1);
  assert.deepEqual(s.categories, ["Project Apollo"]);
});

test("summarize falls back to 'Custom terms' when a rule has no label", () => {
  const matcher = compileRules([{ pattern: "Apollo", isRegex: false }]);
  assert.deepEqual(summarize("Apollo", undefined, matcher).categories, ["Custom terms"]);
});

test("lintRegex accepts a simple pattern, rejects invalid / catastrophic ones", () => {
  assert.equal(lintRegex("acme-\\d+"), null);
  assert.ok(lintRegex("(")); // invalid syntax
  assert.ok(lintRegex("(a+)+$")); // nested quantifier
});
