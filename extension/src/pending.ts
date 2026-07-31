// MAIN-world: publish what the guard WOULD keep local for the text currently in the composer,
// as counts only, for the isolated-world pill to render.
//
// Why this lives in the MAIN world at all — the pill used to compute its own summary in the
// isolated world, and it disagreed with the guard. `Session` drops values the user excused via
// the inspector's "stop redacting this" (tokenize.ts, `allowlist`), and the pill had no way to
// know, so it went on counting a value the guard would deliberately let through.
//
// The obvious fix — send the excused values across — is exactly what ADR 0005 forbids: those
// are real PII, and the MAIN↔ISOLATED bridge carries category names and bare commands only. So
// the computation moves to the world that already holds the values, and only
// `{count, categories, surrogatable}` crosses. Category labels are static strings or the user's
// own rule labels, both of which the activity log already carries.
//
// Bonus: this deletes the second detection pipeline. summarize() is now called once, in one
// world, with the full picture.
import { findComposer } from "./composer.ts";
import { summarize, type Summary } from "./summarize.ts";
import type { CustomMatcher } from "./custom.ts";
import type { Session } from "./tokenize.ts";

/** Attribute on <html> carrying the JSON summary. Counts and labels only — never a value. */
export const PENDING_ATTR = "ssPending";

// Long enough to coalesce a burst of keystrokes, short enough that the pill still feels live.
// The isolated side debounces its own render on top of this, so keep it modest.
const DEBOUNCE_MS = 120;

export interface PendingDeps {
  allowedCategories: () => ReadonlySet<string> | undefined;
  customMatcher: () => CustomMatcher | undefined;
}

/** Serialise for the attribute. Short keys because this is rewritten on every keystroke burst. */
function encode(s: Summary): string {
  return JSON.stringify({ c: s.count, k: s.categories, s: s.surrogatable });
}

/** Read a published summary back, or null if absent or unparseable. Used by the isolated world,
 *  which must treat this as untrusted input — a page script can write any attribute it likes. */
export function decodePending(raw: string | undefined): Summary | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { c, k, s } = v as { c?: unknown; k?: unknown; s?: unknown };
    if (typeof c !== "number" || !Number.isFinite(c) || c < 0) return null;
    if (!Array.isArray(k) || k.some((x) => typeof x !== "string")) return null;
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0) return null;
    return { count: c, categories: k as string[], surrogatable: s };
  } catch {
    return null;
  }
}

/**
 * Keep `data-ss-pending` current with the composer's contents.
 *
 * Triggered by `input` in the capture phase, which covers typing, paste, cut and IME on both
 * `<textarea>` and contenteditable composers, plus focus changes so switching between boxes
 * re-reads the right one. Read-only throughout: this never touches the composer, and like the
 * rest of the pre-send UI it can never block a send.
 */
let publishNow: (() => void) | null = null;

/**
 * Republish **immediately**, skipping the debounce — the inspector calls this the moment a value
 * is excused. That is one deliberate click, not a burst of keystrokes, so there is nothing to
 * coalesce and the debounce would only add latency to the one interaction where the panel and
 * the pill must visibly agree. No-op before install.
 */
export function refreshPending(): void {
  publishNow?.();
}

export function installPendingSummary(session: Session, deps: PendingDeps): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = "";

  const publish = (): void => {
    let next = "";
    try {
      const composer = findComposer();
      // innerText, NOT textContent — and the reasoning that used to sit here was wrong.
      //
      // It argued the missing line breaks "could only matter if an identifier were split across a
      // block boundary". They matter far more ordinarily than that: a composer puts each line in
      // its own block, so textContent runs them together and every value that ENDS a line loses
      // the boundary its pattern needs. "…MRTMTT25D09F205Z" + "NIR (FR): …" reads as
      // "MRTMTT25D09F205ZNIR" and no longer matches.
      //
      // Measured on a real eight-identifier prompt: textContent found 1, innerText found 8 — while
      // the guard redacted all 8, because it reads the request body with its newlines intact. So
      // the pill was under-reporting protection by seven on the one surface whose entire job is to
      // be believed before you press send, and it under-reported in the alarming direction.
      //
      // innerText's layout cost is real but bounded: this is debounced (DEBOUNCE_MS), and
      // inspector.ts already reads innerText from this same element for the same reason. The drain
      // check in indicator.ts deliberately KEEPS textContent — it only asks "is this empty", which
      // concatenation cannot affect, and it runs undebounced on every keystroke.
      const text = composer?.innerText ?? "";
      if (text.trim()) {
        // The excused set is the whole reason this runs here rather than in the pill.
        next = encode(summarize(text, deps.allowedCategories(), deps.customMatcher(), session.excused));
      }
    } catch {
      // Never let the pre-send hint break the page. An empty attribute makes the isolated side
      // fall back to computing its own summary, which is the pre-0.7.0 behaviour.
      next = "";
    }
    if (next === last) return; // avoid pointless attribute churn on every keystroke
    last = next;
    if (next) document.documentElement.dataset[PENDING_ATTR] = next;
    else delete document.documentElement.dataset[PENDING_ATTR];
  };

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(publish, DEBOUNCE_MS);
  };

  document.addEventListener("input", schedule, { capture: true, passive: true });
  document.addEventListener("focusin", schedule, { capture: true, passive: true });
  // Settings and the excused set both change outside any input event — a category toggled in
  // options, or "stop redacting this" clicked in the panel. Cheap: one attribute observer on
  // <html>, and the inspector calls back directly.
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-ss-cats", "data-ss-custom", "data-ss-smoke", "data-ss-enabled"],
  });

  // Cancel any queued run first, so an immediate publish is never followed by a redundant one.
  publishNow = () => {
    clearTimeout(timer);
    publish();
  };
  schedule(); // publish once at install, so a pre-filled composer is counted before any keystroke
}
