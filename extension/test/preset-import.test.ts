// Tests for the preset-code parser — the paste boundary between shield.ars.md and the
// rule list. The input is untrusted clipboard text, so the interesting cases are the
// refusals: every malformed shape must produce a readable error and NOTHING else (no
// throw, no partial rule, no unknown key surviving into the output).
import assert from "node:assert/strict";
import test from "node:test";

import { MAX_LABEL, MAX_PATTERN } from "../src/custom.ts";
import { MAX_CODE, parsePresetCode } from "../src/preset-import.ts";

const CODE =
  '{"v":1,"id":"twilio-sid","name":"Twilio Account SID","rule":{"pattern":"\\\\bAC[0-9a-fA-F]{32}\\\\b","isRegex":true,"label":"Twilio SID","caseSensitive":true,"presetId":"twilio-sid"}}';

test("a valid code round-trips into exactly the whitelisted CustomRule", () => {
  const r = parsePresetCode(CODE);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(r.rule, {
    pattern: "\\bAC[0-9a-fA-F]{32}\\b",
    isRegex: true,
    label: "Twilio SID",
    caseSensitive: true,
    presetId: "twilio-sid",
  });
  assert.equal(r.name, "Twilio Account SID");
});

test("surrounding whitespace is tolerated (it's a paste)", () => {
  assert.ok(parsePresetCode(`  \n${CODE}\n  `).ok);
});

test("a literal (non-regex) rule is accepted — the format is not regex-only", () => {
  const r = parsePresetCode('{"v":1,"rule":{"pattern":"Project Apollo","isRegex":false,"wholeWord":false}}');
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(r.rule, { pattern: "Project Apollo", isRegex: false, wholeWord: false });
});

test("optional fields are optional, and absent means absent — not defaulted junk", () => {
  const r = parsePresetCode('{"v":1,"rule":{"pattern":"x-secret-header","isRegex":false}}');
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(Object.keys(r.rule).sort(), ["isRegex", "pattern"]);
});

test("non-JSON, non-object and array pastes are refused, never thrown on", () => {
  for (const junk of ["", "   ", "hello", "{", "[1,2]", '"string"', "42", "null", "true"]) {
    const r = parsePresetCode(junk);
    assert.equal(r.ok, false, `should refuse: ${junk}`);
  }
});

test("an oversized paste is refused before it is ever parsed", () => {
  const r = parsePresetCode(`{"v":1,${'"x":"y",'.repeat(MAX_CODE)}}`);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /too long/i);
});

test("a missing or wrong version is refused; a FUTURE version says 'update', not 'garbage'", () => {
  for (const code of ['{"rule":{}}', '{"v":0,"rule":{}}', '{"v":"1","rule":{}}']) {
    const r = parsePresetCode(code);
    assert.equal(r.ok, false, code);
    if (!r.ok) assert.doesNotMatch(r.error, /newer version/i);
  }
  const future = parsePresetCode('{"v":2,"rule":{"pattern":"x","isRegex":false}}');
  assert.equal(future.ok, false);
  if (!future.ok) assert.match(future.error, /newer version/i);
});

test("shape violations in the rule are refused one by one", () => {
  const bad = [
    '{"v":1}', // no rule
    '{"v":1,"rule":[]}', // rule is an array
    '{"v":1,"rule":{"isRegex":true}}', // no pattern
    '{"v":1,"rule":{"pattern":"","isRegex":true}}', // empty pattern
    '{"v":1,"rule":{"pattern":"   ","isRegex":true}}', // whitespace pattern
    '{"v":1,"rule":{"pattern":"x"}}', // isRegex missing
    '{"v":1,"rule":{"pattern":"x","isRegex":"true"}}', // isRegex not boolean
    '{"v":1,"rule":{"pattern":"x","isRegex":false,"label":7}}', // label not a string
    '{"v":1,"rule":{"pattern":"x","isRegex":false,"caseSensitive":"yes"}}',
    '{"v":1,"rule":{"pattern":"x","isRegex":false,"wholeWord":1}}',
    '{"v":1,"rule":{"pattern":"x","isRegex":false,"presetId":"NOT VALID"}}', // slug rule
    '{"v":1,"rule":{"pattern":"x","isRegex":false,"presetId":""}}',
  ];
  for (const code of bad) {
    assert.equal(parsePresetCode(code).ok, false, `should refuse: ${code}`);
  }
});

test("field length caps match the editor's own", () => {
  const longPattern = JSON.stringify({
    v: 1,
    rule: { pattern: "a".repeat(MAX_PATTERN + 1), isRegex: false },
  });
  const longLabel = JSON.stringify({
    v: 1,
    rule: { pattern: "ok", isRegex: false, label: "l".repeat(MAX_LABEL + 1) },
  });
  assert.equal(parsePresetCode(longPattern).ok, false);
  assert.equal(parsePresetCode(longLabel).ok, false);
});

test("a catastrophic regex is refused with the linter's own message", () => {
  const r = parsePresetCode('{"v":1,"rule":{"pattern":"(a+)+$","isRegex":true}}');
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.error.length > 0, "the lint message must surface");
  // The identical pattern as a LITERAL is fine — literals are escaped at compile time and
  // can never backtrack, so the gate applies exactly where the risk is.
  assert.ok(parsePresetCode('{"v":1,"rule":{"pattern":"(a+)+$","isRegex":false}}').ok);
});

test("unknown and __proto__-shaped keys never survive into the returned rule", () => {
  const r = parsePresetCode(
    '{"v":1,"evil":true,"rule":{"pattern":"x","isRegex":false,"surprise":"y","__proto__":{"polluted":true},"constructor":"z"}}',
  );
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(Object.keys(r.rule).sort(), ["isRegex", "pattern"]);
  assert.equal(Object.getPrototypeOf(r.rule), Object.prototype, "prototype must be untouched");
  assert.equal(({} as Record<string, unknown>).polluted, undefined, "no global pollution");
});

test("the display name is optional, trimmed, and bounded", () => {
  const unnamed = parsePresetCode('{"v":1,"rule":{"pattern":"x","isRegex":false}}');
  assert.ok(unnamed.ok);
  assert.equal(unnamed.ok ? unnamed.name : "?", undefined);
  const longName = JSON.stringify({
    v: 1,
    name: "n".repeat(101),
    rule: { pattern: "x", isRegex: false },
  });
  const r = parsePresetCode(longName);
  assert.ok(r.ok, "an over-long name degrades to no name, it does not refuse the rule");
  assert.equal(r.ok ? r.name : "?", undefined);
});
