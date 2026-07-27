// Build the "a site stopped working" report links offered by the canary banner.
//
// This is the one channel by which a broken transport reaches the maintainer. The extension has
// no telemetry by design — nothing about a user's traffic ever leaves their machine — so when a
// provider reshuffles its API and the guard stops matching, the canary tells the *user* and the
// signal stops there. Five releases have shipped with no way to learn that had happened.
//
// It stays consistent with ADR 0005 by construction: the user clicks, the payload is metadata,
// and nothing is sent automatically. What crosses is what a bug report needs and nothing more —
// **never any prompt content, and never a redacted value**. That is not a convention here, it is
// what report.test.ts asserts.
//
// Pure and DOM-free so it unit-tests directly.

const REPO = "https://github.com/acoseac/sovereign-shield";
/** From CONTRIBUTING.md. Must never be a surrogate pool address — those are documentation-only
 *  RFC 2606 domains and cannot receive mail (see surrogate.ts). */
const EMAIL = "arsenie@odysseus.fi";
/** Matches the `symptom` dropdown in .github/ISSUE_TEMPLATE/site-stopped-working.yml. */
const SYMPTOM = "A banner said a message went out uninspected";

export interface ReportContext {
  /** Hostname of the site the send happened on. Matches the template's `site` dropdown. */
  host: string;
  /** Extension version, from chrome.runtime.getManifest(). */
  version: string;
  /** Build stamp off `data-ss-build`, which pins the exact bundle running in this tab. */
  build?: string;
}

export interface ReportLinks {
  issue: string;
  email: string;
}

/** Plain-text body for the mail fallback — the same four facts, one per line. */
function emailBody(ctx: ReportContext): string {
  return [
    "Sovereign Shield didn't inspect a message I sent.",
    "",
    `Site:    ${ctx.host}`,
    `Version: ${ctx.version}`,
    `Build:   ${ctx.build || "unknown"}`,
    `Symptom: ${SYMPTOM}`,
    "",
    "What I was doing:",
    "",
  ].join("\n");
}

/**
 * Two links for the same report.
 *
 * **GitHub is primary but cannot be the only one.** It assumes an account and a willingness to
 * sign in at the moment something broke, which filters out most of the people this loop exists to
 * hear from — the extension's users are not all developers. The `mailto:` fallback costs one
 * function and removes that filter.
 *
 * Every value is URL-encoded: a hostname is untrusted-ish input and a build stamp is a free-form
 * string, so neither may be able to inject extra query parameters.
 */
export function buildReportLinks(ctx: ReportContext): ReportLinks {
  const issue = new URLSearchParams({
    template: "site-stopped-working.yml",
    title: `[site] ${ctx.host} — a message went out uninspected`,
    site: ctx.host,
    symptom: SYMPTOM,
    version: ctx.version,
    build: ctx.build || "",
  });
  const email = new URLSearchParams({
    subject: `Sovereign Shield ${ctx.version} — uninspected send on ${ctx.host}`,
    body: emailBody(ctx),
  });
  return {
    issue: `${REPO}/issues/new?${issue.toString()}`,
    // URLSearchParams encodes spaces as "+", which mail clients render literally in a body.
    // %20 is correct for a mailto and every client handles it.
    email: `mailto:${EMAIL}?${email.toString().replace(/\+/g, "%20")}`,
  };
}
