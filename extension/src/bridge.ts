// ISOLATED-world content script: bridges chrome.* <-> the MAIN-world guard.
//   - pushes settings to the page via data-* attributes on <html>
//     (data-ss-enabled, data-ss-cats), which the guard reads
//   - forwards redaction events (category only) from the guard to the background,
//     the single writer for the activity log + badge
//   - answers the popup's status query
// The two worlds share the DOM but not their globals; data-* attrs and
// window.postMessage are the only channels between them.
import { getSettings, KEYS } from "./storage";

async function applySettings(): Promise<void> {
  const s = await getSettings();
  const root = document.documentElement;
  root.dataset.ssEnabled = s.enabled ? "on" : "off";
  root.dataset.ssCats = s.categories.join(",");
}

applySettings().catch(() => undefined);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (KEYS.enabled in changes || KEYS.categories in changes)) {
    applySettings().catch(() => undefined);
  }
});

// Fresh page load => clear this tab's badge.
chrome.runtime.sendMessage({ type: "ss-reset" }).catch(() => undefined);

// The guard (MAIN world) posts { source: "ss-guard", category } per new redaction.
window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.origin !== window.location.origin) return;
  const d = ev.data as { source?: string; category?: string } | null;
  if (!d || d.source !== "ss-guard" || typeof d.category !== "string") return;
  chrome.runtime.sendMessage({ type: "ss-redaction", category: d.category }).catch(() => undefined);
});

// Popup status query (tabs.sendMessage from the popup).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ss-status") {
    const root = document.documentElement;
    sendResponse({
      enabled: root.dataset.ssEnabled !== "off",
      kept: Number(root.dataset.ssKept ?? "0"),
    });
  }
  return true;
});
