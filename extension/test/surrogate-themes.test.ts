// Tests for THEMED smokescreen pools. The pinned plain-pool behaviour stays in
// surrogate.test.ts untouched; this file pins what themes must never change:
//
//   - eligibility is theme-independent (the safety property cannot be re-skinned),
//   - every themed email is unroutable AND re-detectable by the shield's own detector,
//   - names are public-domain or invented — no franchise marks,
//   - the pool-integrity invariants hold across EVERY theme, not just plain,
//   - switching theme mid-session degrades gracefully: old stand-ins keep rehydrating,
//     only future mints change wardrobe.
import assert from "node:assert/strict";
import test from "node:test";

import { detectPii } from "../../web/lib/shield.ts";
import { Session } from "../src/tokenize.ts";
import {
  SURROGATE_POOLS,
  THEME_IDS,
  THEME_POOLS,
  isThemeId,
  mintSurrogate,
  surrogateEligible,
  themePreview,
  type ThemeId,
} from "../src/surrogate.ts";

const THEMED: readonly ThemeId[] = THEME_IDS.filter((t) => t !== "plain");
const EMAIL = "hans.muster@bluewin.ch";
const EMAIL2 = "erika.beispiel@gmx.ch";

function smoke(theme: ThemeId = "plain"): Session {
  const s = new Session();
  s.smokescreen = true;
  s.theme = theme;
  return s;
}

/** Every (theme, category, pool) triple, for invariants that must hold everywhere. */
function allPools(): Array<{ theme: ThemeId; category: string; pool: readonly string[] }> {
  return THEME_IDS.flatMap((theme) =>
    Object.entries(THEME_POOLS[theme]).map(([category, pool]) => ({ theme, category, pool })),
  );
}

// --- the safety property is theme-independent --------------------------------

test("every theme carries exactly the plain category set — a theme can never opt a category in", () => {
  const plainKeys = Object.keys(THEME_POOLS.plain).sort();
  for (const theme of THEME_IDS) {
    assert.deepEqual(
      Object.keys(THEME_POOLS[theme]).sort(),
      plainKeys,
      `${theme} must cover exactly the plain categories`,
    );
  }
});

test("surrogateEligible is unaffected by themes existing", () => {
  assert.ok(surrogateEligible("email"));
  assert.ok(surrogateEligible("custom"));
  for (const cat of ["ch_ahv", "iban", "credit_card", "ch_phone", "in_aadhaar", "openai_key", "jwt"]) {
    assert.equal(surrogateEligible(cat), false, `${cat} must stay ineligible in every theme`);
  }
});

test("SURROGATE_POOLS is still the plain pools (the pinned back-compat alias)", () => {
  assert.equal(SURROGATE_POOLS, THEME_POOLS.plain);
});

// --- unroutable and re-detectable ---------------------------------------------

test("every themed email uses only reserved, unroutable suffixes", () => {
  // RFC 2606 (example.com/org/net) or a label under the RFC 6761 `.example` TLD.
  const reserved = /@(?:example\.(?:com|org|net)|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.example)$/;
  for (const { theme, pool } of allPools().filter((p) => p.category === "email")) {
    for (const value of pool) {
      assert.match(value, reserved, `${theme}: ${value} must use a reserved suffix`);
    }
  }
});

test("every themed email is re-detected by the shield as exactly one whole-span email hit", () => {
  // Re-detectability is what drives the no-re-tokenize guard (ADR 0004): a stand-in that
  // the detector missed would be re-tokenized when it comes back through a prior turn.
  for (const { theme, pool } of allPools().filter((p) => p.category === "email")) {
    for (const value of pool) {
      const hits = detectPii(value);
      assert.equal(hits.length, 1, `${theme}: ${value} must yield exactly one hit`);
      assert.equal(hits[0].category, "email", `${theme}: ${value} must re-detect as email`);
      assert.equal(hits[0].start, 0, `${theme}: ${value} hit must start at 0`);
      assert.equal(hits[0].end, value.length, `${theme}: ${value} hit must span the string`);
    }
  }
});

test("no themed custom entry trips any built-in detector", () => {
  for (const { theme, pool } of allPools().filter((p) => p.category === "custom")) {
    for (const value of pool) {
      assert.deepEqual(detectPii(value), [], `${theme}: "${value}" must not look like PII`);
    }
  }
});

// --- public domain / no franchise marks ----------------------------------------

test("no pool value borrows a trademarked franchise name", () => {
  // Not exhaustive — the append-only review still applies — but it catches the obvious
  // reflexes (Tolkien, Star Wars/Trek, Doctor Who, DC/Marvel, Rowling, modern fantasy).
  const denylist =
    /gandalf|frodo|bilbo|hobbit|mordor|rivendell|tolkien|vader|skywalker|jedi|wookiee|tatooine|starfleet|klingon|romulan|tardis|dalek|gallifrey|cyberdyne|skynet|hogwarts|voldemort|gryffindor|gotham|wakanda|krypton|narnia|westeros|winterfell|dothraki/i;
  for (const { theme, category, pool } of allPools()) {
    for (const value of pool) {
      assert.doesNotMatch(value, denylist, `${theme}/${category}: "${value}" is a franchise mark`);
    }
  }
});

// --- deterministic minting, per theme -------------------------------------------

test("the 2-arg mint is byte-identical to the plain theme (back-compat)", () => {
  for (const category of Object.keys(THEME_POOLS.plain)) {
    const len = THEME_POOLS.plain[category].length;
    for (let n = 1; n <= len * 2 + 2; n++) {
      assert.equal(mintSurrogate(category, n), mintSurrogate(category, n, "plain"));
    }
  }
});

test("each theme mints from its own pool, deterministically", () => {
  for (const theme of THEME_IDS) {
    assert.equal(mintSurrogate("email", 1, theme), THEME_POOLS[theme].email[0]);
    assert.equal(mintSurrogate("email", 2, theme), THEME_POOLS[theme].email[1]);
    assert.equal(mintSurrogate("email", 1, theme), mintSurrogate("email", 1, theme));
    assert.equal(mintSurrogate("ch_ahv", 1, theme), null, "no pool → null in every theme");
  }
});

test("past the pool, the suffix preserves the reserved domain in every theme", () => {
  const reserved = /@(?:example\.(?:com|org|net)|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.example)$/;
  for (const theme of THEME_IDS) {
    const pool = THEME_POOLS[theme].email;
    const wrapped = mintSurrogate("email", pool.length + 1, theme) ?? "";
    assert.match(wrapped, /^[^@]+2@/, `${theme}: the round suffix goes on the local part`);
    assert.match(wrapped, reserved, `${theme}: the domain must survive the suffix intact`);
  }
});

// --- pool integrity across every theme --------------------------------------------

test("no value is duplicated anywhere — within a pool, across pools, or across themes", () => {
  // Global on purpose: sessions share ordinal counters across themes, and rehydration is
  // string-keyed — one string standing for two different real values is the failure mode.
  const all = allPools().flatMap(({ pool }) => [...pool]);
  assert.equal(new Set(all).size, all.length);
});

test("no email local part is a prefix of another within its pool", () => {
  for (const { theme, pool } of allPools().filter((p) => p.category === "email")) {
    const locals = pool.map((e) => e.slice(0, e.indexOf("@")));
    for (const a of locals) {
      for (const b of locals) {
        if (a !== b) assert.equal(b.startsWith(a), false, `${theme}: ${b} starts with ${a}`);
      }
    }
  }
});

test("no custom entry is a prefix of another within its pool", () => {
  // Same fencing hazard as email local parts: "Project Grail" inside "Project Grail Quest"
  // would make word-boundary rehydration ambiguous between two bases.
  for (const { theme, pool } of allPools().filter((p) => p.category === "custom")) {
    for (const a of pool) {
      for (const b of pool) {
        if (a !== b) assert.equal(b.startsWith(a), false, `${theme}: "${b}" starts with "${a}"`);
      }
    }
  }
});

test("no stem ends with a digit and no suffixed mint collides with a base, in any theme", () => {
  const bases = new Set(allPools().flatMap(({ pool }) => [...pool]));
  for (const { theme, category, pool } of allPools()) {
    for (const base of pool) {
      const at = base.indexOf("@");
      const stem = at === -1 ? base : base.slice(0, at);
      assert.equal(/\d$/.test(stem), false, `${theme}/${category}: "${base}" ends with a digit`);
    }
    for (let n = pool.length + 1; n <= pool.length * 3; n++) {
      const v = mintSurrogate(category, n, theme);
      assert.ok(v);
      assert.equal(bases.has(v), false, `${theme}/${category}: ordinal ${n} minted a base`);
    }
  }
});

test("every themed pool is big enough to be worth having, and mints no bracket lookalike", () => {
  for (const { theme, category, pool } of allPools()) {
    assert.ok(pool.length >= 8, `${theme}/${category} has only ${pool.length} entries`);
    for (let n = 1; n <= pool.length + 2; n++) {
      assert.doesNotMatch(mintSurrogate(category, n, theme) ?? "", /\[[A-Z0-9_]+_\d+\]/);
    }
  }
});

// --- helpers -------------------------------------------------------------------------

test("isThemeId accepts exactly the theme ids", () => {
  for (const theme of THEME_IDS) assert.ok(isThemeId(theme));
  for (const junk of ["", "PLAIN", "tolkien", 7, null, undefined, {}]) {
    assert.equal(isThemeId(junk), false, `${String(junk)} must not be a theme`);
  }
});

test("themePreview serves the head of each pool, so the options hint can never drift", () => {
  for (const theme of THEME_IDS) {
    assert.deepEqual(themePreview(theme), {
      email: THEME_POOLS[theme].email[0],
      custom: THEME_POOLS[theme].custom[0],
    });
  }
});

// --- Session behaviour: switching mid-conversation ------------------------------------

test("a themed session mints from its theme's pool", () => {
  const s = smoke("fantasy");
  const out = s.tokenize(`write to ${EMAIL}`);
  assert.equal(out, `write to ${THEME_POOLS.fantasy.email[0]}`);
  assert.ok(!out.includes(EMAIL));
});

test("switching theme mid-session: old stand-ins keep rehydrating, new mints change wardrobe", () => {
  const s = smoke("plain");
  const plainStandIn = THEME_POOLS.plain.email[0];
  assert.equal(s.tokenize(EMAIL), plainStandIn);

  s.theme = "scifi";
  // Ordinals are shared across themes and never rewound: the second distinct address is
  // ordinal 2, so it draws the sci-fi pool's SECOND entry. Skipping scifi[0] is fine — what
  // matters is that no ordinal (and no string) is ever reused.
  assert.equal(s.tokenize(EMAIL2), THEME_POOLS.scifi.email[1]);

  assert.equal(s.rehydrate(plainStandIn), EMAIL, "the pre-switch stand-in still restores");
  assert.equal(s.rehydrate(THEME_POOLS.scifi.email[1]), EMAIL2);
  assert.equal(s.count, 2);
});

test("an old-theme stand-in echoed back after a switch is not re-tokenized", () => {
  const s = smoke("shakespeare");
  const standIn = THEME_POOLS.shakespeare.email[0];
  s.tokenize(EMAIL);
  s.theme = "plain";
  const echoed = s.tokenize(`you said ${standIn}`);
  assert.equal(echoed, `you said ${standIn}`, "must pass through byte-identical");
  assert.equal(s.count, 1, "no second mapping may be minted");
});

test("recycling after a theme switch mints from the NEW theme while the old stand-in stays restorable", () => {
  const s = smoke("plain");
  const before = THEME_POOLS.plain.email[0];
  assert.equal(s.tokenize(EMAIL), before);

  s.theme = "fantasy";
  const after = s.recycleSurrogate(EMAIL);
  assert.ok(after, "recycle must succeed");
  assert.ok(
    (THEME_POOLS.fantasy.email as readonly string[]).includes(after),
    `${after} should come from the fantasy pool`,
  );
  // Retire-don't-delete: text already painted with the old stand-in must keep restoring.
  assert.equal(s.rehydrate(`re ${before}`), `re ${EMAIL}`);
  assert.equal(s.rehydrate(`re ${after}`), `re ${EMAIL}`);
});
