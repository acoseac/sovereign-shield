// A vendored library of ready-made custom rules, so the blocklist is usable by people who do
// not write regular expressions. Pure and DOM-free — options.ts is the UI shell.
//
// These are NOT new detectors. A template is nothing more than a prefilled CustomRule: it lands
// in the same `custom` list, is matched by the same compileRules path, is edited and deleted like
// any hand-typed rule, and is redacted under the same `custom` category. That is deliberate —
// adding a real detector means touching all three parity-locked copies of the shield and shipping
// a vector regeneration, whereas a template costs nothing at runtime and the user stays in
// control of it.
//
// Two rules for anything added here:
//
//   1. **It must not already be covered.** Every pattern below was checked against the shipped
//      detectors first (US SSN, UK NINo, RFC 1918, MAC and internal hostnames all return no hits
//      today). Duplicating a built-in would double-tokenize the same span for no gain.
//   2. **It must be high-precision.** The product's stated promise is that identifiers are
//      checksum-validated "so ordinary text is untouched and false positives are minimized", and
//      a template that fires on prose would undermine exactly that. This is why there is no UK
//      sort code (`\d{2}-\d{2}-\d{2}` also matches dates) and no US EIN (`\d{2}-\d{7}` collides
//      with ordinary reference numbers) — both were considered and dropped.
import type { CustomRule } from "./custom.ts";

export interface RuleTemplate {
  /** Stable identity, used to tell "already added" from "not yet". Never shown to the user. */
  id: string;
  name: string;
  /** One line, plain language — this is what a non-technical user decides on. */
  description: string;
  /** A value the pattern is meant to catch. Doubles as the fixture its test asserts against. */
  example: string;
  rule: CustomRule;
}

/**
 * Build one regex template.
 *
 * Every entry in the library is a regex rule, so the `isRegex: true` / nested-`rule` shape was
 * spelled out identically five times — which is both noise and, at 48% of the file, enough
 * duplication to fail the quality gate. Declaring the shape once here is the honest fix: a
 * data table should have one definition and N rows, not N copies of the definition.
 *
 * Positional on purpose — a named-argument object would just reinstate the repeated keys. The
 * order is: identity, then the two strings the user reads, then the fixture, then the two the
 * matcher uses.
 */
function regexTemplate(
  id: string,
  name: string,
  description: string,
  example: string,
  label: string,
  pattern: string,
): RuleTemplate {
  return { id, name, description, example, rule: { pattern, isRegex: true, label } };
}

/**
 * The library. Ordered roughly by how widely useful each one is, since the UI renders them in
 * this order and most people will take the first one or two that apply to them.
 */
export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  regexTemplate(
    "us-ssn",
    "US Social Security number",
    "Nine digits written as 123-45-6789.",
    "SSN 123-45-6789 on file",
    "US SSN",
    String.raw`\b\d{3}-\d{2}-\d{4}\b`,
  ),
  regexTemplate(
    "uk-nino",
    "UK National Insurance number",
    "Two letters, six digits and a final letter, e.g. AB 12 34 56 C.",
    // Deliberately NOT the familiar QQ123456C: QQ is one of the prefixes HMRC reserves as
    // permanently invalid precisely so it can be used in examples, and the letter classes below
    // correctly refuse it. Using it here would have asserted the opposite of the real rule.
    "NI number AB 12 34 56 C",
    "UK NINo",
    // The letter classes are the real ones: D, F, I, Q, U and V never start a NINo, and the
    // suffix is only A-D. That is what keeps it off ordinary words.
    String.raw`\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b`,
  ),
  regexTemplate(
    "private-ip",
    "Internal IP address",
    "Private network addresses (10.x, 192.168.x, 172.16–31.x).",
    "deploy target 10.4.12.9",
    "Internal IP",
    String.raw`\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){1,3}\b`,
  ),
  regexTemplate(
    "internal-hostname",
    "Internal hostname",
    "Machine and site names on a private domain (.corp, .internal, .intranet, .lan).",
    "see wiki.corp.internal for the runbook",
    "Internal host",
    // One character class, one quantifier. The obvious `(?:\.[\w-]+)*` form is a nested
    // quantifier and lintRegex rejects it outright — the rule would look added and never
    // persist. Flattening the label part into the class keeps it linear.
    String.raw`\b[\w.-]+\.(?:corp|internal|intranet|lan)\b`,
  ),
  regexTemplate(
    "mac-address",
    "MAC address",
    "Hardware addresses like d4:3d:7e:9a:1b:2c.",
    "adapter d4:3d:7e:9a:1b:2c",
    "MAC address",
    String.raw`\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b`,
  ),
];

/**
 * Is this template already in the user's list?
 *
 * Compared on the PATTERN, not the id: rules are stored as plain CustomRules with no template
 * marker, so the pattern is the only durable link back. Trimmed because the editor writes back
 * exactly what is in the input, and a stray space should not make a template look un-added.
 */
export function templateAlreadyAdded(
  template: RuleTemplate,
  rules: readonly CustomRule[],
): boolean {
  const pattern = template.rule.pattern.trim();
  return rules.some((r) => r.pattern.trim() === pattern);
}

/**
 * A fresh copy of the template's rule, safe to push into the editor's draft.
 *
 * Returns a clone rather than the vendored object: the editor mutates rules in place as the user
 * types, and handing out the module-level literal would let one edit rewrite the library for the
 * rest of the session.
 */
export function instantiateTemplate(template: RuleTemplate): CustomRule {
  return { ...template.rule };
}
