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
    return Boolean(chrome.runtime?.id);
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
    if (!chrome.runtime?.id) return; // fast path: context already torn down
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    /* context invalidated (possibly between the id check and the call) — nothing to deliver to */
  }
}
