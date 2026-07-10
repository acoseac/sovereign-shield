// Shared storage schema for the chrome.*-capable contexts (bridge, background,
// options, popup). The MAIN-world interceptor never imports this — it has no
// chrome.* access and only ever reads config off data-* attributes.
//
// Privacy: the activity log stores category + time + host ONLY. No values, not
// even masked. The value<->token map lives in page memory and is never persisted.
import { ALL_CATEGORY_KEYS } from "./categories";

export const KEYS = {
  enabled: "ssEnabled", // boolean, default true
  categories: "ssCats", // string[] of enabled category keys
  log: "ssLog", // LogEntry[]
} as const;

export const LOG_CAP = 200;

export interface LogEntry {
  c: string; // category key
  t: number; // timestamp (ms since epoch)
  h: string; // host, e.g. "gemini.google.com"
}

export interface Settings {
  enabled: boolean;
  categories: string[]; // enabled category keys
}

export async function getSettings(): Promise<Settings> {
  const v = await chrome.storage.local.get([KEYS.enabled, KEYS.categories]);
  return {
    enabled: v[KEYS.enabled] !== false, // default ON
    categories: Array.isArray(v[KEYS.categories]) ? v[KEYS.categories] : [...ALL_CATEGORY_KEYS],
  };
}

export async function appendLog(entry: LogEntry): Promise<void> {
  const v = await chrome.storage.local.get(KEYS.log);
  const log: LogEntry[] = Array.isArray(v[KEYS.log]) ? v[KEYS.log] : [];
  log.push(entry);
  if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP); // rolling window
  await chrome.storage.local.set({ [KEYS.log]: log });
}

export async function readLog(): Promise<LogEntry[]> {
  const v = await chrome.storage.local.get(KEYS.log);
  return Array.isArray(v[KEYS.log]) ? v[KEYS.log] : [];
}

export async function clearLog(): Promise<void> {
  await chrome.storage.local.remove(KEYS.log);
}
