// Talking to the service worker safely from a page whose chrome.* context can be torn down
// under it — a content script in an open tab, or the options page while the extension updates.
//
// After the extension is reloaded or updated, such a context is dead ("Extension context
// invalidated"). In that state `chrome.runtime.sendMessage` throws **synchronously**, before it
// returns a promise, so a trailing `.catch()` cannot swallow it — there is no promise to reject.
// That is the whole bug this module exists to prevent: every fire-and-forget message must guard
// the call itself, not just its result.
//
// A dead context means the worker is unreachable and there is nothing to deliver to. bridge.ts's
// stale-tab banner already tells the user to reload, so the right behaviour here is simply to do
// nothing — never throw, never log.
//
// Pure of any top-level chrome.* access, so it imports cleanly in a plain-Node test.

/** True while this content script still has a live extension context. Reading `chrome.runtime.id`
 *  on an invalidated context can itself throw, hence the try/catch. */
export function contextValid(): boolean {
  try {
    // `typeof` first so a missing `chrome` (a non-extension context, a bare-Node test) is a
    // clean false rather than a thrown-then-caught ReferenceError — which is slow and trips
    // "pause on caught exceptions" while debugging.
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget a message to the service worker. Swallows **both** failure modes: the
 * synchronous throw on an invalidated context, and the async "Receiving end does not exist"
 * rejection when the worker is asleep or gone. Never throws.
 */
export function notifyWorker(message: unknown): void {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return; // context absent/torn down
    // Guard the return: MV3 sendMessage returns a Promise, but a mock (or an odd runtime) may
    // return undefined, and `.catch` on that would throw synchronously — the very failure mode
    // we're here to prevent.
    const p = chrome.runtime.sendMessage(message) as Promise<unknown> | undefined;
    if (p && typeof p.catch === "function") p.catch(() => undefined);
  } catch {
    /* context invalidated (possibly between the id check and the call) — nothing to deliver to */
  }
}
