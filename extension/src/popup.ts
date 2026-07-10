// Popup: a guard on/off toggle plus a "kept local" count for the current tab.
const KEY = "ssEnabled";

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
  if (!tab?.id || !tab.url?.includes("gemini.google.com")) {
    statusEl.textContent = "Open gemini.google.com to use the guard.";
    keptEl.textContent = "—";
    return;
  }
  statusEl.textContent = toggle.checked ? "Active on this Gemini tab." : "Paused on this tab.";
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "ss-status" })) as {
      kept?: number;
    };
    keptEl.textContent = String(res?.kept ?? 0);
  } catch {
    // Content script not ready (e.g. tab opened before install) — reload to attach.
    keptEl.textContent = "0";
    statusEl.textContent = "Reload the Gemini tab to attach the guard.";
  }
}

toggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ [KEY]: toggle.checked });
  await refresh();
});

document.getElementById("opts")?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

refresh();
