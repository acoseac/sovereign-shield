// Detect that a message was sent which the guard never inspected — i.e. the provider moved
// its generate endpoint out from under GENERATE_ENDPOINTS.
//
// Why this and not "dynamic endpoints": a moved endpoint is not really a matching problem, it
// is a REPORTING problem. Matching by payload shape instead of URL would have us rewriting
// POST bodies we have no model of, against both the fail-open rule and the byte-faithful
// contract (ADR 0002). The actual defect is that breakage is SILENT — the guard keeps
// reporting "active", the pill keeps counting, and prompts go out in the clear. So we leave
// the matcher strict and make the failure loud.
//
// Pure and DOM-free so the decision unit-tests in plain Node, same split as rewrite.ts and
// summarize.ts; indicator.ts is the DOM shell that feeds it.
//
// The signal has three parts, all cheap:
//   1. the MAIN-world guard bumps a counter (data-ss-seen) each time it inspects a body;
//   2. the ISOLATED indicator notices the composer DRAIN from non-empty to empty, which is
//      what a send looks like on every site regardless of transport or button markup;
//   3. if the counter has not advanced a few seconds later, the guard did not see that send.

/**
 * How long to keep watching for the guard to inspect a send before concluding it never did.
 *
 * Generous on purpose, and this number was learned the hard way: a fixed **3-second** check
 * false-fired on Gemini's **Thinking** model. There the composer clears on Enter, but the
 * StreamGenerate request — the one the guard inspects — is issued only after a burst of
 * preparatory RPCs, several seconds later. The send *was* inspected and redacted (the wire
 * carried the stand-in); the check simply ran before the inspect landed, so the guard appeared
 * to have missed a send it had actually protected — the worst kind of false alarm for a privacy
 * tool.
 *
 * The shell polls within this window (see `canaryVerdict`) and cancels the instant the counter
 * advances, so a longer ceiling costs only a slower warning on a genuinely dead endpoint — which
 * by design need not fire on the first send — and never risks a false alarm on a slow-but-fine
 * one.
 */
export const CANARY_GRACE_MS = 12000;

/** Poll cadence while waiting for the inspect. Just a couple of dataset reads per tick. */
export const CANARY_POLL_MS = 500;

/**
 * How long after the drain to keep watching **even once the warning is up**, so an inspect that
 * lands later can take the banner back down.
 *
 * Measured from the **drain**, like every other elapsed check here — not from the warning. Since
 * the warning fires at `CANARY_GRACE_MS`, the window in which it can still be retracted is the
 * difference between the two (33 s at the current values), which is the number to reason about
 * when changing either constant.
 *
 * The warning is an accusation — "this went out as you typed it" — and leaving a wrong one on
 * screen is the failure this whole file is organised against. Before this, `warnMissedSend` was
 * one-way: the poll stopped the instant it warned, so a genuinely slow endpoint could be
 * inspected at 15 s and the banner would sit there for the rest of the page's life, contradicted
 * by the guard's own counter.
 *
 * Cheap to extend because the watch costs two dataset reads per tick and stops the moment it
 * resolves either way. Kept finite rather than unbounded so a page that never sends again isn't
 * polling forever.
 */
export const CANARY_RETRACT_MS = 45000;

/** How long a send-intent signal (Enter, or a click on a button by the composer) stays valid.
 *  The drain follows the intent by a frame or two on every site we support. */
export const SEND_INTENT_WINDOW_MS = 500;

/**
 * Read the MAIN world's inspected-request counter off the dataset.
 *
 * Defensive because the MAIN world is shared with the page: anything can write
 * `data-ss-seen`. Garbage reads as 0, which is the safe direction — an unparseable counter
 * can never *appear* to have advanced, so it can only produce a spurious warning, never
 * suppress a real one.
 */
export function readSeen(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/**
 * Did this composer drain look like a send the user actually initiated, rather than a manual
 * clear (select-all-delete) or the SPA swapping the composer out?
 *
 * `intentAt` is when the last Enter keypress or composer-adjacent button press happened, 0 if
 * there has not been one. Requiring corroboration is deliberately conservative: a drain with
 * no intent behind it stays silent.
 *
 * Being conservative is affordable because the canary does not have to fire on the *first*
 * broken send — a user sends many messages, and any one of them that drains with a real intent
 * behind it trips the warning. Missing one costs nothing; a false alarm on every "new chat"
 * click would cost the warning its credibility.
 */
export function isSendIntent(
  intentAt: number,
  drainedAt: number,
  windowMs: number = SEND_INTENT_WINDOW_MS,
): boolean {
  if (intentAt <= 0) return false;
  const delta = drainedAt - intentAt;
  // delta < 0 would mean the intent is stamped in the future — a clock adjustment, not a send.
  return delta >= 0 && delta <= windowMs;
}

/**
 * After the grace period: did the guard fail to inspect anything for that send? The counter is
 * monotonic, so "did not strictly advance" is exactly "no generate body passed through the
 * rewriter". Equality rather than `<=` so a counter that somehow went backwards (a page script
 * scribbling on the attribute) still reads as a miss and warns.
 *
 * `baseline` must come from `sendBaseline` — sampling it at the drain is the bug that function
 * exists to prevent.
 */
export function missedSend(baseline: number, seenNow: number): boolean {
  return seenNow <= baseline;
}

/**
 * Which counter reading this send is measured against.
 *
 * It MUST be the sample taken at the send **intent** (the Enter keypress / send-button press),
 * never the one taken when the composer drains — and that distinction was a shipped false alarm.
 *
 * Gemini dispatches `StreamGenerate` **before** it clears the composer, and the guard's rewrite
 * runs synchronously inside `xhr.send()`, so `data-ss-seen` has already been bumped by the time
 * the drain is observed. Sampling at the drain therefore folds *this* send into the baseline, and
 * the poll then waits for an advance that has by construction already happened: the verdict is
 * `missed` no matter how long the window is. That is why raising `CANARY_GRACE_MS` from 3s to 12s
 * did not help — no grace period can catch an event that preceded the start of the watch.
 *
 * It reproduced reliably on long prompts and only intermittently on short ones, which is the
 * tell: the synchronous work inside `send()` scales with prompt size, so a big paste delays the
 * dispatch's return past Gemini's composer clear, while a short one usually returns first.
 * Confirmed live against gemini.google.com — the guard warned about a send it had inspected AND
 * redacted (`data-ss-seen` 0→1, `data-ss-kept` 0→1).
 *
 * `Math.min` rather than a bare `seenAtIntent`: the two are equal in every ordinary flow (the
 * counter is monotonic), and taking the lower of the pair keeps a counter the page scribbled
 * *downward* between the two samples from raising the bar this send has to clear. Erring toward
 * an observable advance is the right direction — a false alarm costs the warning its
 * credibility, and the canary never had to fire on the first broken send anyway.
 */
export function sendBaseline(seenAtIntent: number, seenAtDrain: number): number {
  return Math.min(seenAtIntent, seenAtDrain);
}

/**
 * Once the verdict is `missed` and the banner is up: keep polling, in case the inspect is merely
 * late and the warning needs taking back?
 *
 * Split out so the "how long do we stay open to being wrong" budget is one named, tested number
 * rather than a literal buried in a timer callback.
 */
export function shouldKeepWatching(
  elapsedMs: number,
  windowMs: number = CANARY_RETRACT_MS,
): boolean {
  return elapsedMs < windowMs;
}

export type CanaryVerdict = "inspected" | "waiting" | "missed";

/**
 * The poll's decision on each tick after a send drained:
 *   - `inspected` — the counter advanced, the guard saw the send; stop, say nothing.
 *   - `waiting`   — no advance yet, but still inside the window; keep polling.
 *   - `missed`    — the window elapsed with no advance; the send went out uninspected, warn.
 *
 * Split out as a pure function so the three-state timing logic is unit-tested without a DOM or
 * real timers. `missedSend` is still the "did it advance?" primitive underneath.
 */
export function canaryVerdict(
  baseline: number,
  seenNow: number,
  elapsedMs: number,
  windowMs: number = CANARY_GRACE_MS,
): CanaryVerdict {
  if (!missedSend(baseline, seenNow)) return "inspected";
  return elapsedMs >= windowMs ? "missed" : "waiting";
}

/** The two things a watch does to the outside world. Injected, so the state machine below has
 *  no DOM and no banner knowledge — and so a test can assert exactly when each one fires. */
export interface CanaryWatchDeps {
  /** Raise the warning. MUST report whether THIS call is what put the bar on screen: with one
   *  bar per page, `false` means an earlier missed send already raised it, and that send's
   *  warning is not ours to take back. */
  warn: () => boolean;
  /** Take our own bar back down. */
  retract: () => void;
}

/** Everything a tick reads from the world, passed in rather than sampled, so the machine is
 *  deterministic and needs no fake timers. */
export interface CanaryWatchInput {
  now: number;
  seenNow: number;
  /** The shell's latest send-intent stamp — a new value means another send has begun. */
  lastIntentAt: number;
}

/** `done` means the caller should stop polling; the watch will not be ticked again. */
export type CanaryTick = "continue" | "done";

/**
 * The post-drain watch, as a state machine with its effects injected.
 *
 * This lives here rather than inside the `setInterval` in indicator.ts because that is where it
 * used to live, and every one of the four defects found in this logic hid there: the shell has no
 * test harness, so `warned`, `retractable` and `intentAtArm` — three interacting flags with
 * order-dependent updates — were the only untested decisions left in the canary. Moving them
 * behind an injectable seam costs one factory call and makes the whole sequence assertable in
 * plain Node. What remains in the shell is reading three values and stopping a timer.
 *
 * The four behaviours it encodes, each with a shipped bug behind it — see `canary-watch.test.ts`,
 * where every one is pinned by a test that provably fails without it:
 *
 *  1. `baseline` comes from the send INTENT (`sendBaseline`), because the inspect can land before
 *     the drain — the false alarm that started all of this.
 *  2. Retract only a bar THIS send raised (`warn()`'s return). An earlier genuinely-missed send's
 *     warning is still true, and this send turning out fine must not erase it.
 *  3. A new send intent abandons the watch only AFTER we have warned. `noteIntent` fires on any
 *     button in composer scope — attach, mic, stop — so abandoning on every intent made the canary
 *     systematically silent for anyone who habitually stops long answers.
 *  4. On warning, re-baseline onto a stray intent we can PROVE was not a send (one older than
 *     `SEND_INTENT_WINDOW_MS`, since a real send drains inside that window and the drain re-arms
 *     the watch outright). Otherwise rule 3's guard fires on the very next tick and collapses the
 *     retraction window to nothing. A *recent* intent stays put: it may still dispatch, and
 *     misreading that as our own late inspect would erase a true warning.
 */
export function createCanaryWatch(
  start: { baseline: number; drainedAt: number; intentAtArm: number },
  deps: CanaryWatchDeps,
): (input: CanaryWatchInput) => CanaryTick {
  let intentAtArm = start.intentAtArm;
  let warned = false;
  let retractable = false;

  return ({ now, seenNow, lastIntentAt }) => {
    // (3) Only once warned: before that, a stray click leaves the counter untouched, so the
    // verdict at CANARY_GRACE_MS is still sound and the warning still has to land.
    if (warned && lastIntentAt !== intentAtArm) return "done";

    const elapsed = now - start.drainedAt;
    const verdict = canaryVerdict(start.baseline, seenNow, elapsed);
    if (verdict === "waiting") return "continue";

    if (verdict === "inspected") {
      // (2) Ours to take back only if we raised it.
      if (retractable) deps.retract();
      return "done";
    }

    if (!warned) {
      warned = true;
      // (4) Forgive a stray click, never a possible send.
      if (!isSendIntent(lastIntentAt, now)) intentAtArm = lastIntentAt;
      retractable = deps.warn();
    }
    // Stay open to being wrong until the retraction budget runs out.
    return shouldKeepWatching(elapsed) ? "continue" : "done";
  };
}
