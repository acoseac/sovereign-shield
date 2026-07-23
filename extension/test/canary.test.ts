// Tests for the send canary — the check that turns a silently-moved generate endpoint into a
// visible warning. The DOM shell lives in indicator.ts; every decision it makes is here.
//
// The asymmetry these pin down: a false alarm costs the warning its credibility, a missed
// alarm costs nothing much, because the canary does not have to fire on the FIRST broken send
// — the next message that drains with a real intent behind it trips it. So the corroboration
// rule is deliberately conservative, and readSeen fails toward warning rather than silence.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CANARY_GRACE_MS,
  SEND_INTENT_WINDOW_MS,
  isSendIntent,
  missedSend,
  readSeen,
} from "../src/canary.ts";

// --- readSeen: the MAIN world is shared with the page, so this input is untrusted ---

test("readSeen parses a normal counter", () => {
  assert.equal(readSeen("0"), 0);
  assert.equal(readSeen("7"), 7);
});

test("readSeen treats anything unparseable as 0 — it can never fake progress", () => {
  // 0 is the safe direction: a garbage counter cannot *appear* to have advanced, so the worst
  // a page scribbling on data-ss-seen can do is provoke a warning, never suppress one.
  for (const raw of [undefined, "", "  ", "abc", "1.5", "-3", "NaN", "Infinity", "1e999"]) {
    assert.equal(readSeen(raw), 0, `readSeen(${JSON.stringify(raw)})`);
  }
});

// --- isSendIntent: was this drain a send, or the user clearing the box? ---

test("a drain right after Enter is a send", () => {
  assert.equal(isSendIntent(1_000, 1_010), true);
});

test("a drain with no intent behind it is a manual clear, not a send", () => {
  // select-all-delete: the composer empties, but nothing was ever pressed.
  assert.equal(isSendIntent(0, 5_000), false);
});

test("a stale intent does not corroborate a later drain", () => {
  assert.equal(isSendIntent(1_000, 1_000 + SEND_INTENT_WINDOW_MS + 1), false);
  assert.equal(isSendIntent(1_000, 1_000 + SEND_INTENT_WINDOW_MS), true, "boundary is inclusive");
});

test("an intent stamped in the future is a clock adjustment, not a send", () => {
  assert.equal(isSendIntent(2_000, 1_000), false);
});

test("the window is overridable for callers that need a different budget", () => {
  assert.equal(isSendIntent(1_000, 1_900, 1_000), true);
  assert.equal(isSendIntent(1_000, 1_900, 100), false);
});

// --- missedSend: did the guard inspect anything for that send? ---

test("an advanced counter means the guard saw the send", () => {
  assert.equal(missedSend(4, 5), false);
});

test("an unchanged counter means the guard never got a look", () => {
  assert.equal(missedSend(4, 4), true);
});

test("a counter that went backwards still reads as a miss", () => {
  // Only reachable if something rewrote the attribute; warning is the safe answer.
  assert.equal(missedSend(9, 2), true);
});

test("the grace period outlasts a page dispatch without waiting on the model", () => {
  assert.ok(CANARY_GRACE_MS >= 1_000 && CANARY_GRACE_MS <= 10_000);
  assert.ok(SEND_INTENT_WINDOW_MS < CANARY_GRACE_MS);
});
