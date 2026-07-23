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
  actionLabel?: string;
  onAction?: () => void;
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

  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement("button");
    btn.textContent = opts.actionLabel;
    btn.style.cssText =
      `margin-left:8px;background:#fff;color:${TONE_BG[opts.tone]};border:0;border-radius:6px;` +
      "padding:3px 12px;font:inherit;cursor:pointer";
    btn.addEventListener("click", opts.onAction);
    bar.append(btn);
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
