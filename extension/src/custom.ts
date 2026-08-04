// User-defined custom keyword / regex blocklist — extension-only (NOT part of the
// parity-locked shield). Turns a user's rules into a matcher the guard runs alongside
// the built-in detectors. Two hard constraints shape everything here:
//
//   1. It must NEVER hang or block a send (the load-bearing guard invariant). User
//      regex is the only thing that can ReDoS, so: literal is the default, regex is an
//      explicit opt-in, catastrophic patterns are rejected at SAVE time (lintRegex,
//      called from options.ts — kept off the send path), and at match time we cap the
//      input size and match count and fail open on any throw.
//   2. It must never leak the matched value. Matches carry only the rule's `label`
//      (user-authored metadata) — never a byte of the matched text — and the activity
//      log stays category-only (see bridge.ts / background.ts).

export interface CustomRule {
  pattern: string;
  isRegex: boolean;
  label?: string;
  caseSensitive?: boolean;
  /** Literal rules only; default true. Match on ASCII word boundaries so a short code
   *  name ("Apollo") doesn't rewrite the middle of a longer identifier ("ApolloSvc"). */
  wholeWord?: boolean;
  /** Set only on rules imported from the shield.ars.md preset library (its stable slug).
   *  Lets a re-import of a REVISED preset update the existing rule in place instead of
   *  stacking a duplicate with the stale pattern. Cleared the moment the user hand-edits
   *  the pattern — the rule is theirs then, and a later re-import must not overwrite it.
   *  Ignored by matching; never anything but a slug. */
  presetId?: string;
}

/** One custom match. `label` is the rule's label (for the pill) — never the matched text. */
export interface CustomHit {
  start: number;
  end: number;
  label?: string;
}

/** A compiled matcher: given text, return every custom match (may overlap; the caller
 *  resolves overlaps via acceptCustomHits). Pure and side-effect-free. */
export type CustomMatcher = (text: string) => CustomHit[];

// Caps — enforced both here (compile/match time) and in the options UI (save time).
export const MAX_RULES = 50;
export const MAX_PATTERN = 200;
export const MAX_LABEL = 60;
const MAX_INPUT_FOR_REGEX = 100_000; // skip regex rules on very large strings
const MAX_MATCHES_PER_RULE = 1000; // stop a runaway (e.g. broad) rule
// A quantifier applied to a group that itself contains a quantifier — the classic
// catastrophic-backtracking shapes (a+)+ (a*)* (.*)* etc. Detected with a linear scan rather
// than a regex of our own (which could itself backtrack), because this also runs on the send
// path. Purely static — it never executes the user pattern.
function hasNestedQuantifier(p: string): boolean {
  for (let i = 1; i < p.length; i++) {
    if ((p[i] === "+" || p[i] === "*") && p[i - 1] === ")") {
      let depth = 1;
      for (let j = i - 2; j >= 0; j--) {
        if (p[j] === ")") depth++;
        else if (p[j] === "(" && --depth === 0) {
          const body = p.slice(j + 1, i - 1);
          if (body.includes("+") || body.includes("*")) return true;
          break;
        }
      }
    }
  }
  return false;
}
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g; // never legitimate in a rule

interface CompiledRule {
  label?: string;
  re: RegExp;
}

/** Exported so the smokescreen rehydrator (tokenize.ts) fences its surrogate alternation
 *  with the same escaping this module uses for literal rules. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile one rule to a global RegExp, or null to drop it. Literal rules are escaped
 * (so they can never ReDoS) and, when whole-word, fenced with ASCII lookarounds; regex
 * rules are compiled verbatim. Case-insensitive by default. Compiling a literal to a
 * regex — rather than lowercasing the haystack — keeps match offsets correct even for
 * Unicode whose case fold changes length (İ, ß, ligatures).
 */
function compileRule(rule: CustomRule): CompiledRule | null {
  // Strip control chars but KEEP spaces/hyphens — a code name like "Project-Apollo"
  // needs them. Reject empty/whitespace-only and over-long patterns.
  const pattern = (rule.pattern ?? "").replace(CONTROL_CHARS, "");
  if (!pattern.trim() || pattern.length > MAX_PATTERN) return null;
  const flags = rule.caseSensitive ? "g" : "gi";
  let body: string;
  if (rule.isRegex) {
    if (hasNestedQuantifier(pattern)) return null; // never compile a catastrophic pattern
    body = pattern;
  } else {
    const esc = escapeRegExp(pattern);
    body = rule.wholeWord === false ? esc : `(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`;
  }
  try {
    return { label: rule.label, re: new RegExp(body, flags) };
  } catch {
    return null; // invalid user regex — fail open, drop just this rule
  }
}

/**
 * Compile a rule list into a single matcher, or undefined if none survive. Safe to call
 * with untrusted input (invalid rules are dropped). Match-time guards: skip a rule on
 * oversized input, cap matches per rule, advance past zero-width matches, and swallow any
 * per-rule throw so one bad rule can never break redaction of everything else.
 */
/** A compiled RegExp essentially never throws in exec() on string input, so the match-time catch
 *  is defensive — but a silently-skipped rule means a term the user asked to redact could slip
 *  through, so we make it observable. The rule's LABEL only, never the matched text (the no-leak
 *  rule); console is the one side-effect this otherwise-pure module allows itself. Hoisted out of
 *  the matcher so the hot loop stays under Sonar's cognitive-complexity budget. */
function warnRuleSkipped(label: string | undefined): void {
  const which = label ? `"${label}" ` : "";
  console.warn(`[sovereign-shield] custom rule ${which}threw at match time and was skipped`);
}

export function compileRules(rules: readonly CustomRule[]): CustomMatcher | undefined {
  const compiled: CompiledRule[] = [];
  for (const rule of rules.slice(0, MAX_RULES)) {
    const c = compileRule(rule);
    if (c) compiled.push(c);
  }
  if (compiled.length === 0) return undefined;
  return (text: string): CustomHit[] => {
    const hits: CustomHit[] = [];
    if (text.length > MAX_INPUT_FOR_REGEX) return hits;
    for (const c of compiled) {
      try {
        c.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        let n = 0;
        while ((m = c.re.exec(text)) !== null) {
          if (m[0].length > 0) {
            hits.push({ start: m.index, end: m.index + m[0].length, label: c.label });
          }
          if (m.index === c.re.lastIndex) c.re.lastIndex++; // zero-width guard
          if (++n >= MAX_MATCHES_PER_RULE) break;
        }
      } catch {
        warnRuleSkipped(c.label); // fail open: skip this rule, keep the rest — but not silently
      }
    }
    return hits;
  };
}

/**
 * Resolve custom matches against already-accepted built-in spans. A custom hit is dropped
 * if it overlaps a built-in span or an earlier-accepted custom hit; longest-span-first (then
 * earliest) makes ties deterministic. Mirrors the Python core `_spans` rule: structured PII
 * always wins, so a custom rule can never shadow a real identifier. Fails open (→ []) on any
 * matcher throw, leaving built-in redaction untouched.
 */
export function acceptCustomHits(
  text: string,
  builtinSpans: ReadonlyArray<readonly [number, number]>,
  matcher: CustomMatcher,
): CustomHit[] {
  let custom: CustomHit[];
  try {
    custom = matcher(text);
  } catch {
    return [];
  }
  custom.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const occupied: Array<readonly [number, number]> = [...builtinSpans];
  const out: CustomHit[] = [];
  for (const c of custom) {
    if (occupied.some(([s, e]) => c.start < e && s < c.end)) continue;
    occupied.push([c.start, c.end]);
    out.push(c);
  }
  return out;
}

/**
 * Save-time ReDoS lint for a user regex. Returns an error message to show inline, or null
 * if the pattern is acceptable. Kept OFF the send path — options.ts calls this before
 * persisting a rule. Rejects invalid syntax, obvious nested quantifiers, and any pattern
 * that takes too long against a pathological probe input.
 */
export function lintRegex(pattern: string): string | null {
  if (!pattern.trim()) return "Pattern is empty.";
  if (pattern.length > MAX_PATTERN) return `Pattern is too long (max ${MAX_PATTERN}).`;
  let re: RegExp;
  try {
    re = new RegExp(pattern, "g");
  } catch {
    return "Invalid regular expression.";
  }
  // Reject the classic catastrophic shapes statically, WITHOUT executing them.
  if (hasNestedQuantifier(pattern)) {
    return "Pattern has nested quantifiers that can hang — simplify it.";
  }
  // Timing probe against a pathological input, for slow patterns the static check misses.
  // Kept short so that even an exponential pattern completes in bounded time here (and the
  // >5ms budget still flags it). Runs only at save time, never on the send path.
  const probe = "a".repeat(24) + "!";
  const started = now();
  try {
    re.lastIndex = 0;
    re.exec(probe);
  } catch {
    return "Invalid regular expression.";
  }
  if (now() - started > 5) return "Pattern is too slow to evaluate — simplify it.";
  return null;
}

// performance.now() where available (browser/Node), else 0 so this module stays
// dependency-free and testable in plain Node.
function now(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}
