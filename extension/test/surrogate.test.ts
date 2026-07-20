// Tests for smokescreen mode — the realistic stand-ins that replace [EMAIL_1] placeholders
// when the user opts in. Two classes of test here, and the second class is the important one:
//
//   1. the pure minting rules in surrogate.ts (pools, determinism, exhaustion), and
//   2. the Session behaviours that only exist BECAUSE a surrogate looks like real data —
//      it is re-detectable by the shield, it carries no "[" marker for the DOM rehydrator to
//      key on, and a model may re-case it. Each of those was a bug found in review.
import assert from "node:assert/strict";
import test from "node:test";

import { Session } from "../src/tokenize.ts";
import { MAX_SURROGATES, SURROGATE_POOLS, mintSurrogate, surrogateEligible } from "../src/surrogate.ts";

const AHV = "756.1234.5678.97";
const IBAN = "CH9300762011623852957";
const EMAIL = "hans.muster@bluewin.ch";
const EMAIL2 = "erika.beispiel@gmx.ch";

function smoke(): Session {
  const s = new Session();
  s.smokescreen = true;
  return s;
}

// --- surrogate.ts: minting rules -------------------------------------------

test("only categories with a vendored pool are eligible", () => {
  assert.ok(surrogateEligible("email"));
  assert.ok(surrogateEligible("custom"));
  // The safety property: no checksum identifier and no secret may ever take a stand-in,
  // because a checksum-VALID fake could be a real person's actual number.
  for (const cat of ["ch_ahv", "iban", "credit_card", "ch_phone", "in_aadhaar", "openai_key", "jwt"]) {
    assert.equal(surrogateEligible(cat), false, `${cat} must not be surrogate-eligible`);
  }
});

test("minting is deterministic and pool-ordered", () => {
  assert.equal(mintSurrogate("email", 1), SURROGATE_POOLS.email[0]);
  assert.equal(mintSurrogate("email", 1), SURROGATE_POOLS.email[0]); // same input, same output
  assert.equal(mintSurrogate("email", 2), SURROGATE_POOLS.email[1]);
  assert.equal(mintSurrogate("ch_ahv", 1), null); // no pool → caller falls back to a token
});

test("emails use only RFC 2606 reserved domains, so they can never route mail", () => {
  for (const value of SURROGATE_POOLS.email) {
    assert.match(value, /@example\.(org|com|net)$/, `${value} must use a reserved domain`);
  }
});

test("past the pool, ordinals fold in as a suffix and stay unique", () => {
  const pool = SURROGATE_POOLS.email;
  const seen = new Set<string>();
  for (let n = 1; n <= pool.length * 3; n++) {
    const v = mintSurrogate("email", n);
    assert.ok(v, `ordinal ${n} should mint`);
    assert.equal(seen.has(v), false, `${v} collided at ordinal ${n}`);
    seen.add(v);
  }
  // The suffix goes on the local part so the reserved domain survives intact.
  assert.match(mintSurrogate("email", pool.length + 1) ?? "", /^[^@]+2@example\.(org|com|net)$/);
  // A pool value with no "@" just gets the suffix appended.
  const custom = SURROGATE_POOLS.custom;
  assert.equal(mintSurrogate("custom", custom.length + 1), `${custom[0]}2`);
});

test("no minted surrogate can be mistaken for a bracket token", () => {
  // Pass 1 of rehydrate() runs the bracket regex over the whole string; if a surrogate ever
  // matched it, pass 1 would mangle the value before pass 2 saw it.
  for (const [category, pool] of Object.entries(SURROGATE_POOLS)) {
    for (let n = 1; n <= pool.length + 2; n++) {
      assert.doesNotMatch(mintSurrogate(category, n) ?? "", /\[[A-Z0-9_]+_\d+\]/);
    }
  }
});

// --- Session: mode off is bit-identical ------------------------------------

test("smokescreen off → behaviour is byte-identical to bracket tokens", () => {
  const s = new Session();
  assert.equal(s.tokenize(`mail ${EMAIL}`), "mail [EMAIL_1]");
  assert.equal(s.rehydrate("re [EMAIL_1]"), `re ${EMAIL}`);
  assert.equal(s.mayNeedRehydration("nothing here"), false);
});

// --- Session: minting ------------------------------------------------------

test("smokescreen on → an email is replaced by a stand-in, not a bracket token", () => {
  const s = smoke();
  const out = s.tokenize(`write to ${EMAIL}`);
  assert.equal(out, `write to ${SURROGATE_POOLS.email[0]}`);
  assert.ok(!out.includes(EMAIL), "the real address must not survive");
  assert.equal(s.count, 1);
});

test("ineligible categories stay on bracket tokens even with the mode on", () => {
  const s = smoke();
  const out = s.tokenize(`AHV ${AHV} IBAN ${IBAN} mail ${EMAIL}`);
  assert.ok(out.includes("[AHV_1]"), "AHV must stay bracketed");
  assert.ok(out.includes("[IBAN_1]"), "IBAN must stay bracketed");
  assert.ok(out.includes(SURROGATE_POOLS.email[0]), "email should get a stand-in");
});

test("distinct values get distinct stand-ins; a repeat reuses its own", () => {
  const s = smoke();
  const out = s.tokenize(`${EMAIL} and ${EMAIL2} and ${EMAIL} again`);
  assert.ok(out.includes(SURROGATE_POOLS.email[0]));
  assert.ok(out.includes(SURROGATE_POOLS.email[1]));
  assert.equal(s.count, 2, "the repeated address must not mint a third mapping");
});

test("a value already mapped keeps its placeholder when the mode is toggled mid-conversation", () => {
  const s = new Session();
  assert.equal(s.tokenize(EMAIL), "[EMAIL_1]"); // seen while off
  s.smokescreen = true;
  assert.equal(s.tokenize(EMAIL), "[EMAIL_1]", "must not be remapped");
  // The per-category counter is shared by both placeholder styles, so the second distinct
  // address is ordinal 2 and draws pool[1]. Skipping pool[0] is fine — all that matters is
  // that ordinals stay unique, which is what keeps stand-ins collision-free.
  assert.equal(s.tokenize(EMAIL2), SURROGATE_POOLS.email[1], "new values do get stand-ins");
  assert.equal(s.rehydrate("[EMAIL_1]"), EMAIL, "the earlier token still restores");
  assert.equal(s.rehydrate(SURROGATE_POOLS.email[1]), EMAIL2, "and so does the stand-in");
});

// --- Session: the hazards that only exist for surrogates --------------------

test("a stand-in echoed back is NOT re-tokenized (the double-mapping hazard)", () => {
  // Gemini's f.req carries prior turns, and users paste model output back into the composer.
  // A stand-in IS a valid email, so without the guard it would be detected as a fresh value
  // and mapped to a SECOND stand-in — corrupting the thread and breaking rehydration.
  const s = smoke();
  const first = s.tokenize(`contact ${EMAIL}`);
  const surrogate = SURROGATE_POOLS.email[0];
  assert.equal(first, `contact ${surrogate}`);

  const echoed = s.tokenize(`you said ${surrogate}`);
  assert.equal(echoed, `you said ${surrogate}`, "the stand-in must pass through untouched");
  assert.equal(s.count, 1, "no second mapping may be minted");
  assert.equal(s.rehydrate(`you said ${surrogate}`), `you said ${EMAIL}`);
});

test("a stand-in round-trips through rehydrate and is idempotent", () => {
  const s = smoke();
  s.tokenize(EMAIL);
  const restored = s.rehydrate(`reply to ${SURROGATE_POOLS.email[0]} today`);
  assert.equal(restored, `reply to ${EMAIL} today`);
  assert.equal(s.rehydrate(restored), restored, "second pass is a no-op");
});

test("a re-cased stand-in still restores, and the prefilter agrees", () => {
  // Models routinely re-case text. The prefilter and the alternation must agree on case, or
  // the prefilter rejects the value before the regex that exists to catch it ever runs.
  const s = smoke();
  s.tokenize(EMAIL);
  const shouted = SURROGATE_POOLS.email[0].toUpperCase();
  assert.equal(s.mayNeedRehydration(`SEE ${shouted}`), true, "prefilter must pass a re-cased value");
  assert.equal(s.rehydrate(`SEE ${shouted}`), `SEE ${EMAIL}`);
});

/** A matcher that flags each of `terms` wherever it appears — stands in for a user's
 *  custom blocklist without pulling in the real rule compiler. */
function termMatcher(...terms: string[]) {
  return (text: string) => {
    const hits: Array<{ start: number; end: number }> = [];
    for (const term of terms) {
      let i = text.indexOf(term);
      while (i !== -1) {
        hits.push({ start: i, end: i + term.length });
        i = text.indexOf(term, i + term.length);
      }
    }
    return hits;
  };
}

test("stand-ins are word-boundary fenced", () => {
  const s = smoke();
  s.customMatcher = termMatcher("Acme");
  const surrogate = SURROGATE_POOLS.custom[0];
  assert.equal(s.tokenize("Acme is our client"), `${surrogate} is our client`);
  // The stand-in must not rewrite the middle of a longer word during rehydration.
  const glued = `${surrogate}Logistics`;
  assert.equal(s.rehydrate(glued), glued, "must not restore inside a longer identifier");
  assert.equal(s.rehydrate(`${surrogate}.`), "Acme.", "trailing punctuation still restores");
});

test("a stand-in that is a strict prefix of another restores correctly", () => {
  // Pool exhaustion is what actually produces prefix pairs: past the end of the pool the
  // ordinal is appended, so "Project Northwind" and "Project Northwind2" coexist. Fencing
  // plus longest-first alternation must keep them apart in both directions.
  const s = smoke();
  const pool = SURROGATE_POOLS.custom;
  const terms = Array.from({ length: pool.length + 1 }, (_, i) => `Term${i}`);
  s.customMatcher = termMatcher(...terms);
  const out = s.tokenize(terms.join(" "));

  for (const term of terms) {
    assert.ok(!out.split(/\s+/).includes(term), `${term} must have been replaced`);
  }
  const wrapped = mintSurrogate("custom", pool.length + 1) ?? "";
  assert.equal(wrapped, `${pool[0]}2`, "precondition: the overflow value extends pool[0]");
  assert.ok(out.includes(wrapped), "the wrapped stand-in should be present");
  assert.equal(s.rehydrate(out), terms.join(" "), "every stand-in restores to its own term");
});

// --- Session: the DOM hot-path prefilter -----------------------------------

test("mayNeedRehydration is true for stand-in text that contains no bracket", () => {
  // interceptor.ts used to short-circuit on !text.includes("["), which made every stand-in
  // fail to rehydrate on screen while looking perfectly correct on the wire.
  const s = smoke();
  s.tokenize(EMAIL);
  const painted = `we emailed ${SURROGATE_POOLS.email[0]}`;
  assert.equal(painted.includes("["), false, "precondition: no bracket marker");
  assert.equal(s.mayNeedRehydration(painted), true);
});

test("mayNeedRehydration is text-specific, not session-global", () => {
  // If it merely asked "does this session have any surrogates?", every streamed text node on
  // the page would run the full alternation regex — deleting the fast path exactly during a
  // long reply, which is when it matters most.
  const s = smoke();
  s.tokenize(EMAIL);
  assert.equal(s.mayNeedRehydration("an unrelated sentence"), false);
  assert.equal(s.mayNeedRehydration(SURROGATE_POOLS.email[0]), true);
});

test("a stand-in the user's own blocklist would match is never minted", () => {
  // tokenize() skips anything already in tokenValue, so if a pool value happened to equal one
  // of the user's rules, their real mention of it would later pass through unredacted.
  const s = smoke();
  const collides = SURROGATE_POOLS.custom[0];
  s.customMatcher = termMatcher("Contoso", collides);

  const out = s.tokenize("Contoso is the client");
  assert.ok(!out.includes(collides), "the colliding pool value must be refused");
  assert.match(out, /^\[CUSTOM_\d+\] is the client$/, "it degrades to a bracket token");

  // And the user's real term is still redacted when it turns up.
  const later = s.tokenize(`we also work with ${collides}`);
  assert.ok(!later.includes(collides), "the user's own term must not leak");
});

// --- Session: caps ---------------------------------------------------------

test("past MAX_SURROGATES new values fall back to bracket tokens and still rehydrate", () => {
  const s = smoke();
  for (let i = 0; i < MAX_SURROGATES; i++) s.tokenize(`user${i}@example-corp.test`);
  assert.equal(s.count, MAX_SURROGATES);

  const overflow = "one.too.many@example-corp.test";
  const out = s.tokenize(overflow);
  assert.match(out, /^\[EMAIL_\d+\]$/, "beyond the cap we degrade to a bracket token");
  assert.equal(s.rehydrate(out), overflow, "and it still restores");
});
