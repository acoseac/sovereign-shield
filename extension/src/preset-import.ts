// Parser for preset codes pasted from https://shield.ars.md/extension/presets. Pure and
// DOM-free — options.ts is the UI shell.
//
// THREAT MODEL. The input is untrusted clipboard text; the transport is the user's own
// copy/paste, chosen deliberately over any site↔extension channel (no externally_connectable,
// no fetch, no message port — nothing a web page can push into the guard). What bounds a
// hostile paste:
//   - JSON.parse only — no eval, no Function, no remote anything.
//   - Length caps BEFORE parsing (MAX_CODE) and per-field after (MAX_PATTERN / MAX_LABEL,
//     the same caps hand-typed rules obey).
//   - Regex rules pass the identical save-time gate as hand-typed rules (lintRegex: nested
//     quantifier rejection + validity), and the match-time caps in custom.ts still apply.
//   - The output is a FRESH object built field-by-field from validated primitives — never a
//     spread of the parsed value, so unknown keys and __proto__-shaped payloads cannot reach
//     chrome.storage. (JSON.parse never builds a polluted prototype, but the whitelist makes
//     that a non-reliance.)
//   - Rendering of name/label in options.ts is textContent-only, so display copy cannot
//     inject markup.
// Worst case of a hostile-but-lint-passing pattern is the same as any user-authored rule:
// over-redaction of the user's own prompt, behind the guard's fail-open.
import { MAX_LABEL, MAX_PATTERN, lintRegex, type CustomRule } from "./custom.ts";

/** Far above any legitimate preset (the longest shipped code is ~400 chars); blocks
 *  accidental novel-sized pastes before JSON.parse ever sees them. */
export const MAX_CODE = 2000;

/** Slugs only — this travels into storage and back out into "Added/Updated" UI copy. */
const PRESET_ID_RE = /^[a-z0-9-]{1,64}$/;

export type PresetParse =
  | { ok: true; rule: CustomRule; name?: string }
  | { ok: false; error: string };

const fail = (error: string): PresetParse => ({ ok: false, error });

/**
 * Parse one pasted preset code into a CustomRule, or a human-readable refusal. Every
 * refusal is safe to render verbatim (static strings, or lintRegex's own messages —
 * never an echo of the pasted content).
 */
export function parsePresetCode(raw: string): PresetParse {
  const text = raw.trim();
  if (!text) return fail("Paste a preset code first.");
  if (text.length > MAX_CODE) return fail("That doesn't look like a preset code (too long).");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("Not a valid preset code.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("Not a valid preset code.");
  }
  const outer = parsed as Record<string, unknown>;

  if (outer.v !== 1) {
    // A larger integer means the site is emitting a format this build doesn't know yet —
    // tell the user the fix is an update, not a re-paste. Anything else is just not a code.
    return typeof outer.v === "number" && outer.v > 1
      ? fail("This preset needs a newer version of the extension.")
      : fail("Not a valid preset code.");
  }

  const name =
    typeof outer.name === "string" && outer.name.trim() && outer.name.length <= 100
      ? outer.name.trim()
      : undefined;

  const rule = outer.rule;
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    return fail("Not a valid preset code.");
  }
  const r = rule as Record<string, unknown>;

  const pattern = typeof r.pattern === "string" ? r.pattern : "";
  if (!pattern.trim()) return fail("The preset has no pattern.");
  if (pattern.length > MAX_PATTERN) return fail(`Pattern is too long (max ${MAX_PATTERN}).`);
  if (typeof r.isRegex !== "boolean") return fail("Not a valid preset code.");
  if (r.label !== undefined && typeof r.label !== "string") return fail("Not a valid preset code.");
  const label = typeof r.label === "string" ? r.label.trim() : "";
  if (label.length > MAX_LABEL) return fail(`Label is too long (max ${MAX_LABEL}).`);
  for (const flag of [r.caseSensitive, r.wholeWord]) {
    if (flag !== undefined && typeof flag !== "boolean") return fail("Not a valid preset code.");
  }
  if (r.presetId !== undefined && (typeof r.presetId !== "string" || !PRESET_ID_RE.test(r.presetId))) {
    return fail("Not a valid preset code.");
  }

  if (r.isRegex === true) {
    const lint = lintRegex(pattern);
    if (lint) return fail(lint); // the exact message a hand-typed rule would get
  }

  // Whitelist copy — see the threat model above. Optional fields are set only when present
  // and meaningful, so an imported rule serializes as lean as a hand-typed one.
  const out: CustomRule = { pattern, isRegex: r.isRegex };
  if (label) out.label = label;
  if (r.caseSensitive === true) out.caseSensitive = true;
  if (r.wholeWord === false) out.wholeWord = false;
  if (typeof r.presetId === "string") out.presetId = r.presetId;
  return { ok: true, rule: out, name };
}
