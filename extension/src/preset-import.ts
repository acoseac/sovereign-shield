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

/** The catch-all refusal for anything that is not a well-formed v1 code. Deliberately
 *  content-free: refusals must be safe to render verbatim, so they never echo the paste. */
const INVALID = "Not a valid preset code.";

export type PresetParse =
  | { ok: true; rule: CustomRule; name?: string }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Envelope checks: JSON, object shape, version. Returns the outer object or a refusal. */
function parseEnvelope(text: string): Record<string, unknown> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return INVALID;
  }
  if (!isPlainObject(parsed)) return INVALID;
  if (parsed.v !== 1) {
    // A larger integer means the site is emitting a format this build doesn't know yet —
    // tell the user the fix is an update, not a re-paste. Anything else is just not a code.
    return typeof parsed.v === "number" && parsed.v > 1
      ? "This preset needs a newer version of the extension."
      : INVALID;
  }
  return parsed;
}

/** Optional-field type checks, split out of buildRule to keep both under the CC budget. */
function optionalFieldsError(r: Record<string, unknown>): string | null {
  if (r.label !== undefined && typeof r.label !== "string") return INVALID;
  for (const flag of [r.caseSensitive, r.wholeWord]) {
    if (flag !== undefined && typeof flag !== "boolean") return INVALID;
  }
  const id = r.presetId;
  if (id !== undefined && (typeof id !== "string" || !PRESET_ID_RE.test(id))) return INVALID;
  return null;
}

/** Validate the rule payload and whitelist-copy it (see the threat model above). Optional
 *  fields are set only when present and meaningful, so an imported rule serializes as lean
 *  as a hand-typed one. */
function buildRule(value: unknown): CustomRule | string {
  if (!isPlainObject(value)) return INVALID;
  const pattern = typeof value.pattern === "string" ? value.pattern : "";
  if (!pattern.trim()) return "The preset has no pattern.";
  if (pattern.length > MAX_PATTERN) return `Pattern is too long (max ${MAX_PATTERN}).`;
  if (typeof value.isRegex !== "boolean") return INVALID;
  const optErr = optionalFieldsError(value);
  if (optErr) return optErr;
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (label.length > MAX_LABEL) return `Label is too long (max ${MAX_LABEL}).`;
  if (value.isRegex) {
    const lint = lintRegex(pattern);
    if (lint) return lint; // the exact message a hand-typed rule would get
  }
  const out: CustomRule = { pattern, isRegex: value.isRegex };
  if (label) out.label = label;
  if (value.caseSensitive === true) out.caseSensitive = true;
  if (value.wholeWord === false) out.wholeWord = false;
  if (typeof value.presetId === "string") out.presetId = value.presetId;
  return out;
}

/** The optional display name ("Ready to add: X"); over-long or absent degrades to none. */
function displayName(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() && v.length <= 100 ? v.trim() : undefined;
}

/**
 * Parse one pasted preset code into a CustomRule, or a human-readable refusal. Every
 * refusal is safe to render verbatim (static strings, or lintRegex's own messages —
 * never an echo of the pasted content).
 */
export function parsePresetCode(raw: string): PresetParse {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Paste a preset code first." };
  if (text.length > MAX_CODE) {
    return { ok: false, error: "That doesn't look like a preset code (too long)." };
  }
  const outer = parseEnvelope(text);
  if (typeof outer === "string") return { ok: false, error: outer };
  const rule = buildRule(outer.rule);
  if (typeof rule === "string") return { ok: false, error: rule };
  return { ok: true, rule, name: displayName(outer.name) };
}
