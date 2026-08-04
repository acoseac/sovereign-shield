// Cross-check for the SITE's preset library (web/lib/presets.ts) — enforced HERE because
// extension→web is the sanctioned import direction (tokenize.ts already imports
// web/lib/shield.ts) and web/ has no unit-test runner. This suite is what makes the
// admission policy in presets.ts a gate rather than a comment, and what makes it
// impossible for the site's code format and the extension's parser to drift apart.
import assert from "node:assert/strict";
import test from "node:test";

import { detectPii } from "../../web/lib/shield.ts";
import { PRESETS, presetCode, type Preset } from "../../web/lib/presets.ts";
import { compileRules, lintRegex, MAX_LABEL, MAX_PATTERN, type CustomRule } from "../src/custom.ts";
import { parsePresetCode } from "../src/preset-import.ts";
import { RULE_TEMPLATES } from "../src/templates.ts";

function asRule(p: Preset): CustomRule {
  const parsed = parsePresetCode(presetCode(p));
  assert.ok(parsed.ok, `${p.id}: ${parsed.ok ? "" : parsed.error}`);
  return parsed.rule;
}

/** Matches for `text` using only this preset's rule — the guard's own compile path. */
function hits(p: Preset, text: string): number {
  const match = compileRules([asRule(p)]);
  return match ? match(text).length : 0;
}

test("every preset survives the save-time linter", () => {
  for (const p of PRESETS) {
    assert.equal(lintRegex(p.pattern), null, `${p.id}: ${lintRegex(p.pattern)}`);
  }
});

test("every preset respects the editor's limits and carries its display copy", () => {
  for (const p of PRESETS) {
    assert.ok(p.pattern.length <= MAX_PATTERN, `${p.id} pattern too long`);
    assert.ok(p.label.length <= MAX_LABEL, `${p.id} label too long`);
    assert.ok(p.name, `${p.id} has no name`);
    assert.ok(p.description, `${p.id} has no description`);
    assert.ok(p.example, `${p.id} has no example`);
  }
});

test("ids and patterns are unique across the library", () => {
  const ids = PRESETS.map((p) => p.id);
  const patterns = PRESETS.map((p) => p.pattern);
  assert.equal(new Set(ids).size, ids.length, "duplicate preset id");
  assert.equal(new Set(patterns).size, patterns.length, "two presets would add the same rule");
});

test("every preset matches its own example exactly once", () => {
  for (const p of PRESETS) {
    assert.equal(hits(p, `sent: ${p.example} — please rotate`), 1, `${p.id}: ${p.example}`);
  }
});

test("no preset duplicates a built-in detector (the example must not already be covered)", () => {
  // Admission rule 1. If the shield already detects the example, the preset would
  // double-tokenize the same span for no gain — it belongs in the shield, not here.
  for (const p of PRESETS) {
    assert.deepEqual(
      detectPii(p.example),
      [],
      `${p.id}: its example already trips a shipped detector`,
    );
  }
});

test("no preset duplicates a bundled template", () => {
  const templatePatterns = new Set(RULE_TEMPLATES.map((t) => t.rule.pattern.trim()));
  for (const p of PRESETS) {
    assert.equal(templatePatterns.has(p.pattern.trim()), false, `${p.id} repeats a template`);
  }
});

test("no preset fires on ordinary prose, dates, or reference numbers", () => {
  // Admission rule 2, the one the product's whole pitch rides on. The fixture folds in the
  // near-misses that killed earlier candidates: dates, order references, part numbers,
  // hex-ish ids, and an ordinary URL.
  const prose =
    "Thanks for the update — let's review the Q3 plan on Tuesday 2026-07-31 and close order " +
    "AB-1234567 before the 01-02-03 retro. The build hash was d4f9c2 and the invoice ran to " +
    "CHF 12,340.50; ping me at extension 4021 or via https://hooks.example.com/services/status " +
    "if part ACME-32 or the SG train from Padua is late again.";
  for (const p of PRESETS) {
    assert.equal(hits(p, prose), 0, `${p.id} matched ordinary prose`);
  }
});

test("the site's copy button and the extension's parser can never drift", () => {
  // presetCode() is what the Copy button serves; parsePresetCode() is what the options page
  // runs on paste. Round-tripping every preset pins the shared format from both ends.
  for (const p of PRESETS) {
    const parsed = parsePresetCode(presetCode(p));
    assert.ok(parsed.ok, `${p.id}: ${parsed.ok ? "" : parsed.error}`);
    assert.equal(parsed.name, p.name, `${p.id}: name must survive the round trip`);
    assert.equal(parsed.rule.pattern, p.pattern, `${p.id}: pattern must survive byte-identical`);
    assert.equal(parsed.rule.label, p.label);
    assert.equal(parsed.rule.isRegex, true);
    assert.equal(parsed.rule.presetId, p.id, "presetId is the update-in-place key");
    assert.equal(parsed.rule.caseSensitive, p.caseSensitive === true ? true : undefined);
  }
});

test("case-sensitivity is declared wherever the identifier's prefix is case-defined", () => {
  // Custom rules compile case-INsensitive by default; a lowercase 'ac…' or uppercase 'NPM_…'
  // matching would be exactly the prose-collision the admission policy forbids.
  for (const p of PRESETS) {
    assert.equal(p.caseSensitive, true, `${p.id} must opt into case sensitivity explicitly`);
  }
  const twilio = PRESETS.find((p) => p.id === "twilio-sid");
  assert.ok(twilio);
  assert.equal(hits(twilio, `ac${"a".repeat(32)}`), 0, "lowercase must not match");
});
