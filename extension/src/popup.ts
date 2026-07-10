// Popup: a guard on/off toggle plus a "kept local" count for the current tab.
const KEY = "ssEnabled";
const SUPPORTED = ["gemini.google.com", "chatgpt.com", "chat.openai.com", "claude.ai"];
const onSupported = (url?: string): boolean => !!url && SUPPORTED.some((h) => url.includes(h));

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
  statusEl.textContent = toggle.checked ? "Active on this tab." : "Paused on this tab.";
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
