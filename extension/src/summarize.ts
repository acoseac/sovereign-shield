// Pure, DOM-free summary of what the guard WOULD keep local for a given piece of
// composer text — the data behind the pre-send indicator pill. Kept separate from
// indicator.ts (the DOM content script) so this logic is unit-testable in plain Node
// and never runs page side effects on import.
import { detectPii } from "../../web/lib/shield.ts";
import { CATEGORY_LABEL } from "./categories.ts";
import { acceptCustomHits, type CustomMatcher } from "./custom.ts";

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
export function summarize(
  text: string,
  allowed: ReadonlySet<string> | undefined,
  customMatcher?: CustomMatcher,
): Summary {
  const builtin = detectPii(text).filter((h) => !allowed || allowed.has(h.category));
  const values = new Set(builtin.map((h) => text.slice(h.start, h.end)));
  const labels = new Set(builtin.map((h) => CATEGORY_LABEL[h.category] ?? h.category));
  if (customMatcher && (!allowed || allowed.has("custom"))) {
    const spans = builtin.map((h) => [h.start, h.end] as [number, number]);
    for (const c of acceptCustomHits(text, spans, customMatcher)) {
      values.add(text.slice(c.start, c.end));
      // The rule's own label (e.g. "Project Apollo") for clarity; never the matched value.
      labels.add(c.label?.trim() ? c.label : (CATEGORY_LABEL.custom ?? "Custom terms"));
    }
  }
  return { count: values.size, categories: [...labels].sort((a, b) => a.localeCompare(b)) };
}
