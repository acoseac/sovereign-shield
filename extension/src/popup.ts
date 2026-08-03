// Popup: a guard on/off toggle plus a "kept local" count for the current tab.
import { KEYS } from "./storage";
import { isSupportedHost } from "./sites";
import { readStats } from "./stats";

const KEY = KEYS.enabled;
// Parse the URL and match on the hostname — never a substring test, or
// "evil.example/?ref=chatgpt.com" would read as a supported site. The list itself lives in
// sites.ts so it cannot drift from the transport hooks.
const onSupported = (urlStr?: string): boolean => {
  if (!urlStr) return false;
  try {
    return isSupportedHost(new URL(urlStr).hostname);
  } catch {
    return false;
  }
};

const toggle = document.getElementById("toggle") as HTMLInputElement;
const keptEl = document.getElementById("kept") as HTMLElement;
const lifetimeEl = document.getElementById("lifetime") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refresh(): Promise<void> {
  const stored = await chrome.storage.local.get(KEY);
  toggle.checked = stored[KEY] !== false;

  // Lifetime total is global (background-owned aggregate, counts only), so it renders
  // before the per-tab early-return below — it's meaningful on unsupported pages too.
  const stats = await readStats();
  lifetimeEl.textContent = (stats?.total ?? 0).toLocaleString();

  const tab = await activeTab();
  if (!tab?.id || !onSupported(tab.url)) {
    statusEl.textContent = "Open Gemini, ChatGPT or Claude to use the guard.";
    keptEl.textContent = "—";
    return;
  }
  // The toggle is global (one ssEnabled key); the count below it is per-tab. The status line
  // has to distinguish them — copy scoped to "this tab" would let someone pause for a single
  // chat and unknowingly drop the guard everywhere else.
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
