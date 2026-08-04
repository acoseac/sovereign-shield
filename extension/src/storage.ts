// Shared storage schema for the chrome.*-capable contexts (bridge, background,
// options, popup). The MAIN-world interceptor never imports this — it has no
// chrome.* access and only ever reads config off data-* attributes.
//
// Privacy: the activity log stores category + time + host ONLY. No values, not
// even masked. The value<->token map lives in page memory and is never persisted.
import { ALL_CATEGORY_KEYS } from "./categories";
import type { CustomRule } from "./custom";
import { isThemeId, type ThemeId } from "./surrogate";

export const KEYS = {
  enabled: "ssEnabled", // boolean, default true
  categories: "ssCats", // string[] of enabled category keys
  custom: "ssCustom", // CustomRule[] — user keyword/regex blocklist
  smokescreen: "ssSmokescreen", // boolean, default FALSE — see Settings below
  theme: "ssTheme", // ThemeId — which pools smokescreen stand-ins draw from
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
  custom: CustomRule[]; // user keyword/regex blocklist (empty by default)
  /** Swap real values for realistic stand-ins instead of [EMAIL_1] placeholders.
   *  Default FALSE — unlike `enabled`, which fails safe by defaulting ON, this one changes
   *  what the model actually sees, so it stays off until the user opts in. */
  smokescreen: boolean;
  /** Which pools the stand-ins draw from (only meaningful while smokescreen is on).
   *  Purely presentational — it can never change WHICH categories take stand-ins. */
  theme: ThemeId;
}

export async function getSettings(): Promise<Settings> {
  const v = await chrome.storage.local.get([
    KEYS.enabled,
    KEYS.categories,
    KEYS.custom,
    KEYS.smokescreen,
    KEYS.theme,
  ]);
  return {
    enabled: v[KEYS.enabled] !== false, // default ON
    categories: Array.isArray(v[KEYS.categories]) ? v[KEYS.categories] : [...ALL_CATEGORY_KEYS],
    custom: Array.isArray(v[KEYS.custom]) ? (v[KEYS.custom] as CustomRule[]) : [],
    smokescreen: v[KEYS.smokescreen] === true, // default OFF
    theme: isThemeId(v[KEYS.theme]) ? v[KEYS.theme] : "plain", // garbage degrades to plain
  };
}

export async function appendLog(entry: LogEntry): Promise<void> {
  await appendLogBatch([entry]);
}

/** Append many entries in a single read-modify-write (batched to respect the
 *  chrome.storage write-rate limit when many identifiers land at once). */
export async function appendLogBatch(entries: LogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const v = await chrome.storage.local.get(KEYS.log);
  let log: LogEntry[] = Array.isArray(v[KEYS.log]) ? v[KEYS.log] : [];
  log.push(...entries);
  if (log.length > LOG_CAP) log = log.slice(-LOG_CAP); // rolling window
  await chrome.storage.local.set({ [KEYS.log]: log });
}

export async function readLog(): Promise<LogEntry[]> {
  const v = await chrome.storage.local.get(KEYS.log);
  return Array.isArray(v[KEYS.log]) ? v[KEYS.log] : [];
}

export async function clearLog(): Promise<void> {
  await chrome.storage.local.remove(KEYS.log);
}
