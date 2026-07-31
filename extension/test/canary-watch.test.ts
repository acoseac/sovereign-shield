// Tests for the post-drain watch — the state machine that decides when the canary warns, when it
// takes a warning back, and when a newer send has made the counter unreadable.
//
// This file exists because that logic used to live inside a setInterval in indicator.ts, where
// nothing could reach it, and FOUR separate defects hid there in a single afternoon:
//
//   1. the baseline was sampled at the composer drain, so a send that Gemini dispatched before
//      clearing the composer was already counted in its own baseline and every tick said "missed";
//   2. the retraction erased a bar raised by an EARLIER genuinely-missed send;
//   3. the new-intent guard fired on any composer-scope button, so a stop/attach/mic click before
//      the grace deadline killed the warning outright;
//   4. and once that was gated on `warned`, a stray click before the warning made the guard fire
//      on the very next tick, collapsing the retraction window to zero.
//
// Every one is pinned below. The rule of thumb they share: a false alarm costs the warning its
// credibility, and erasing a TRUE warning is worse still — so where the machine cannot tell, it
// prefers to leave a warning standing over taking one back.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CANARY_GRACE_MS,
  CANARY_RETRACT_MS,
  SEND_INTENT_WINDOW_MS,
  createCanaryWatch,
  sendBaseline,
} from "../src/canary.ts";

/** A watch plus a record of the effects it fired. `raised` controls what warn() reports — false
 *  is the "an earlier send already put the bar up" case. */
function watch(
  start: { baseline?: number; drainedAt?: number; intentAtArm?: number } = {},
  raised = true,
) {
  const calls: string[] = [];
  const tick = createCanaryWatch(
    { baseline: start.baseline ?? 0, drainedAt: start.drainedAt ?? 0, intentAtArm: start.intentAtArm ?? 1_000 },
    {
      warn: () => {
        calls.push("warn");
        return raised;
      },
      retract: () => void calls.push("retract"),
    },
  );
  return { calls, tick };
}

/** Defaults that mean "nothing has changed since we armed". */
function at(now: number, seenNow = 0, lastIntentAt = 1_000) {
  return { now, seenNow, lastIntentAt };
}

// --- the happy paths ------------------------------------------------------

test("a send inspected before the first tick never warns", () => {
  // Defect 1's shape, now measured from the intent: the counter moved between intent and tick,
  // and that movement IS this send.
  const w = watch({ baseline: sendBaseline(0, 1) });
  assert.equal(w.tick(at(100, 1)), "done");
  assert.deepEqual(w.calls, []);
});

test("nothing inspected, still inside the grace window → keep waiting, stay silent", () => {
  const w = watch();
  assert.equal(w.tick(at(1_000)), "continue");
  assert.equal(w.tick(at(CANARY_GRACE_MS - 1)), "continue");
  assert.deepEqual(w.calls, []);
});

test("a genuinely uninspected send warns exactly once, however many ticks pass", () => {
  const w = watch();
  assert.equal(w.tick(at(CANARY_GRACE_MS)), "continue", "keeps watching in case it is wrong");
  w.tick(at(CANARY_GRACE_MS + 500));
  w.tick(at(CANARY_GRACE_MS + 1_000));
  assert.deepEqual(w.calls, ["warn"], "one bar per send, not one per tick");
});

test("the watch gives up when the retraction budget runs out", () => {
  const w = watch();
  w.tick(at(CANARY_GRACE_MS));
  assert.equal(w.tick(at(CANARY_RETRACT_MS - 1)), "continue");
  assert.equal(w.tick(at(CANARY_RETRACT_MS)), "done", "boundary is exclusive");
});

// --- defect 2: whose bar is it? -------------------------------------------

test("a late inspect retracts the bar this send raised", () => {
  const w = watch();
  w.tick(at(CANARY_GRACE_MS));
  assert.equal(w.tick(at(20_000, 1)), "done");
  assert.deepEqual(w.calls, ["warn", "retract"]);
});

test("REGRESSION: a send does NOT retract a bar raised by an earlier missed send", () => {
  // Send A was genuinely missed and its bar is up — still true. Send B is missed too, so
  // showBanner dedups and raises nothing (warn() reports false). B is then late-inspected.
  // Retracting here would erase A's warning and leave the user believing A was guarded.
  const w = watch({}, /* raised */ false);
  w.tick(at(CANARY_GRACE_MS));
  assert.equal(w.tick(at(20_000, 1)), "done");
  assert.deepEqual(w.calls, ["warn"], "warned, but nothing of ours to take back");
});

// --- defect 3: a stray click must not silence a real warning ---------------

test("REGRESSION: a stray composer click before the deadline does not suppress the warning", () => {
  // noteIntent fires on ANY button in composer scope — attach, mic, and the stop-generating
  // button that replaces Send mid-answer. Abandoning on every intent made the canary
  // systematically silent for anyone who habitually stops long answers: a blind spot, not the
  // random miss this design tolerates.
  const w = watch({ intentAtArm: 1_000 });
  assert.equal(w.tick(at(5_000, 0, 4_000)), "continue", "clicked stop at 4s — keep watching");
  w.tick(at(CANARY_GRACE_MS, 0, 4_000));
  assert.deepEqual(w.calls, ["warn"], "the warning must still land");
});

// --- defect 4: ...and must not silently collapse the retraction window -----

test("REGRESSION: a stray click before the warning leaves the retraction watch alive", () => {
  // The bug this pins: intentAtArm was captured once, so a pre-warning click left it permanently
  // mismatched and the guard fired on the very next tick after `warned` flipped — turning the 45s
  // retraction window into zero, in exactly the scenario defect 3's fix was written to protect.
  const strayAt = 4_000; // older than SEND_INTENT_WINDOW_MS by the time we warn: provably not a send
  const w = watch({ intentAtArm: 1_000 });
  w.tick(at(CANARY_GRACE_MS, 0, strayAt));
  assert.deepEqual(w.calls, ["warn"]);

  assert.equal(w.tick(at(CANARY_GRACE_MS + 500, 0, strayAt)), "continue", "still open to being wrong");
  assert.equal(w.tick(at(20_000, 1, strayAt)), "done");
  assert.deepEqual(w.calls, ["warn", "retract"], "the late inspect still takes the bar down");
});

test("a RECENT intent at warning time is not forgiven — it may still dispatch", () => {
  // The other half of defect 4's fix, and the reason it is not just `intentAtArm = lastIntentAt`.
  // An intent inside SEND_INTENT_WINDOW_MS may be a send whose dispatch has not landed yet;
  // crediting that dispatch as our own late inspect would erase a warning that is still true.
  const recentAt = CANARY_GRACE_MS - 100; // within the send window when we warn
  const w = watch({ intentAtArm: 1_000 });
  w.tick(at(CANARY_GRACE_MS, 0, recentAt));
  assert.deepEqual(w.calls, ["warn"]);

  assert.equal(w.tick(at(CANARY_GRACE_MS + 500, 1, recentAt)), "done", "abandon rather than credit");
  assert.deepEqual(w.calls, ["warn"], "no retraction: that counter movement was not provably ours");
});

test("the forgiveness boundary is SEND_INTENT_WINDOW_MS", () => {
  const warnAt = CANARY_GRACE_MS;
  // Exactly at the edge the intent still counts as a possible send, so it is NOT forgiven.
  const edge = watch({ intentAtArm: 1_000 });
  edge.tick(at(warnAt, 0, warnAt - SEND_INTENT_WINDOW_MS));
  assert.equal(edge.tick(at(warnAt + 500, 1, warnAt - SEND_INTENT_WINDOW_MS)), "done");
  assert.deepEqual(edge.calls, ["warn"], "boundary is inclusive: still a possible send");

  // One millisecond older and it cannot be a send, so the retraction watch survives.
  const past = watch({ intentAtArm: 1_000 });
  past.tick(at(warnAt, 0, warnAt - SEND_INTENT_WINDOW_MS - 1));
  past.tick(at(warnAt + 500, 1, warnAt - SEND_INTENT_WINDOW_MS - 1));
  assert.deepEqual(past.calls, ["warn", "retract"]);
});

// --- a genuinely new send ------------------------------------------------

test("a new send after the warning abandons the watch instead of crediting its dispatch", () => {
  const w = watch({ intentAtArm: 1_000 });
  w.tick(at(CANARY_GRACE_MS));
  assert.deepEqual(w.calls, ["warn"]);
  // The next send's Enter, then its dispatch bumping the counter.
  assert.equal(w.tick(at(CANARY_GRACE_MS + 500, 1, 30_000)), "done");
  assert.deepEqual(w.calls, ["warn"], "that advance belongs to the new send, not to us");
});

test("a new send BEFORE any warning still leaves the machine able to warn", () => {
  // Pre-warning the guard is off, so the verdict is decided on the counter alone. If the new
  // send's dispatch advances it we fall silent (a suppression, the cheap direction); if it does
  // not, our send is still provably unseen and must warn.
  const w = watch({ intentAtArm: 1_000 });
  assert.equal(w.tick(at(2_000, 0, 1_900)), "continue");
  w.tick(at(CANARY_GRACE_MS, 0, 1_900));
  assert.deepEqual(w.calls, ["warn"]);
});
