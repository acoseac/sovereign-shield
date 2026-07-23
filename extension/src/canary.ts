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

/** How long to wait after a send before concluding the guard never saw it. Generous: it only
 *  has to outlast the page's own dispatch, not the model's reply. */
export const CANARY_GRACE_MS = 3000;

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
 */
export function missedSend(seenAtDrain: number, seenNow: number): boolean {
  return seenNow <= seenAtDrain;
}
