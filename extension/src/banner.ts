// The full-width notice bar used by the ISOLATED-world content scripts when something is
// wrong that the user must know about. Two callers today, and both are cases where staying
// quiet would be the real failure:
//   - bridge.ts   : the extension was updated, so this tab is running dead code.
//   - indicator.ts: a message was sent that the guard never inspected (see canary.ts).
//
// Shared so the two cannot drift into looking like different products, and so the dedup rule
// (one bar per id, ever) is enforced in one place.

import { Z_BANNER } from "./layers.ts";

export type BannerTone = "error" | "warning";

/**
 * One control on the bar. Either a link or a button, never both.
 *
 * `href` is preferred where it fits: a real anchor gives the user the affordances they expect
 * (hover to see the destination, middle-click, copy the link) and nothing happens until they
 * choose it — which matters for the report links, where the whole point is that the user, not
 * the extension, decides to send something.
 */
export interface BannerAction {
  label: string;
  href?: string;
  onAction?: () => void;
  /** Rendered as a quieter, secondary control. */
  subtle?: boolean;
}

const TONE_BG: Record<BannerTone, string> = {
  error: "#b91c1c", // something is broken now
  warning: "#b45309", // something may be broken; you can keep working
};

const shown = new Set<string>();

/**
 * Show a notice bar, once per `id` for the life of the page. Returns false if this id was
 * already shown — a send that keeps failing must not stack twenty bars down the viewport.
 *
 * Built with createElement/textContent throughout: Gemini enforces Trusted Types, so any
 * innerHTML here would throw and take the caller down with it.
 */
export function showBanner(opts: {
  id: string;
  tone: BannerTone;
  text: string;
  actions?: BannerAction[];
}): boolean {
  if (shown.has(opts.id)) return false;
  shown.add(opts.id);

  const bar = document.createElement("div");
  bar.setAttribute("role", "alert");
  bar.dataset.ssBanner = opts.id;
  bar.style.cssText =
    `position:fixed;inset:0 0 auto 0;z-index:${Z_BANNER};background:${TONE_BG[opts.tone]};color:#fff;` +
    "font:600 13px system-ui,sans-serif;padding:9px 14px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,.3)";
  bar.append(document.createTextNode(opts.text + " "));

  for (const action of opts.actions ?? []) {
    const solid =
      `margin-left:8px;background:#fff;color:${TONE_BG[opts.tone]};border:0;border-radius:6px;` +
      "padding:3px 12px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block";
    const quiet =
      "margin-left:8px;background:transparent;color:#fff;border:0;font:inherit;cursor:pointer;" +
      "text-decoration:underline;opacity:.9";
    if (action.href) {
      const link = document.createElement("a");
      link.textContent = action.label;
      link.href = action.href;
      link.target = "_blank";
      // noopener/noreferrer: the report links open github.com in a tab that must get no handle
      // back to a page we do not control.
      link.rel = "noopener noreferrer";
      link.style.cssText = action.subtle ? quiet : solid;
      bar.append(link);
    } else if (action.onAction) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      btn.style.cssText = action.subtle ? quiet : solid;
      btn.addEventListener("click", action.onAction);
      bar.append(btn);
    }
  }

  const dismiss = document.createElement("button");
  dismiss.textContent = "✕";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.style.cssText =
    "margin-left:10px;background:transparent;color:#fff;border:0;font:inherit;cursor:pointer;opacity:.8";
  dismiss.addEventListener("click", () => bar.remove());
  bar.append(dismiss);

  (document.body ?? document.documentElement).append(bar);
  return true;
}

/**
 * Take a bar back down, and forget that it was ever shown.
 *
 * Clearing the `shown` entry is the point, not a detail: without it the once-per-page rule would
 * mean a retracted warning could never be re-raised, so a genuine failure later on the same page
 * would go silent — trading a false alarm for a missed one, which is the worse of the two for
 * this particular bar.
 *
 * Returns false if that id was not showing, so a caller retracting speculatively is a no-op.
 * Matches on the `data-ss-banner` attribute rather than a CSS selector built from `id`, so an id
 * containing quotes could never turn into a malformed selector.
 */
export function dismissBanner(id: string): boolean {
  if (!shown.delete(id)) return false;
  for (const bar of document.querySelectorAll("[data-ss-banner]")) {
    if (bar instanceof HTMLElement && bar.dataset.ssBanner === id) bar.remove();
  }
  return true;
}
