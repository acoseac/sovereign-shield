// Background service worker: the only context that can paint the toolbar badge
// and swap the action icon. It is also the single writer for the activity log,
// with a serialised queue so concurrent redactions never race the read-modify-write.
import { appendLog, getSettings, KEYS } from "./storage";

const BADGE_COLOR = "#0E7C66";

const iconPaths = (variant: "" | "paused-"): Record<number, string> => ({
  16: `icons/icon-${variant}16.png`,
  32: `icons/icon-${variant}32.png`,
  48: `icons/icon-${variant}48.png`,
  128: `icons/icon-${variant}128.png`,
});

function applyIcon(enabled: boolean): void {
  void chrome.action.setIcon({ path: iconPaths(enabled ? "" : "paused-") });
}

void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
void getSettings().then((s) => applyIcon(s.enabled));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && KEYS.enabled in changes) {
    applyIcon(changes[KEYS.enabled].newValue !== false);
  }
});

// Serialise badge/log writes (getBadgeText is the source of truth, so counts
// survive service-worker restarts).
let queue: Promise<unknown> = Promise.resolve();
function enqueue(task: () => Promise<unknown>): void {
  queue = queue.then(task).catch(() => undefined);
}

async function bump(tabId: number, category: string, url?: string): Promise<void> {
  const prev = parseInt(await chrome.action.getBadgeText({ tabId }), 10) || 0;
  await chrome.action.setBadgeText({ tabId, text: String(prev + 1) });
  let host = "";
  try {
    host = url ? new URL(url).host : "";
  } catch {
    host = "";
  }
  await appendLog({ c: category, t: Date.now(), h: host });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return;
  if (msg?.type === "ss-reset") {
    void chrome.action.setBadgeText({ tabId, text: "" });
  } else if (msg?.type === "ss-redaction" && typeof msg.category === "string") {
    enqueue(() => bump(tabId, msg.category, sender.tab?.url));
  }
});
