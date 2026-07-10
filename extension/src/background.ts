// Background service worker: the only context that can paint the toolbar badge
// and swap the action icon. Badge updates are immediate; activity-log writes are
// buffered and flushed in batches so a paste with many identifiers doesn't hit
// chrome.storage's write-rate limit.
import { appendLogBatch, getSettings, KEYS, type LogEntry } from "./storage";

const BADGE_COLOR = "#0E7C66";
const ALERT_COLOR = "#B91C1C";

const iconPaths = (variant: "" | "paused-"): Record<number, string> => ({
  16: `icons/icon-${variant}16.png`,
  32: `icons/icon-${variant}32.png`,
  48: `icons/icon-${variant}48.png`,
  128: `icons/icon-${variant}128.png`,
});

function applyIcon(enabled: boolean): void {
  chrome.action.setIcon({ path: iconPaths(enabled ? "" : "paused-") }).catch(() => undefined);
}

chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => undefined);
getSettings()
  .then((s) => applyIcon(s.enabled))
  .catch(() => undefined);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && KEYS.enabled in changes) {
    applyIcon(changes[KEYS.enabled].newValue !== false);
  }
});

// Serialise storage writes so batched flushes never race the read-modify-write.
let queue: Promise<unknown> = Promise.resolve();
function enqueue(task: () => Promise<unknown>): void {
  queue = queue.then(task).catch(() => undefined);
}

// Buffer log entries and flush on a short debounce (or when the burst is large).
const pending: LogEntry[] = [];
let flushScheduled = false;
function flushNow(): void {
  flushScheduled = false;
  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  enqueue(() => appendLogBatch(batch));
}
function scheduleFlush(): void {
  if (pending.length >= 25) {
    flushNow();
    return;
  }
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flushNow, 800);
}

async function bumpBadge(tabId: number): Promise<void> {
  const prev = Number.parseInt(await chrome.action.getBadgeText({ tabId }), 10) || 0;
  await chrome.action.setBadgeText({ tabId, text: String(prev + 1) });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return;
  if (msg?.type === "ss-reset") {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }).catch(() => undefined);
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
  } else if (msg?.type === "ss-failopen") {
    // A parse error let a request through unredacted — make it loud.
    chrome.action.setBadgeBackgroundColor({ tabId, color: ALERT_COLOR }).catch(() => undefined);
    chrome.action.setBadgeText({ tabId, text: "!" }).catch(() => undefined);
  } else if (msg?.type === "ss-redaction" && typeof msg.category === "string") {
    enqueue(() => bumpBadge(tabId));
    let host = "";
    try {
      host = sender.tab?.url ? new URL(sender.tab.url).host : "";
    } catch {
      host = "";
    }
    pending.push({ c: msg.category, t: Date.now(), h: host });
    scheduleFlush();
  }
});
