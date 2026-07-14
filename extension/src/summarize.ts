// Pure, DOM-free summary of what the guard WOULD keep local for a given piece of
// composer text — the data behind the pre-send indicator pill. Kept separate from
// indicator.ts (the DOM content script) so this logic is unit-testable in plain Node
// and never runs page side effects on import.
import { detectPii } from "../../web/lib/shield.ts";
import { CATEGORY_LABEL } from "./categories.ts";

export interface Summary {
  /** Distinct identifier VALUES that would be redacted (mirrors the guard's per-value
   *  dedup and Session.count — the same number typed twice counts once). */
  count: number;
  /** Human labels of the categories present, sorted, for the pill text. */
  categories: string[];
}

/**
 * Count the checksum-valid identifiers in `text` that the guard would tokenize.
 *
 * Mirrors the guard exactly: detectPii runs WITHOUT date-of-birth (the extension never
 * redacts DOB — see tokenize.ts), and `allowed` filters categories the same way
 * Session.tokenize does. When `allowed` is undefined, every category counts.
 */
export function summarize(text: string, allowed: ReadonlySet<string> | undefined): Summary {
  const kept = detectPii(text).filter((h) => !allowed || allowed.has(h.category));
  const count = new Set(kept.map((h) => text.slice(h.start, h.end))).size;
  const categories = [...new Set(kept.map((h) => CATEGORY_LABEL[h.category] ?? h.category))].sort();
  return { count, categories };
}
