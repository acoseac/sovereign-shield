// Tests for the extension's stateful tokenizer. The shared detector is already gated
// by the Python↔TS parity vectors; Session (the value↔token map, restore, dedup) is
// extension-specific and otherwise untested.
import assert from "node:assert/strict";
import test from "node:test";

import { MAX_MAPPINGS, Session } from "../src/tokenize.ts";
import { SURROGATE_POOLS } from "../src/surrogate.ts";

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

// --- preview(): what the inspector panel promises must be what the guard does ---
// A preview that lies is worse than no preview, so these pin BOTH halves: it must not mutate
// the session, and it must predict the exact placeholders a later tokenize() produces.

test("preview redacts without mutating the session", () => {
  const s = new Session();
  let mints = 0;
  s.onMint = () => mints++;
  const p = s.preview(`AHV ${AHV} and ${EMAIL}`);
  assert.equal(p.text, "AHV [AHV_1] and [EMAIL_1]");
  assert.equal(s.count, 0, "no mapping stored");
  assert.equal(mints, 0, "onMint never fires for a preview");
  // Nothing was committed, so previewing twice gives the same answer rather than _2.
  assert.equal(s.preview(`AHV ${AHV}`).text, "AHV [AHV_1]");
});

test("preview predicts the placeholders the next tokenize actually mints", () => {
  const s = new Session();
  const text = `AHV ${AHV}, mail ${EMAIL}`;
  const predicted = s.preview(text);
  assert.equal(s.tokenize(text), predicted.text);
});

test("preview continues the live counters rather than restarting at _1", () => {
  // The bug this rules out: a throwaway Session in the isolated world would say [EMAIL_1]
  // while the model receives [EMAIL_2].
  const s = new Session();
  s.tokenize(`first ${EMAIL}`);
  const p = s.preview("second erika.beispiel@gmx.ch");
  assert.equal(p.text, "second [EMAIL_2]");
});

test("preview reuses the placeholder a value already has", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  assert.equal(s.preview(`again ${AHV}`).text, "again [AHV_1]");
});

test("preview spans point into the ORIGINAL text, ascending", () => {
  const s = new Session();
  const text = `AHV ${AHV} and mail ${EMAIL}`;
  const { spans } = s.preview(text);
  assert.equal(spans.length, 2);
  assert.deepEqual(
    spans.map((sp) => text.slice(sp.start, sp.end)),
    [AHV, EMAIL],
  );
  assert.deepEqual(
    spans.map((sp) => sp.category),
    ["ch_ahv", "email"],
  );
  assert.ok(spans[0].start < spans[1].start, "ascending");
});

test("preview predicts stand-ins, and predicts the same ones tokenize mints", () => {
  const s = new Session();
  s.smokescreen = true;
  const text = `mail ${EMAIL} and erika.beispiel@gmx.ch`;
  const predicted = s.preview(text);
  assert.ok(!predicted.text.includes("[EMAIL_"), "smokescreen previews stand-ins, not brackets");
  assert.equal(s.tokenize(text), predicted.text);
});

test("preview does not hand two values the same stand-in", () => {
  const s = new Session();
  s.smokescreen = true;
  const { spans } = s.preview(`${EMAIL} and erika.beispiel@gmx.ch`);
  assert.equal(new Set(spans.map((sp) => sp.placeholder)).size, 2);
});

test("preview of clean text is the input, with no spans", () => {
  const s = new Session();
  const p = s.preview("nothing sensitive here");
  assert.equal(p.text, "nothing sensitive here");
  assert.deepEqual(p.spans, []);
});

// --- entries(), forget(), allow(), clear() -------------------------------

test("entries exposes each live mapping with its category, in mint order", () => {
  // Mint order, not text order: tokenize splices back-to-front so earlier offsets stay valid,
  // so within one message the LAST identifier is minted first.
  const s = new Session();
  s.tokenize(`AHV ${AHV} mail ${EMAIL}`);
  assert.deepEqual(s.entries(), [
    { value: EMAIL, placeholder: "[EMAIL_1]", category: "email", surrogate: false },
    { value: AHV, placeholder: "[AHV_1]", category: "ch_ahv", surrogate: false },
  ]);
});

test("entries flags a stand-in as a surrogate", () => {
  const s = new Session();
  s.smokescreen = true;
  s.tokenize(EMAIL);
  const [entry] = s.entries();
  assert.equal(entry.surrogate, true);
  assert.equal(entry.value, EMAIL);
  assert.ok(!entry.placeholder.startsWith("["));
});

test("forget drops the mapping and stops restoring it", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  assert.equal(s.forget(AHV), true);
  assert.equal(s.count, 0);
  assert.equal(s.rehydrate("[AHV_1]"), "[AHV_1]", "nothing left to restore it to");
  assert.equal(s.forget(AHV), false, "forgetting twice is a no-op");
});

test("forget does not rewind counters — a re-typed value gets a FRESH token", () => {
  // Recycling [AHV_1] would make the DOM rehydrator restore the NEW value into an OLD message
  // still showing that token.
  const s = new Session();
  s.tokenize(AHV);
  s.forget(AHV);
  assert.equal(s.tokenize(AHV), "[AHV_2]");
});

test("allow excuses a value from future detection, for this session only", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  s.allow(AHV);
  assert.equal(s.tokenize(`AHV ${AHV}`), `AHV ${AHV}`, "no longer redacted");
  assert.equal(s.count, 0);
  // A different identifier is unaffected.
  assert.equal(s.tokenize(EMAIL), "[EMAIL_1]");
});

test("allow does not excuse other values of the same category", () => {
  const s = new Session();
  s.allow(EMAIL);
  assert.equal(s.tokenize(`${EMAIL} and erika.beispiel@gmx.ch`), `${EMAIL} and [EMAIL_1]`);
});

test("clear drops every mapping but keeps counters monotonic", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV} mail ${EMAIL}`);
  s.clear();
  assert.equal(s.count, 0);
  assert.deepEqual(s.entries(), []);
  assert.equal(s.rehydrate("[AHV_1]"), "[AHV_1]");
  assert.equal(s.tokenize(AHV), "[AHV_2]", "counters survive, so old painted tokens stay unique");
});

test("clear resets smokescreen state so the alternation is rebuilt from scratch", () => {
  const s = new Session();
  s.smokescreen = true;
  const stand = s.tokenize(EMAIL);
  s.clear();
  assert.equal(s.mayNeedRehydration(stand), false);
  assert.equal(s.rehydrate(stand), stand);
});

// --- recycleSurrogate(): the vetted-pool escape hatch --------------------

test("recycle swaps to a different pool stand-in for future sends", () => {
  const s = new Session();
  s.smokescreen = true;
  const first = s.tokenize(EMAIL);
  const second = s.recycleSurrogate(EMAIL);
  assert.ok(second && second !== first);
  assert.ok(SURROGATE_POOLS.email.includes(second), "must come from the vetted pool");
  assert.equal(s.tokenize(`mail ${EMAIL}`), `mail ${second}`, "future sends use the new one");
});

test("recycle RETIRES the old stand-in rather than deleting it", () => {
  // Turns already on screen still carry the old one; they must keep restoring.
  const s = new Session();
  s.smokescreen = true;
  const first = s.tokenize(EMAIL);
  const second = s.recycleSurrogate(EMAIL);
  assert.equal(s.rehydrate(`old ${first} new ${second}`), `old ${EMAIL} new ${EMAIL}`);
  assert.equal(s.count, 1, "still one identifier kept local, not two");
});

test("recycle refuses a bracket token — there is nothing to cycle", () => {
  const s = new Session();
  s.smokescreen = true;
  s.tokenize(AHV); // checksum category: always a bracket token, even with the mode on
  assert.equal(s.recycleSurrogate(AHV), null);
  assert.equal(s.entries()[0].placeholder, "[AHV_1]");
});

test("recycle refuses an unmapped value", () => {
  assert.equal(new Session().recycleSurrogate("nobody@example.com"), null);
});

test("recycle never mints a stand-in the user's own blocklist would match", () => {
  const s = new Session();
  s.smokescreen = true;
  const first = s.tokenize(EMAIL);
  // Block the whole reserved-domain space, so no candidate is ever safe — including the
  // suffixed variants (alice.morgan2@…) the pool folds back to once its first round is spent.
  s.customMatcher = (text: string) => {
    const at = text.indexOf("@example.");
    return at === -1 ? [] : [{ start: at, end: at + "@example.".length }];
  };
  assert.equal(s.recycleSurrogate(EMAIL), null);
  assert.equal(s.entries()[0].placeholder, first, "left exactly as it was");
});

// --- MAX_MAPPINGS: bounded growth, and what it costs ---------------------

test("mappings are capped, evicting the oldest first", () => {
  const s = new Session();
  const values: string[] = [];
  for (let i = 0; i < MAX_MAPPINGS + 5; i++) {
    const email = `user${i}@example.invalid`;
    values.push(email);
    s.tokenize(email);
  }
  assert.equal(s.count, MAX_MAPPINGS);
  const held = new Set(s.entries().map((e) => e.value));
  assert.ok(!held.has(values[0]), "the oldest value was evicted");
  assert.ok(held.has(values.at(-1)), "the newest is still held");
});

test("an evicted placeholder no longer restores — the documented tradeoff", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  for (let i = 0; i < MAX_MAPPINGS; i++) s.tokenize(`user${i}@example.invalid`);
  assert.equal(s.rehydrate("[AHV_1]"), "[AHV_1]");
});

test("eviction keeps the surrogate structures in step", () => {
  const s = new Session();
  s.smokescreen = true;
  const stand = s.tokenize(EMAIL);
  s.forget(EMAIL); // same path eviction takes
  assert.equal(s.mayNeedRehydration(stand), false, "prefilter needle removed");
  assert.equal(s.rehydrate(stand), stand, "alternation rebuilt without it");
  // And the slot is free again, so a later value can take a stand-in.
  assert.ok(!s.tokenize("erika.beispiel@gmx.ch").startsWith("["));
});

test("forgetting a recycled value drops its retired stand-in too", () => {
  // The gated reverse scan: a recycled value is the only kind that maps from more than one
  // placeholder, and leaving the retired one behind would restore a value we no longer hold.
  const s = new Session();
  s.smokescreen = true;
  const first = s.tokenize(EMAIL);
  const second = s.recycleSurrogate(EMAIL);
  assert.ok(second);
  s.forget(EMAIL);
  assert.equal(s.rehydrate(`${first} / ${second}`), `${first} / ${second}`);
  assert.equal(s.mayNeedRehydration(first), false);
});

test("recycle with smokescreen off burns no ordinals", () => {
  // Every attempt is guaranteed to fail with the mode off, and each one used to bump the
  // counter — so clicking the button permanently inflated the next real value's token.
  const s = new Session();
  s.smokescreen = true;
  s.tokenize(EMAIL);
  s.smokescreen = false;
  assert.equal(s.recycleSurrogate(EMAIL), null);
  assert.equal(s.recycleSurrogate(EMAIL), null);
  assert.equal(s.tokenize("erika.beispiel@gmx.ch"), "[EMAIL_2]");
});

test("recycle twice keeps BOTH earlier stand-ins restorable", () => {
  const s = new Session();
  s.smokescreen = true;
  const first = s.tokenize(EMAIL);
  const second = s.recycleSurrogate(EMAIL);
  const third = s.recycleSurrogate(EMAIL);
  assert.ok(second && third && new Set([first, second, third]).size === 3);
  assert.equal(
    s.rehydrate(`${first} ${second} ${third}`),
    `${EMAIL} ${EMAIL} ${EMAIL}`,
  );
  assert.equal(s.count, 1);
  // And forgetting the value drops every one of them.
  s.forget(EMAIL);
  assert.equal(s.rehydrate(`${first} ${second} ${third}`), `${first} ${second} ${third}`);
});
