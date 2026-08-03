// Lifetime aggregate behind "Protected so far" (options page) and the all-time line in the
// popup. COUNTS ONLY — a category key, a hostname, a local date, a number. Never a value,
// never prompt text: the same privacy contract as the activity log (storage.ts), restated
// on the options page and in the public privacy policy.
//
// Why this exists separately from the log: ssLog is a rolling LOG_CAP-entry diagnostic
// window, so lifetime totals cannot be derived from it. This module owns a small
// accumulator that only grows, plus a sliding window of daily counts for the chart.
//
// Ownership rules, load-bearing:
//   - The BACKGROUND WORKER is the single writer of STATS_KEY, inside the same enqueue()
//     promise queue as the log flush. A read-modify-write from a second context would race
//     the fold and drop counts.
//   - STATS_KEY is deliberately NOT in storage.ts KEYS: stats are not a setting, and the
//     bridge must never mirror them onto data-ss-* attributes — the MAIN world has no use
//     for them.
//   - STATS_SEEN_KEY is the one exception to "background writes": a pure UI cursor (the
//     highest milestone the user has dismissed), owned by the options page. Different key,
//     different writer — no contention.
//
// The fold logic is pure so it unit-tests in plain Node (strip-only TS: no enums).
import type { LogEntry } from "./storage";

export const STATS_KEY = "ssStats";
export const STATS_SEEN_KEY = "ssStatsSeen";

/** Daily buckets kept for the chart. Lifetime totals live in their own accumulators, so
 *  pruning a bucket never loses a count — only chart resolution older than ~3 months. */
export const DAY_RETENTION = 90;

/** Quiet thresholds for the milestone line. No streaks, no badges — one understated,
 *  dismissible callout when a boundary is crossed, then back to a static "next" line. */
export const MILESTONES = [100, 1_000, 10_000, 100_000] as const;

export interface Stats {
  v: 1;
  total: number; // lifetime count, never pruned
  cats: Record<string, number>; // category key → lifetime count
  sites: Record<string, number>; // host → lifetime count (only supported hosts can occur)
  days: Record<string, number>; // "YYYY-MM-DD" LOCAL date → count, pruned to DAY_RETENTION
  since: number; // ms epoch counting started (earliest folded entry, or the reset time)
}

/**
 * Local-date bucket key. Local on purpose: the chart answers "what did MY Tuesday look
 * like", and UTC would file an evening redaction under tomorrow for anyone west of UTC.
 * The cost is one cosmetically long/short bucket twice a year around DST.
 */
export function dayKey(t: number): string {
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function freshStats(now: number): Stats {
  return { v: 1, total: 0, cats: {}, sites: {}, days: {}, since: now };
}

/** Copy a stored counter map, rejecting anything that is not { string: finite number ≥ 0 }. */
function copyCounts(v: unknown): Record<string, number> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(v)) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    out[key] = n;
  }
  return out;
}

/**
 * Parse a stored value back into Stats, or null on any surprise (wrong version, wrong
 * shape, corrupted counts). Callers start fresh rather than guessing: losing a corrupt
 * aggregate once beats folding new counts into garbage forever.
 */
export function normalizeStats(v: unknown): Stats | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  if (s.v !== 1) return null;
  if (typeof s.total !== "number" || !Number.isFinite(s.total) || s.total < 0) return null;
  if (typeof s.since !== "number" || !Number.isFinite(s.since)) return null;
  const cats = copyCounts(s.cats);
  const sites = copyCounts(s.sites);
  const days = copyCounts(s.days);
  if (!cats || !sites || !days) return null;
  return { v: 1, total: s.total, cats, sites, days, since: s.since };
}

/**
 * Fold a batch of log entries into the stored aggregate (or a fresh one when the stored
 * value is absent or corrupt). Pure and deterministic given `now`; the background worker
 * is the only caller that persists the result. Malformed entries are skipped, never
 * allowed to poison the aggregate — the background validates categories before buffering,
 * but the fold does not rely on that.
 */
export function foldStats(prev: unknown, entries: readonly LogEntry[], now = Date.now()): Stats {
  const out = normalizeStats(prev) ?? freshStats(now);
  for (const e of entries) {
    if (typeof e?.c !== "string" || e.c === "") continue;
    if (typeof e.t !== "number" || !Number.isFinite(e.t)) continue;
    out.total += 1;
    out.cats[e.c] = (out.cats[e.c] ?? 0) + 1;
    const host = typeof e.h === "string" && e.h !== "" ? e.h : "unknown";
    out.sites[host] = (out.sites[host] ?? 0) + 1;
    const day = dayKey(e.t);
    out.days[day] = (out.days[day] ?? 0) + 1;
    if (e.t < out.since) out.since = e.t;
  }
  // Prune the day window. ISO-shaped keys sort lexicographically = chronologically; the
  // explicit ASCII comparator (not localeCompare — these are machine keys, not words)
  // keeps that independent of any locale and satisfies the type-dependent-sort rule.
  const keys = Object.keys(out.days).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i < keys.length - DAY_RETENTION; i++) delete out.days[keys[i]];
  return out;
}

/**
 * The chart series: the last `n` local days ending today, zero-filled. Day stepping goes
 * through the Date constructor (day − i) rather than `now − i·86 400 000` so a DST
 * transition cannot skip or repeat a label.
 */
export function lastNDays(
  stats: Stats,
  n: number,
  now = Date.now(),
): Array<{ key: string; count: number }> {
  const today = new Date(now);
  const out: Array<{ key: string; count: number }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dayKey(day.getTime());
    out.push({ key, count: stats.days[key] ?? 0 });
  }
  return out;
}

/** Highest milestone at or below `total`, or null before the first one. */
export function lastMilestone(total: number): number | null {
  let hit: number | null = null;
  for (const m of MILESTONES) if (total >= m) hit = m;
  return hit;
}

/** Next milestone above `total`, or null past the last one. */
export function nextMilestone(total: number): number | null {
  for (const m of MILESTONES) if (total < m) return m;
  return null;
}

// --- chrome.storage wrappers (the pure core above is what's unit-tested) ----

export async function readStats(): Promise<Stats | null> {
  const v = await chrome.storage.local.get(STATS_KEY);
  return normalizeStats(v[STATS_KEY]);
}

export async function writeStats(stats: Stats): Promise<void> {
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}
