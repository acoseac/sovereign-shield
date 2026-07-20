// ISOLATED-world content script: bridges chrome.* <-> the MAIN-world guard.
//   - pushes settings to the page via data-* attributes on <html>
//     (data-ss-enabled, data-ss-cats), which the guard reads
//   - forwards redaction / fail-open events (category only) from the guard to the
//     background, the single writer for the activity log + badge
//   - answers the popup's status query
//   - detects a stale (extension-updated) tab and nudges a reload
import { ALL_CATEGORY_KEYS } from "./categories";
import { getSettings, KEYS } from "./storage";

// --- stale-tab detection ---------------------------------------------------
// Reloading an unpacked extension does NOT reload the content scripts already
// running in open tabs — they keep executing old code against a dead chrome.*
// context. Detect that and nudge the user to reload this tab.
let bannerShown = false;

function contextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function showStaleBanner(): void {
  if (bannerShown) return;
  bannerShown = true;
  const bar = document.createElement("div");
  bar.setAttribute("role", "alert");
  bar.style.cssText =
    "position:fixed;inset:0 0 auto 0;z-index:2147483647;background:#b91c1c;color:#fff;" +
    "font:600 13px system-ui,sans-serif;padding:9px 14px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,.3)";
  bar.append(
    document.createTextNode("🛡️ Sovereign Shield was updated — reload this tab to restore redaction. "),
  );
  const btn = document.createElement("button");
  btn.textContent = "Reload";
  btn.style.cssText =
    "margin-left:8px;background:#fff;color:#b91c1c;border:0;border-radius:6px;padding:3px 12px;font:inherit;cursor:pointer";
  btn.addEventListener("click", () => location.reload());
  bar.append(btn);
  (document.body ?? document.documentElement).append(bar);
}

const staleTimer = setInterval(() => {
  if (!contextValid()) {
    showStaleBanner();
    clearInterval(staleTimer);
  }
}, 10000);

// --- settings sync ---------------------------------------------------------
async function applySettings(): Promise<void> {
  const s = await getSettings();
  const root = document.documentElement;
  root.dataset.ssEnabled = s.enabled ? "on" : "off";
  root.dataset.ssCats = s.categories.join(",");
  // JSON, not comma-joined: custom patterns can contain commas. The MAIN-world guard
  // JSON.parses this in a try/catch and falls back to no custom rules on any surprise.
  root.dataset.ssCustom = JSON.stringify(s.custom);
  // Opt-in, so the guard reads "on" as the only truthy value (a missing attribute must
  // mean brackets, not stand-ins).
  root.dataset.ssSmoke = s.smokescreen ? "on" : "off";
}

applySettings().catch(() => undefined);

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (KEYS.enabled in changes ||
      KEYS.categories in changes ||
      KEYS.custom in changes ||
      KEYS.smokescreen in changes)
  ) {
    applySettings().catch(() => undefined);
  }
});

// Fresh page load => clear this tab's badge.
chrome.runtime.sendMessage({ type: "ss-reset" }).catch(() => undefined);

// The guard (MAIN world) posts { source: "ss-guard", category } per new redaction,
// or { source: "ss-guard", kind: "failopen" } when a parse error let a request pass.
window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.origin !== window.location.origin) return;
  const d = ev.data as { source?: string; kind?: string; category?: string } | null;
  if (!d || d.source !== "ss-guard") return;
  if (!contextValid()) {
    showStaleBanner();
    return;
  }
  if (d.kind === "failopen") {
    chrome.runtime.sendMessage({ type: "ss-failopen" }).catch(() => undefined);
  } else if (typeof d.category === "string" && ALL_CATEGORY_KEYS.includes(d.category)) {
    // Only forward known categories: the MAIN world is shared with the page, so any
    // script there can post a spoofed { source: "ss-guard", category }. Rejecting
    // unknown values keeps arbitrary/oversized strings out of the log and badge path.
    chrome.runtime.sendMessage({ type: "ss-redaction", category: d.category }).catch(() => undefined);
  }
});

// Popup status query (tabs.sendMessage from the popup). sendResponse is called
// synchronously, so we must NOT return true (that would leak the message port).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ss-status") {
    const root = document.documentElement;
    sendResponse({
      enabled: root.dataset.ssEnabled !== "off",
      kept: Number(root.dataset.ssKept ?? "0"),
    });
  }
});
