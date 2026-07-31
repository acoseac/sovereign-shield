// Tests for the ready-made rule library.
//
// A template ships as vendored data, so nobody types it and nobody sees it fail before a user
// does. These assert the three things that would make one actively harmful: a pattern the save
// linter would reject (so the rule silently never persists), a pattern that does not match the
// thing it claims to (so the user believes they are covered and are not), and a pattern that
// fires on ordinary prose (which is the false-positive behaviour the whole product argues
// against).
import assert from "node:assert/strict";
import test from "node:test";

import { compileRules, lintRegex, MAX_LABEL, MAX_PATTERN } from "../src/custom.ts";
import {
  RULE_TEMPLATES,
  instantiateTemplate,
  templateAlreadyAdded,
  type RuleTemplate,
} from "../src/templates.ts";

/** What the guard would actually keep local for `text`, using only this template's rule. */
function hits(template: RuleTemplate, text: string): number {
  const match = compileRules([instantiateTemplate(template)]);
  return match ? match(text).length : 0;
}

test("every template survives the save-time linter", () => {
  // A template that fails lintRegex would be dropped by persistRules() the moment it was added:
  // the user clicks Add, the row appears, and nothing is ever saved.
  for (const t of RULE_TEMPLATES) {
    assert.equal(lintRegex(t.rule.pattern), null, `${t.id}: ${lintRegex(t.rule.pattern)}`);
  }
});

test("every template respects the editor's own limits", () => {
  for (const t of RULE_TEMPLATES) {
    assert.ok(t.rule.pattern.length <= MAX_PATTERN, `${t.id} pattern too long`);
    assert.ok((t.rule.label ?? "").length <= MAX_LABEL, `${t.id} label too long`);
    // One condition per assertion: a composite hides which field is missing, which for vendored
    // display copy is the only thing the failure needed to tell you (SonarCloud S9073).
    assert.ok(t.name, `${t.id} has no name`);
    assert.ok(t.description, `${t.id} has no description`);
    assert.ok(t.example, `${t.id} has no example`);
  }
});

test("ids and patterns are unique", () => {
  const ids = RULE_TEMPLATES.map((t) => t.id);
  const patterns = RULE_TEMPLATES.map((t) => t.rule.pattern);
  assert.equal(new Set(ids).size, ids.length, "duplicate template id");
  assert.equal(new Set(patterns).size, patterns.length, "two templates would add the same rule");
});

test("every template matches its own example", () => {
  // The example is the promise the description makes, so it is the fixture worth pinning.
  for (const t of RULE_TEMPLATES) {
    assert.equal(hits(t, t.example), 1, `${t.id} did not match its example: ${t.example}`);
  }
});

test("no template fires on ordinary prose", () => {
  // The product's stated promise is that ordinary text is untouched. A template that trips on
  // a normal sentence would make the pill cry wolf on every message.
  const prose =
    "Thanks for the update — let's review the Q3 plan on Tuesday and ship the release notes " +
    "once the 2 or 3 remaining items are closed. Call me on extension 4021 if anything slips.";
  for (const t of RULE_TEMPLATES) {
    assert.equal(hits(t, prose), 0, `${t.id} matched ordinary prose`);
  }
});

test("a date is not mistaken for an identifier", () => {
  // Why there is no UK sort-code template: \d{2}-\d{2}-\d{2} also matches 01-02-03. These are
  // the near-misses the shipped set has to stay clear of.
  for (const t of RULE_TEMPLATES) {
    assert.equal(hits(t, "meeting on 01-02-03 and again on 2026-07-31"), 0, t.id);
  }
});

test("a public IP is not treated as internal", () => {
  const internal = RULE_TEMPLATES.find((t) => t.id === "private-ip");
  assert.ok(internal);
  assert.equal(hits(internal, "resolver 8.8.8.8 and 172.32.5.1"), 0, "outside RFC 1918");
  assert.equal(hits(internal, "host 172.16.0.9"), 1, "inside RFC 1918");
});

test("templateAlreadyAdded compares on the pattern, not identity", () => {
  // Rules persist as plain CustomRules with no template marker, so the pattern is the only
  // durable link back to the library.
  const t = RULE_TEMPLATES[0];
  assert.equal(templateAlreadyAdded(t, []), false);
  assert.equal(templateAlreadyAdded(t, [instantiateTemplate(t)]), true);
  assert.equal(
    templateAlreadyAdded(t, [{ pattern: ` ${t.rule.pattern} `, isRegex: true }]),
    true,
    "whitespace the editor round-tripped should not hide it",
  );
  assert.equal(templateAlreadyAdded(t, [{ pattern: "something else", isRegex: false }]), false);
});

test("instantiateTemplate hands out a copy, never the vendored object", () => {
  // The editor mutates rules in place as the user types; returning the library literal would let
  // one edit rewrite the template for the rest of the session.
  const t = RULE_TEMPLATES[0];
  const made = instantiateTemplate(t);
  made.pattern = "mutated";
  made.label = "mutated";
  assert.notEqual(t.rule.pattern, "mutated");
  assert.notEqual(t.rule.label, "mutated");
});
