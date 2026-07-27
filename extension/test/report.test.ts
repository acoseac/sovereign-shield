// The report links are the only channel by which a broken transport reaches the maintainer —
// there is no telemetry, by design. That makes what they carry a privacy question, not just a
// formatting one, so the first block below is the actual contract: metadata, and nothing else.
import assert from "node:assert/strict";
import test from "node:test";

import { buildReportLinks } from "../src/report.ts";
import { SUPPORTED_HOSTS } from "../src/sites.ts";

const CTX = { host: "gemini.google.com", version: "0.7.0", build: "15-pending-summary" };

// --- the privacy contract ---------------------------------------------------

test("no prompt content, no redacted value, can reach either link", () => {
  // Everything a user might have had on screen when the canary fired. None of it is passed in,
  // and none of it may appear — this pins that the payload is built from the context object
  // alone and never reads the page.
  const secrets = [
    "756.1234.5678.97", // an AHV the guard would have redacted
    "hans.muster@bluewin.ch",
    "alice.morgan@example.org", // a smokescreen stand-in is just as bad: it reads as real
    "[AHV_1]", // even a placeholder implies what was in the prompt
    "Project Helvetia", // a custom rule term is the user's own confidential word
    "draft a thank note for",
  ];
  const { issue, email } = buildReportLinks(CTX);
  for (const s of secrets) {
    const needle = encodeURIComponent(s);
    for (const [name, url] of [["issue", issue], ["email", email]] as const) {
      assert.ok(!url.includes(s), `${name} leaked ${s} verbatim`);
      assert.ok(!url.includes(needle), `${name} leaked ${s} encoded`);
    }
  }
});

test("carries exactly the four facts a report needs", () => {
  const { issue, email } = buildReportLinks(CTX);
  for (const url of [issue, email]) {
    assert.ok(url.includes(encodeURIComponent(CTX.host)) || url.includes(CTX.host), "host");
    assert.ok(url.includes(CTX.version), "version");
    assert.ok(url.includes(CTX.build) || url.includes(encodeURIComponent(CTX.build)), "build");
  }
});

// --- the GitHub link --------------------------------------------------------

test("targets the site-stopped-working template and prefills its fields", () => {
  const { issue } = buildReportLinks(CTX);
  const q = new URL(issue).searchParams;
  assert.equal(q.get("template"), "site-stopped-working.yml");
  // The `site` value must match a dropdown option EXACTLY or GitHub leaves it unselected —
  // which is why that template lists bare hostnames.
  assert.equal(q.get("site"), "gemini.google.com");
  assert.equal(q.get("version"), "0.7.0");
  assert.equal(q.get("build"), "15-pending-summary");
  assert.equal(q.get("symptom"), "A banner said a message went out uninspected");
});

test("every supported host round-trips into the site field", () => {
  // Guards the coupling in the other direction: a host in sites.ts that the template doesn't
  // list would silently produce an unselected dropdown. SUPPORTED_HOSTS is the source of truth
  // for both, so assert the link is built from it faithfully.
  for (const host of SUPPORTED_HOSTS) {
    const q = new URL(buildReportLinks({ ...CTX, host }).issue).searchParams;
    assert.equal(q.get("site"), host);
  }
});

// --- the email fallback -----------------------------------------------------

test("the mailto goes to the real maintainer address, never a surrogate", () => {
  const { email } = buildReportLinks(CTX);
  assert.ok(email.startsWith("mailto:arsenie@odysseus.fi?"));
  // example.org/com/net are RFC 2606 documentation domains used by the smokescreen pool and
  // cannot receive mail. One appearing here would mean reports silently going nowhere.
  assert.ok(!/example\.(org|com|net)/.test(email));
});

test("the mail body encodes spaces as %20, not +", () => {
  // URLSearchParams emits "+", which mail clients render literally in a body.
  const { email } = buildReportLinks(CTX);
  const body = email.slice(email.indexOf("body="));
  assert.ok(!body.includes("+"), "a literal + would show up in the user's draft");
  assert.ok(decodeURIComponent(body).includes("Site:    gemini.google.com"));
});

// --- robustness -------------------------------------------------------------

test("a missing build stamp degrades rather than breaking the link", () => {
  const { issue, email } = buildReportLinks({ ...CTX, build: undefined });
  assert.equal(new URL(issue).searchParams.get("build"), "");
  assert.ok(decodeURIComponent(email).includes("Build:   unknown"));
});

test("hostile host and build strings cannot inject query parameters", () => {
  // Both come from the page's DOM one way or another, so neither may smuggle in an extra param.
  const { issue } = buildReportLinks({
    host: "evil.example&labels=spam",
    version: "0.7.0",
    build: "x&template=other.yml",
  });
  const q = new URL(issue).searchParams;
  assert.equal(q.get("template"), "site-stopped-working.yml", "template must not be overridable");
  assert.equal(q.get("labels"), null);
  assert.equal(q.get("site"), "evil.example&labels=spam", "kept whole, as one value");
});
