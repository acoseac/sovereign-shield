// Popup: a guard on/off toggle plus a "kept local" count for the current tab.
import { KEYS } from "./storage";

const KEY = KEYS.enabled;
const SUPPORTED = ["gemini.google.com", "chatgpt.com", "chat.openai.com", "claude.ai"];
// Match on the parsed hostname, not a substring: otherwise a URL like
// "evil.example/?ref=chatgpt.com" would read as a supported site.
const onSupported = (urlStr?: string): boolean => {
  if (!urlStr) return false;
  try {
    const { hostname } = new URL(urlStr);
    return SUPPORTED.some((h) => hostname === h || hostname.endsWith("." + h));
  } catch {
    return false;
  }
};

const toggle = document.getElementById("toggle") as HTMLInputElement;
const keptEl = document.getElementById("kept") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refresh(): Promise<void> {
  const stored = await chrome.storage.local.get(KEY);
  toggle.checked = stored[KEY] !== false;

  const tab = await activeTab();
  if (!tab?.id || !onSupported(tab.url)) {
    statusEl.textContent = "Open Gemini, ChatGPT or Claude to use the guard.";
    keptEl.textContent = "—";
    return;
  }
  // The toggle is GLOBAL (one ssEnabled key), while the count below it is per-tab. Say so:
  // the old copy read "Paused on this tab.", so someone pausing to paste one thing into one
  // chat would drop the guard on every other tab without being told.
  statusEl.textContent = toggle.checked
    ? "Active here and on every supported site."
    : "Paused everywhere — on your other tabs too.";
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "ss-status" })) as {
      kept?: number;
    };
    keptEl.textContent = String(res?.kept ?? 0);
  } catch {
    // Content script not ready (e.g. tab opened before install) — reload to attach.
    keptEl.textContent = "0";
    statusEl.textContent = "Reload this tab to attach the guard.";
  }
}

toggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ [KEY]: toggle.checked });
  await refresh();
});

document.getElementById("opts")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage().catch(() => undefined);
});

refresh();
