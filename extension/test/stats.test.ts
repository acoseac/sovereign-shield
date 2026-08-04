// Tests for the pure stats fold — the lifetime aggregate behind "Protected so far".
//
// TZ is pinned BEFORE the first Date use: dayKey() buckets by LOCAL date on purpose (the
// chart answers "what did my Tuesday look like", not "what happened in UTC"), so the
// expected keys below are only stable if the test process agrees on what "local" means.
// node --test runs each file in its own process, so this cannot leak into other suites.
process.env.TZ = "Europe/Zurich";

import assert from "node:assert/strict";
import test from "node:test";

import {
  DAY_RETENTION,
  MILESTONES,
  dayKey,
  foldStats,
  freshStats,
  lastMilestone,
  lastNDays,
  nextMilestone,
  normalizeStats,
} from "../src/stats.ts";
import type { LogEntry } from "../src/storage.ts";

const entry = (c: string, t: number, h = "chatgpt.com"): LogEntry => ({ c, t, h });

// 2026-07-15 10:00 UTC = 12:00 in Zurich (UTC+2 in July).
const NOON = Date.UTC(2026, 6, 15, 10, 0, 0);
const DAY = 86_400_000;

// --- dayKey: local buckets ---------------------------------------------------

test("dayKey buckets by the LOCAL date, not the UTC date", () => {
  assert.equal(dayKey(NOON), "2026-07-15");
  // 22:30 UTC on the 14th is already 00:30 on the 15th in Zurich — the whole point of
  // local bucketing: late-evening activity lands on the day the user experienced.
  assert.equal(dayKey(Date.UTC(2026, 6, 14, 22, 30, 0)), "2026-07-15");
  // And 21:30 UTC is still 23:30 local on the 14th.
  assert.equal(dayKey(Date.UTC(2026, 6, 14, 21, 30, 0)), "2026-07-14");
});

// --- foldStats: accumulation ---------------------------------------------------

test("folding accumulates total, categories, sites and day buckets", () => {
  const s1 = foldStats(null, [entry("email", NOON), entry("iban", NOON)], NOON);
  const s2 = foldStats(s1, [entry("email", NOON + DAY, "claude.ai")], NOON + DAY);
  assert.equal(s2.total, 3);
  assert.deepEqual(s2.cats, { email: 2, iban: 1 });
  assert.deepEqual(s2.sites, { "chatgpt.com": 2, "claude.ai": 1 });
  assert.deepEqual(s2.days, { "2026-07-15": 2, "2026-07-16": 1 });
});

test("folding an empty batch is a no-op on the counts", () => {
  const s1 = foldStats(null, [entry("email", NOON)], NOON);
  const s2 = foldStats(s1, [], NOON + DAY);
  assert.deepEqual(s2, s1);
});

test("malformed entries are skipped, never poisoning the aggregate", () => {
  const bad = [
    { c: "", t: NOON, h: "x" },
    { c: "email", t: Number.NaN, h: "x" },
    { c: 7, t: NOON, h: "x" },
    null,
  ] as unknown as LogEntry[];
  const s = foldStats(null, [...bad, entry("email", NOON)], NOON);
  assert.equal(s.total, 1);
  assert.deepEqual(s.cats, { email: 1 });
});

test("an entry with no host counts under 'unknown' rather than being dropped", () => {
  const s = foldStats(null, [entry("email", NOON, "")], NOON);
  assert.equal(s.total, 1);
  assert.deepEqual(s.sites, { unknown: 1 });
});

// --- foldStats: recovery from a corrupt store ----------------------------------

test("a malformed stored value starts fresh and the batch still counts", () => {
  for (const prev of [null, undefined, 42, "x", [], {}, { v: 2 }, { v: 1, total: "9" }]) {
    const s = foldStats(prev, [entry("email", NOON)], NOON);
    assert.equal(s.v, 1);
    assert.equal(s.total, 1, `prev=${JSON.stringify(prev)} must not block counting`);
  }
});

test("a corrupted counter map (negative / non-numeric) rejects the whole store", () => {
  const rotten = { v: 1, total: 5, cats: { email: -2 }, sites: {}, days: {}, since: NOON };
  assert.equal(normalizeStats(rotten), null);
  // …and folding on top of it starts a fresh aggregate rather than trusting `total: 5`.
  assert.equal(foldStats(rotten, [entry("email", NOON)], NOON).total, 1);
});

test("normalizeStats round-trips a folded aggregate", () => {
  const s = foldStats(null, [entry("email", NOON), entry("iban", NOON + DAY)], NOON);
  assert.deepEqual(normalizeStats(JSON.parse(JSON.stringify(s))), s);
});

// --- foldStats: retention ------------------------------------------------------

test("day buckets prune past DAY_RETENTION while lifetime totals survive", () => {
  const span = DAY_RETENTION + 5;
  const entries = Array.from({ length: span }, (_, i) => entry("email", NOON + i * DAY));
  const s = foldStats(null, entries, NOON + span * DAY);
  assert.equal(Object.keys(s.days).length, DAY_RETENTION, "window must be capped");
  assert.equal(s.total, span, "pruning a bucket must never lose a lifetime count");
  const keys = Object.keys(s.days).sort();
  assert.equal(keys[0], dayKey(NOON + 5 * DAY), "the OLDEST buckets are the ones dropped");
});

// --- foldStats: since ------------------------------------------------------------

test("since is the earliest counted entry and only ever moves backwards", () => {
  const s1 = foldStats(null, [entry("email", NOON)], NOON + DAY);
  assert.equal(s1.since, NOON);
  const s2 = foldStats(s1, [entry("email", NOON + 3 * DAY)], NOON + 3 * DAY);
  assert.equal(s2.since, NOON, "a later entry must not advance since");
  const s3 = foldStats(s2, [entry("email", NOON - DAY)], NOON + 3 * DAY);
  assert.equal(s3.since, NOON - DAY, "an earlier entry (seeded history) may lower it");
});

test("freshStats carries the reset moment as since", () => {
  assert.equal(freshStats(NOON).since, NOON);
  assert.equal(freshStats(NOON).total, 0);
});

// --- chart series ----------------------------------------------------------------

test("lastNDays returns n zero-filled buckets ending today", () => {
  const s = foldStats(null, [entry("email", NOON), entry("email", NOON - 2 * DAY)], NOON);
  const series = lastNDays(s, 7, NOON);
  assert.equal(series.length, 7);
  assert.equal(series[6].key, "2026-07-15");
  assert.equal(series[6].count, 1);
  assert.equal(series[4].count, 1, "two days ago");
  assert.equal(series[5].count, 0, "an empty day is present with a zero, not missing");
  assert.equal(series[0].key, "2026-07-09");
});

// --- milestones --------------------------------------------------------------------

test("milestone helpers at the boundaries", () => {
  assert.equal(lastMilestone(99), null);
  assert.equal(lastMilestone(100), 100);
  assert.equal(lastMilestone(101), 100);
  assert.equal(lastMilestone(999), 100);
  assert.equal(lastMilestone(1000), 1000);
  assert.equal(nextMilestone(0), 100);
  assert.equal(nextMilestone(100), 1000);
  assert.equal(nextMilestone(999), 1000);
  const top = MILESTONES[MILESTONES.length - 1];
  assert.equal(nextMilestone(top), null, "past the last milestone there is no next");
  assert.equal(lastMilestone(top + 1), top);
});

// --- determinism ---------------------------------------------------------------------

test("the fold is deterministic given the same inputs", () => {
  const entries = [entry("email", NOON), entry("iban", NOON + DAY, "claude.ai")];
  assert.deepEqual(foldStats(null, entries, NOON), foldStats(null, entries, NOON));
});
