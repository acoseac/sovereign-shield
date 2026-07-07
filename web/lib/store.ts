import { Redis } from "@upstash/redis";

export interface Stats {
  runs: number; // documents processed through the gateway
  pieces: number; // total personal-data elements kept on-shore
  byCategory: Record<string, number>;
}

// Accept the Upstash-native names OR the Vercel-KV / Marketplace names — Vercel's
// Upstash integration injects KV_REST_API_URL / KV_REST_API_TOKEN.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
export const isPersistent = Boolean(REDIS_URL && REDIS_TOKEN);
const redis = isPersistent ? new Redis({ url: REDIS_URL as string, token: REDIS_TOKEN as string }) : null;

const KEY = "kevin:gateway";
const CAT_FIELD = (c: string): string => `cat:${c}`;

// In-memory fallback for local dev (per-process; resets on restart, NOT shared).
const mem: Stats = { runs: 0, pieces: 0, byCategory: {} };

export async function recordProcessed(categories: string[]): Promise<void> {
  if (redis) {
    await redis.hincrby(KEY, "runs", 1);
    await redis.hincrby(KEY, "pieces", categories.length);
    for (const c of categories) await redis.hincrby(KEY, CAT_FIELD(c), 1);
    return;
  }
  mem.runs += 1;
  mem.pieces += categories.length;
  for (const c of categories) mem.byCategory[c] = (mem.byCategory[c] ?? 0) + 1;
}

export async function readStats(): Promise<Stats> {
  if (redis) {
    const h = (await redis.hgetall<Record<string, string | number>>(KEY)) ?? {};
    const byCategory: Record<string, number> = {};
    for (const [k, v] of Object.entries(h)) {
      if (k.startsWith("cat:")) byCategory[k.slice(4)] = Number(v);
    }
    return { runs: Number(h.runs ?? 0), pieces: Number(h.pieces ?? 0), byCategory };
  }
  return { runs: mem.runs, pieces: mem.pieces, byCategory: { ...mem.byCategory } };
}
