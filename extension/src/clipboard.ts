// MAIN-world clipboard rehydration. The third surface where real values are restored,
// alongside the painted DOM and the inspector panel — see ADR 0005 for the boundary.
//
// Why this exists: the DOM rehydrator swaps token→value in painted TEXT NODES. Every
// supported site renders markdown, and their "Copy" buttons serve the markdown SOURCE held
// in the page's own JS state — which the rehydrator never touched. So the thing on screen
// and the thing on the clipboard disagreed:
//
//   - bracket tokens → the user copies "[EMAIL_1]" and pastes a broken draft. Annoying.
//   - smokescreen ON → the user copies "alice.morgan@example.org" and pastes a FABRICATED
//     address believing it is real. That is the failure ADR 0004 warns about ("a user
//     reading a chat transcript out of context can no longer tell at a glance that
//     redaction happened"), and the clipboard is how it escapes into a real email.
//
// Both hooks are idempotent and safe whichever source a site copies from: if the text is
// already rehydrated, rehydrate() finds nothing to change and we do not touch the clipboard.
import type { Session } from "./tokenize.ts";

/** The slice of Session this module needs. Narrow on purpose — it documents that clipboard
 *  rehydration only ever READS the mapping, and lets the tests drive it with a real Session. */
export type Rehydrator = Pick<Session, "mayNeedRehydration" | "rehydrate">;

/**
 * The rehydrated form of `text`, or **null when nothing changed** — including for non-strings
 * and empty input. Null is the "leave it alone" signal, mirroring the byte-faithful contract
 * the request rewriter follows: never rewrite a payload we did not need to touch.
 *
 * `map` is forwarded to Session.rehydrate to post-process substituted values (HTML escaping
 * for the text/html flavour).
 */
export function rehydrateClipboardText(
  session: Rehydrator,
  text: unknown,
  map?: (value: string) => string,
): string | null {
  if (typeof text !== "string" || text === "") return null;
  if (!session.mayNeedRehydration(text)) return null;
  const restored = session.rehydrate(text, map);
  return restored === text ? null : restored;
}

/** Escape a value being spliced into an HTML flavour. Real identifiers (email, IBAN, AHV)
 *  contain nothing special, but a user's own custom-blocklist term is arbitrary text and
 *  could carry `&` or `<` and corrupt the markup it lands in. Both quote forms are escaped:
 *  the HTML serialiser only ever emits double-quoted attributes, so `'` is belt-and-braces
 *  for a token that landed inside a hand-written single-quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One flavour to write back onto the event's DataTransfer. */
export interface ClipboardWrite {
  format: string;
  data: string;
}

/** What to do with a `copy` event. `writes: []` and `cancel: false` means "touch nothing". */
export interface ClipboardPlan {
  writes: ClipboardWrite[];
  /** True only when we are the ones taking the default action away from the browser. */
  cancel: boolean;
}

/**
 * Decide how to rewrite what a `copy` event is about to put on the clipboard. Pure, so the
 * branch that matters is unit-testable without a DOM; handleCopy below is the adapter.
 *
 * The listener is registered on `window` in the bubble phase so it runs after every listener
 * the site could have installed — including one on `document`, which would otherwise beat us
 * because we register first (document_start).
 *
 * There are two sources, and which one the browser will actually use is decided by
 * `defaultPrevented`. Reading the wrong one is not cosmetic: it either misses the rewrite or
 * promotes data the browser was going to throw away.
 *
 *   - **The site cancelled the event** → its setData() payload is what gets written, so that
 *     is what we rewrite. No preventDefault() of our own: the decision is already made, and
 *     re-making it is not ours to do.
 *   - **Nobody cancelled it** → the browser will serialise the SELECTION. Usually that is
 *     already correct, because the selection lives in the painted DOM the rehydrator restored,
 *     and we do nothing. But a copy-button shim that stuffs markdown into a hidden textarea,
 *     selects it and calls execCommand("copy") also lands here, and that text is raw. So we
 *     read the selection ourselves and, only if it actually changed, cancel and substitute.
 *
 * Note there is no isEditable() bail here, unlike the DOM rehydrator. That guard exists to stop
 * us WRITING into a composer; copying never mutates the page. Bailing on an editable would
 * also break the hidden-textarea shim above — and a composer holding a stand-in (the user
 * pasted a reply back to revise it) should restore like anything else.
 *
 * `cancel` is only ever true in the second branch. When the site already cancelled, the
 * decision is made and re-making it is not ours to do; when nothing changed we must NOT
 * cancel, or we would replace the browser's full multi-flavour serialisation with our own
 * single flavour for no gain.
 */
export function planClipboardRewrite(
  session: Rehydrator,
  event: {
    defaultPrevented: boolean;
    plain: string;
    html: string;
    selection: string;
    /** Lazy: serialising the selection's markup is only worth it once we know we are going to
     *  cancel, which is rare. Called at most once, and never on the common no-op path. */
    htmlSelection: () => string;
  },
): ClipboardPlan {
  if (!event.defaultPrevented) {
    const restored = rehydrateClipboardText(session, event.selection);
    // The common path: the painted selection is already real, so leave the event alone and
    // let the browser serialise it (including flavours we would have had to drop).
    if (restored === null) return { writes: [], cancel: false };
    const writes: ClipboardWrite[] = [{ format: "text/plain", data: restored }];
    // Cancelling takes the browser's own text/html flavour with it, so if the selection had
    // markup we have to supply it ourselves or a paste into Gmail/Docs loses every link, list
    // and bold. Written even when rehydration changed nothing — the point is to not lose it.
    const markup = event.htmlSelection();
    if (markup) {
      writes.push({
        format: "text/html",
        data: rehydrateClipboardText(session, markup, escapeHtml) ?? markup,
      });
    }
    return { writes, cancel: true };
  }
  const writes: ClipboardWrite[] = [];
  const plain = rehydrateClipboardText(session, event.plain);
  if (plain !== null) writes.push({ format: "text/plain", data: plain });
  // text/html matters as much as text/plain: "draft this email" → copy → paste into Gmail
  // takes the HTML flavour, which is exactly the journey this fix exists for. Values are
  // escaped on the way in (see escapeHtml). Best-effort in the same way the DOM rehydrator
  // is — a stand-in the model split across markup simply will not match.
  const html = rehydrateClipboardText(session, event.html, escapeHtml);
  if (html !== null) writes.push({ format: "text/html", data: html });
  return { writes, cancel: false };
}

/** Serialise the current selection's markup, the way the browser's own text/html flavour
 *  would. Only called when we are about to cancel and therefore have to replace it. */
function selectionHtml(): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return "";
  const holder = document.createElement("div");
  for (let i = 0; i < selection.rangeCount; i++) {
    holder.append(selection.getRangeAt(i).cloneContents());
  }
  return holder.innerHTML; // reading innerHTML is fine under Trusted Types; assigning is not
}

/** Thin DOM adapter over planClipboardRewrite. */
function handleCopy(session: Rehydrator, event: ClipboardEvent): void {
  const data = event.clipboardData;
  if (!data) return;
  const plan = planClipboardRewrite(session, {
    defaultPrevented: event.defaultPrevented,
    plain: data.getData("text/plain"),
    html: data.getData("text/html"),
    // Only read when it is the source that matters; getSelection() is not free.
    selection: event.defaultPrevented ? "" : (window.getSelection()?.toString() ?? ""),
    htmlSelection: selectionHtml,
  });
  for (const write of plan.writes) data.setData(write.format, write.data);
  if (plan.cancel) event.preventDefault();
}

/**
 * Patch navigator.clipboard.writeText — button-driven copies call it directly and fire no
 * `copy` event, so the listener above never sees them.
 *
 * Object.defineProperty rather than plain assignment: not because assignment throws (WebIDL
 * operations are writable and configurable, so `clipboard.writeText = fn` would shadow the
 * prototype method fine), but because it keeps the patch explicitly `configurable` and still
 * works if the page has already redefined or frozen the property.
 *
 * write(ClipboardItem[]) is deliberately NOT patched: reading a Blob needs an await before
 * the native call, which risks losing transient user activation and breaking the site's copy
 * button outright. Failing open there costs an unrehydrated copy; failing closed would cost
 * the user their copy button.
 */
function installWriteTextHook(session: Rehydrator): void {
  try {
    // Undefined on insecure origins — relevant once user-added self-hosted origins land.
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return;
    const original = clipboard.writeText.bind(clipboard);
    Object.defineProperty(clipboard, "writeText", {
      value: function (data: string): Promise<void> {
        let out = data;
        try {
          out = rehydrateClipboardText(session, data) ?? data;
        } catch {
          out = data; // fail open: copy the original rather than nothing
        }
        return original(out);
      },
      // Match the shape of the WebIDL operation we are shadowing.
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } catch {
    /* degrade to unpatched — a copy that isn't rehydrated beats a guard that throws at
       document_start and takes the request hooks down with it */
  }
}

/** Install both clipboard paths. Any failure is swallowed: this is additive. */
export function installClipboardRehydrator(session: Rehydrator): void {
  // window, bubble phase: the last listener to run, so event.defaultPrevented reflects every
  // decision the page made (a document-level site listener would otherwise run after ours).
  window.addEventListener("copy", (event) => {
    try {
      handleCopy(session, event as ClipboardEvent);
    } catch {
      /* leave the clipboard exactly as the page left it */
    }
  });
  installWriteTextHook(session);
}
