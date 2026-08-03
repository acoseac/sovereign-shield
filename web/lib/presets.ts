// The shared preset library behind https://shield.ars.md/extension/presets.
//
// Each preset is a prefilled CustomRule for the extension's blocklist — NOT a new detector.
// The site renders this list with a Copy button; the code travels via the USER'S CLIPBOARD
// into the options page's "Import preset" box. That is the whole transport, on purpose:
// there is no site↔extension channel, no externally_connectable, no fetch. The extension
// re-validates everything on paste (extension/src/preset-import.ts), including the same
// ReDoS lint every hand-typed rule passes.
//
// This file lives in web/ because Vercel's root is web/ and cannot see ../extension at
// build time — but the EXTENSION test suite imports it (extension/test/presets.test.ts),
// the sanctioned shared-code direction (like web/lib/shield.ts). Two consequences:
//   - keep it strip-only-TypeScript-safe: no enums, no constructor parameter properties;
//   - every entry here is enforced by CI against the admission policy below.
//
// Admission policy (same bar as extension/src/templates.ts, enforced by test):
//   1. NOT already covered — by a shipped detector, a bundled template, or another preset.
//      Duplicating one would double-tokenize the same span for no gain.
//   2. High-precision — anchored on a high-signal prefix or a rigid format; never fires on
//      ordinary prose, dates, or reference numbers. (No UK sort code, no US EIN, no bare
//      17-char VIN shape — all considered and dropped as too collision-prone.)
//   3. Case-sensitive when the real-world identifier is case-defined — custom rules compile
//      case-INsensitive by default, which would make prefixes like `dapi`/`AC` fire on
//      unrelated text.
//
// Contributing: open a PR against this file (github.com/acoseac/sovereign-shield). No cloud
// service, no user uploads — the library is code-reviewed data, nothing else.

export interface Preset {
  /** Stable slug. Travels into the imported rule as `presetId`, which is how a re-import
   *  of a revised pattern UPDATES the existing rule instead of stacking a duplicate. */
  id: string;
  name: string;
  description: string;
  /** A value the pattern matches — shown on the site and pinned by test. Repo convention
   *  (same as the parity vectors' AKIAIOSFODNN7EXAMPLE / ghp_AAA…): the provider's own
   *  canonical fake, or a degenerate low-entropy filler. It must match the pattern while
   *  being unmistakably not a live credential — GitHub push protection scans every blob,
   *  and a realistic-entropy fake is indistinguishable from a leak, to scanners and
   *  readers alike. */
  example: string;
  /** Rule label shown in the pre-send pill; ≤ MAX_LABEL (60). */
  label: string;
  /** Regex source; ≤ MAX_PATTERN (200), must pass the extension's lintRegex. */
  pattern: string;
  caseSensitive?: boolean;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "twilio-sid",
    name: "Twilio Account SID",
    description: "Account identifier for the Twilio API — AC followed by 32 hex characters.",
    example: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    label: "Twilio SID",
    pattern: "\\bAC[0-9a-fA-F]{32}\\b",
    caseSensitive: true,
  },
  {
    id: "sendgrid-key",
    name: "SendGrid API key",
    description: "Mail-sending credential — SG. followed by two base64url segments.",
    example: "SG.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    label: "SendGrid key",
    pattern: "\\bSG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}\\b",
    caseSensitive: true,
  },
  {
    id: "npm-token",
    name: "npm access token",
    description: "Registry credential — npm_ followed by 36 alphanumerics.",
    example: "npm_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    label: "npm token",
    pattern: "\\bnpm_[A-Za-z0-9]{36}\\b",
    caseSensitive: true,
  },
  {
    id: "databricks-token",
    name: "Databricks personal access token",
    description: "Workspace credential — dapi followed by 32 hex characters.",
    example: "dapiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    label: "Databricks PAT",
    pattern: "\\bdapi[0-9a-f]{32}\\b",
    caseSensitive: true,
  },
  {
    id: "azure-storage-key",
    name: "Azure storage account key",
    description: "88-character base64 account key ending in == — grants full storage access.",
    example:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    label: "Azure storage key",
    pattern: "\\b[A-Za-z0-9+/]{86}==(?![A-Za-z0-9+/=])",
    caseSensitive: true,
  },
  {
    id: "slack-webhook",
    name: "Slack incoming-webhook URL",
    description:
      "Anyone holding this URL can post into the channel. Distinct from Slack xox… tokens, which the extension already detects.",
    // Slack's own documentation placeholder (all zeros, X'd token) — assembled from parts
    // because GitHub push protection flags ANY contiguous hooks.slack.com/services URL as a
    // live webhook, canonical zeros included. The joined value is what the site shows and
    // what the cross-check test asserts against; it is not and never was a credential.
    example: ["https://hooks.slack.com", "/services/T00000000", "/B00000000", "/XXXXXXXXXXXXXXXXXXXXXXXX"].join(""),
    label: "Slack webhook",
    pattern: "https://hooks\\.slack\\.com/services/T[A-Z0-9]{8,12}/B[A-Z0-9]{8,12}/[A-Za-z0-9]{24}",
    caseSensitive: true,
  },
  {
    id: "us-dea",
    name: "US DEA registration number",
    description:
      "Prescriber/dispenser registration — two letters (registrant type, then initial) and seven digits.",
    example: "AB1234563",
    label: "DEA number",
    pattern: "\\b[ABFGMPRX][A-Z]\\d{7}\\b",
    caseSensitive: true,
  },
  {
    id: "us-medicare-mbi",
    name: "US Medicare Beneficiary Identifier",
    description:
      "The MBI on every US Medicare card — 11 characters in a rigid letter/digit alternation (no S, L, O, I, B, Z), with or without dashes.",
    example: "1EG4-TE5-MK73",
    label: "Medicare MBI",
    pattern:
      "\\b[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\\d-?[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\\d-?[AC-HJKMNP-RT-Y]{2}\\d{2}\\b",
    caseSensitive: true,
  },
];

/**
 * The one-line code a user copies from the site and pastes into the options page.
 * Versioned so a future format change can be told apart from garbage, and round-tripped
 * through the extension's parser by test — the two surfaces can never drift.
 */
export function presetCode(p: Preset): string {
  return JSON.stringify({
    v: 1,
    id: p.id,
    name: p.name,
    rule: {
      pattern: p.pattern,
      isRegex: true,
      label: p.label,
      caseSensitive: p.caseSensitive === true ? true : undefined,
      presetId: p.id,
    },
  });
}
