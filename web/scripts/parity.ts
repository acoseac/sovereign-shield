// Parity gate: assert the TypeScript shield reproduces the Python shield exactly.
// Vectors are generated from the Python source (scripts/gen_shield_vectors.py).
// Run:  node web/scripts/parity.ts   (Node >= 22.18 strips types natively)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPii, scanCompletion, scanPrompt } from "../lib/shield.ts";

interface Vector {
  input: string;
  contained_pii: string;
  detect_pii: { category: string; marker: string; start: number; end: number }[];
  scan_completion: { blocked: boolean; raw_violation: boolean; reason: string; categories: string[] };
  scan_prompt: { blocked: boolean; reason: string; categories: string[] };
}

const here = dirname(fileURLToPath(import.meta.url));
const vectors: Vector[] = JSON.parse(
  readFileSync(join(here, "..", "lib", "shield", "parity-vectors.json"), "utf8"),
);

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
let failures = 0;

for (const v of vectors) {
  const dp = detectPii(v.input).map((h) => ({
    category: h.category as string,
    marker: h.marker,
    start: h.start,
    end: h.end,
  }));
  if (!eq(dp, v.detect_pii)) {
    failures++;
    console.error(`detectPii mismatch for ${JSON.stringify(v.input)}`);
    console.error(`  py: ${JSON.stringify(v.detect_pii)}`);
    console.error(`  ts: ${JSON.stringify(dp)}`);
  }

  const sc = scanCompletion(v.input, v.contained_pii);
  const scGot = {
    blocked: sc.blocked,
    raw_violation: sc.rawViolation,
    reason: sc.reason,
    categories: sc.categories,
  };
  if (!eq(scGot, v.scan_completion)) {
    failures++;
    console.error(`scanCompletion mismatch for ${JSON.stringify(v.input)}`);
    console.error(`  py: ${JSON.stringify(v.scan_completion)}`);
    console.error(`  ts: ${JSON.stringify(scGot)}`);
  }

  const sp = scanPrompt(v.input);
  const spGot = { blocked: sp.blocked, reason: sp.reason, categories: sp.categories };
  if (!eq(spGot, v.scan_prompt)) {
    failures++;
    console.error(`scanPrompt mismatch for ${JSON.stringify(v.input)}`);
    console.error(`  py: ${JSON.stringify(v.scan_prompt)}`);
    console.error(`  ts: ${JSON.stringify(spGot)}`);
  }
}

if (failures) {
  console.error(`\n❌ shield parity FAILED: ${failures} mismatch(es) across ${vectors.length} vectors`);
  process.exit(1);
}
console.log(`✅ shield parity OK: TS matches Python on all ${vectors.length} vectors`);
