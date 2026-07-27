// The one place that knows which chat UIs exist and how each one sends a prompt.
//
// This used to live in six places — manifest.json's `host_permissions` plus three identical
// `matches` arrays, popup.ts's SUPPORTED list, interceptor.ts's XHR_ONLY/FETCH_ONLY pair, and
// GENERATE_ENDPOINTS. Adding a site meant five coordinated edits, and missing the
// interceptor.ts one changed which transport got hooked *silently*: the guard would install the
// wrong wrapper and simply never see that site's sends.
//
// manifest.json is static JSON and cannot import from here, so it is not literally derived —
// build.mjs asserts the two agree instead, which turns that particular drift into a build
// failure rather than a quiet no-op.
//
// Pure and DOM-free (no window/document) so it unit-tests directly in Node.
import type { BodyKind } from "./rewrite.ts";

/**
 * How a site's generate call travels. Only the transport a site actually uses is hooked, so
 * our content script never becomes the initiator of the page's own unrelated cross-origin
 * beacons — Gemini's GTM fires at ad.doubleclick.net, Gemini's *own* CSP blocks it, and if our
 * fetch wrapper had forwarded it Chrome would file that violation against this extension.
 */
export type Transport = "xhr" | "fetch";

export interface SiteSpec {
  /** Display name. Documentation only — nothing branches on it. */
  name: string;
  /** Hostname as granted in the manifest. Subdomains are matched too. */
  host: string;
  transport: Transport;
  /** Body shape of the generate request; drives rewrite.ts. */
  kind: BodyKind;
  /**
   * Does this URL look like that site's generate endpoint?
   *
   * Hardcoded on purpose. Matching by payload *shape* would have us rewriting bodies we have no
   * model of, against both the fail-open and byte-faithful contracts. Providers reshuffle these
   * paths without notice; when that happens the fix goes HERE and nothing in the transport
   * wrappers changes. Breakage is loud by design — see canary.ts and RewriteResult.inspected.
   */
  match: (url: string) => boolean;
}

/** Every supported chat UI. All three endpoints confirmed against live traffic. */
export const SITES: readonly SiteSpec[] = [
  {
    name: "Gemini",
    host: "gemini.google.com",
    transport: "xhr",
    kind: "freq",
    match: (u) => u.includes("StreamGenerate"),
  },
  {
    name: "ChatGPT",
    host: "chatgpt.com",
    transport: "fetch",
    kind: "json",
    match: (u) => /\/backend-api\/(?:f\/)?conversation(?:$|\?)/.test(u),
  },
  {
    name: "ChatGPT (legacy host)",
    host: "chat.openai.com",
    transport: "fetch",
    kind: "json",
    match: (u) => /\/backend-api\/(?:f\/)?conversation(?:$|\?)/.test(u),
  },
  {
    name: "Claude",
    host: "claude.ai",
    transport: "fetch",
    kind: "json",
    match: (u) => u.includes("/chat_conversations/") && u.includes("/completion"),
  },
];

/** Hostnames the manifest must grant. build.mjs checks this against manifest.json. */
export const SUPPORTED_HOSTS: readonly string[] = SITES.map((s) => s.host);

/** Does `hostname` belong to `host`, or a subdomain of it? Never a substring test — that would
 *  make "evil.example/?ref=chatgpt.com" read as a supported site. */
export function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith("." + host);
}

/** Is this one of the sites we act on at all? Backs the popup's status line. */
export function isSupportedHost(hostname: string): boolean {
  return SUPPORTED_HOSTS.some((h) => hostMatches(hostname, h));
}

/**
 * The body kind for a generate URL, or null if this isn't one.
 *
 * Pass the **page's** hostname (not the request's) whenever it is known. On a recognised host
 * only that site's fingerprint is consulted, so one provider's URL shape can never be read as
 * another's — Gemini's `StreamGenerate` matcher in particular is a bare substring, and
 * misclassifying a body kind means handing `rewriteBody` a parser that cannot read it, which
 * now (correctly) reports an uninspected send and warns.
 *
 * An **unknown** host deliberately falls back to matching every fingerprint. Same reasoning as
 * `transportsFor`: if the manifest gains a site nobody classified here, it must still be
 * inspected, and the fingerprint is the only signal left. Scoping unconditionally would turn
 * that fail-safe into a silent no-op.
 */
export function generateKind(url: string, hostname?: string): BodyKind | null {
  if (hostname !== undefined) {
    const site = SITES.find((s) => hostMatches(hostname, s.host));
    if (site) return site.match(url) ? site.kind : null;
  }
  return SITES.find((s) => s.match(url))?.kind ?? null;
}

/**
 * Which transport(s) to hook on this host.
 *
 * An unknown host gets **both** — if the manifest ever gains a site nobody classified here, the
 * guard must still see its sends rather than silently no-op. That is the safe direction: the
 * cost is a wrapper we didn't need, not an unguarded prompt.
 */
export function transportsFor(hostname: string): { xhr: boolean; fetch: boolean } {
  const site = SITES.find((s) => hostMatches(hostname, s.host));
  if (!site) return { xhr: true, fetch: true };
  return { xhr: site.transport === "xhr", fetch: site.transport === "fetch" };
}
