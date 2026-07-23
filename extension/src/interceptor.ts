// MAIN-world content script. Runs at document_start so our fetch/XHR patches are
// in place before the page's app code captures its own references.
//
// Covers three chat UIs, each with a different generate transport/body — all
// confirmed by inspecting live traffic:
//   - Gemini  : POST .../BardFrontendService/StreamGenerate  (XHR, url-encoded f.req)
//   - ChatGPT : POST chatgpt.com/backend-api/f/conversation  (fetch, JSON body)
//   - Claude  : POST claude.ai/api/organizations/*/chat_conversations/*/completion (fetch, JSON)
// Gemini also enforces Trusted Types + a strict CSP, so a MAIN-world content
// script (manifest world:"MAIN", CSP-exempt) is the only way to patch the page's
// real fetch/XHR — you cannot inject a <script> from an isolated world.
import { Session } from "./tokenize";
import { rewriteBody, type BodyKind } from "./rewrite";
import { compileRules, type CustomMatcher, type CustomRule } from "./custom";
import { installClipboardRehydrator } from "./clipboard";

const session = new Session();

// Build stamp so a reload can be verified from the page (data-ss-build on <html>).
const BUILD = "12-canary";
document.documentElement.dataset.ssBuild = BUILD;

// Default ON: if the bridge has not set the flag yet, guard anyway (fail-safe).
function guardEnabled(): boolean {
  return document.documentElement.dataset.ssEnabled !== "off";
}

// Smokescreen: swap real values for realistic stand-ins instead of [EMAIL_1] placeholders.
// Default OFF — unlike the guard itself, this changes what the model actually sees, so it
// only turns on once the bridge has explicitly said the user asked for it.
function smokescreenEnabled(): boolean {
  return document.documentElement.dataset.ssSmoke === "on";
}

function reportCount(): void {
  document.documentElement.dataset.ssKept = String(session.count);
}

// Monotonic count of generate bodies we actually inspected. The ISOLATED indicator watches
// this to tell "the guard saw that send" from "the endpoint moved and we never got a look at
// it" — see canary.ts. Bumped on inspection, NOT on redaction: a clean prompt is still a
// prompt the guard read, and warning about it would cry wolf on every message.
let inspected = 0;
function reportInspected(): void {
  inspected += 1;
  document.documentElement.dataset.ssSeen = String(inspected);
}

function failopen(): void {
  try {
    window.postMessage({ source: "ss-guard", kind: "failopen" }, location.origin);
  } catch {
    /* best-effort */
  }
}

// Generate-endpoint fingerprints, one per supported chat UI — all confirmed
// against live traffic (see file header). Providers reshuffle their internal API
// paths from time to time; when that happens, update the matcher HERE and nothing
// in the fetch/XHR wrappers needs to change.
//   "freq" = url-encoded `f.req` (Gemini)   "json" = raw JSON (ChatGPT, Claude)
const GENERATE_ENDPOINTS: ReadonlyArray<{
  site: string;
  kind: BodyKind;
  match: (url: string) => boolean;
}> = [
  { site: "Gemini", kind: "freq", match: (u) => u.includes("StreamGenerate") },
  { site: "ChatGPT", kind: "json", match: (u) => /\/backend-api\/(?:f\/)?conversation(?:$|\?)/.test(u) },
  { site: "Claude", kind: "json", match: (u) => u.includes("/chat_conversations/") && u.includes("/completion") },
];

function generateKind(url: string): BodyKind | null {
  return GENERATE_ENDPOINTS.find((e) => e.match(url))?.kind ?? null;
}

// Which categories the user has left enabled (bridge writes data-ss-cats from
// storage). Absent attribute => tokenize every category.
function allowedCategories(): ReadonlySet<string> | undefined {
  const raw = document.documentElement.dataset.ssCats;
  if (raw === undefined) return undefined;
  return new Set(raw.split(",").filter(Boolean));
}

// User keyword/regex blocklist (bridge writes data-ss-custom as JSON — NOT comma-joined,
// since patterns can contain commas). Compiled once and cached by the raw attribute string,
// so we never recompile per send. Any parse/compile surprise falls back to "no custom rules"
// — custom matching must never break the built-in guard or block a send.
let customRaw = "";
let customMatcher: CustomMatcher | undefined;
function currentCustomMatcher(): CustomMatcher | undefined {
  const raw = document.documentElement.dataset.ssCustom ?? "";
  if (raw !== customRaw) {
    customRaw = raw;
    let rules: CustomRule[] = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) rules = parsed as CustomRule[];
    } catch {
      rules = [];
    }
    customMatcher = compileRules(rules);
  }
  return customMatcher;
}

// Redact the outgoing body (pure logic in rewrite.ts) and, only when something was
// actually kept local, report the running count to the bridge. A clean prompt or a
// parse surprise returns the original body byte-for-byte — the guard never mutates
// a request it didn't need to touch.
function rewriteBodyForSend(kind: BodyKind, body: string): string {
  session.customMatcher = currentCustomMatcher();
  session.smokescreen = smokescreenEnabled();
  reportInspected(); // we got a look at this body, redaction or not
  const { body: out, changed } = rewriteBody(kind, body, session, allowedCategories());
  if (changed) reportCount();
  return out;
}

// Restore real values in the RENDERED DOM, not in the response stream. Gemini's
// stream is length-prefixed (each chunk announces its byte count), so rewriting a
// token to a longer value inside responseText desyncs the parser and hangs
// generation. We let every provider's stream parse untouched and swap token->value
// in the text nodes they paint. rehydrate is idempotent, so the mutation our own
// write triggers converges in one no-op pass. Editable regions (composers) skipped.
//
// This covers what is PAINTED only. The sites' Copy buttons serve their own markdown
// source, which never passes through here — see clipboard.ts.
function installDomRehydrator(): void {
  const isEditable = (el: Element | null): boolean => {
    if (!el) return false;
    // Fast path: isContentEditable already reflects editability inherited from an
    // ancestor, so nested spans inside a contenteditable composer are covered.
    if (el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      return true;
    }
    // Backstop: if the text node's immediate parent is NOT an HTMLElement (an <svg> or
    // custom wrapper the site nests inside its composer), the instanceof check above
    // short-circuits and never sees the inherited editability. closest() climbs the
    // ancestors so a non-HTML node can't slip a token into the box the user is typing in.
    return el.closest('input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
  };
  const rehydrateText = (node: Text): void => {
    const v = node.nodeValue;
    // Ask the session, don't test for "[" here: smokescreen surrogates are realistic
    // strings with no bracket, so a literal marker check would short-circuit before
    // rehydrate() ever ran and every surrogate would stay on screen unrestored.
    if (!v || !session.mayNeedRehydration(v)) return;
    if (isEditable(node.parentElement)) return; // never touch composers
    const next = session.rehydrate(v);
    if (next !== v) node.nodeValue = next;
  };
  const scan = (root: Node): void => {
    if (root.nodeType === Node.TEXT_NODE) return rehydrateText(root as Text);
    if (!(root instanceof Element) || isEditable(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) rehydrateText(n as Text);
  };
  const observer = new MutationObserver((mutations) => {
    if (session.count === 0) return; // nothing to restore yet
    for (const m of mutations) {
      if (m.type === "characterData") rehydrateText(m.target as Text);
      else m.addedNodes.forEach(scan);
    }
  });
  // documentElement exists at document_start, so observe immediately rather than
  // waiting for body/DOMContentLoaded — never miss an early paint.
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}

// ---- transport hooks ------------------------------------------------------
// Each chat UI sends its prompt over exactly one transport: Gemini over XHR
// (StreamGenerate), ChatGPT/Claude over fetch. We install ONLY the transport a
// site actually uses, so our content script never becomes the initiator of the
// page's own unrelated cross-origin beacons. That matters because, e.g., Gemini's
// GTM fires a request to ad.doubleclick.net that Gemini's *own* page CSP blocks;
// if our fetch wrapper forwarded it, Chrome would file that CSP error against
// this extension even though we never read or touch the request. Unknown hosts
// (should the manifest gain one) get BOTH hooks, so the guard never silently
// no-ops on a site we forgot to classify.
const HOST = location.hostname;
const hostIn = (domains: string[]): boolean =>
  domains.some((d) => HOST === d || HOST.endsWith("." + d));
const XHR_ONLY = hostIn(["gemini.google.com"]); // generate rides on XHR, never fetch
const FETCH_ONLY = hostIn(["chatgpt.com", "chat.openai.com", "claude.ai"]); // fetch, never XHR

// ---- XHR hook (Gemini) ----------------------------------------------------
// URL is stashed in a closure-private WeakMap, not on the XHR instance — the
// MAIN world is shared with the page, so an instance property would be readable
// (and spoofable) by page scripts.
if (!FETCH_ONLY) {
  const xhrUrls = new WeakMap<XMLHttpRequest, string>();
  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;

  proto.open = function (this: XMLHttpRequest, ...args: Parameters<typeof origOpen>) {
    xhrUrls.set(this, String(args[1])); // args = [method, url, async?, user?, pass?]
    return origOpen.apply(this, args);
  } as typeof proto.open;

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const kind = generateKind(xhrUrls.get(this) ?? "");
    if (kind && guardEnabled() && typeof body === "string") {
      try {
        return origSend.call(this, rewriteBodyForSend(kind, body) as XMLHttpRequestBodyInit);
      } catch (err) {
        console.warn("[sovereign-shield] XHR passthrough after error:", err);
        failopen();
      }
    }
    return origSend.call(this, body ?? null);
  } as typeof proto.send;
}

// ---- fetch hook (ChatGPT, Claude; and any unknown host, as a fail-safe) ----
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  return String(input);
}

const origFetch = window.fetch;
if (!XHR_ONLY) {
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const kind = generateKind(requestUrl(input));
      if (kind && guardEnabled()) {
        return rewriteFetch(kind, input, init);
      }
    } catch {
      /* fall through to native */
    }
    return origFetch.call(window, input, init);
  } as typeof window.fetch;
}

async function rewriteFetch(
  kind: BodyKind,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    // Common case: the body is a JSON string in init.body. Generate calls are
    // POST; requiring POST both matches reality and satisfies "no body on GET".
    if (init && typeof init.body === "string" && (init.method ?? "").toUpperCase() === "POST") {
      return origFetch.call(window, input, {
        ...init,
        method: "POST",
        body: rewriteBodyForSend(kind, init.body),
      });
    }
    // Fallback: the body rides on a Request object (POST only — no body on GET).
    // Only buffer it when it's JSON or url-encoded form data; anything else
    // (e.g. a multipart file upload) is passed straight through, so we never read
    // a large or streamed body into a string just to hand it back untouched.
    if (input instanceof Request && input.method.toUpperCase() === "POST") {
      // Content-Type (and auth/CSRF) can be declared on the Request OR on init; merge both
      // so we neither miss the type check (which would fail open) nor drop init's headers.
      // init wins on conflict, matching fetch(request, init) semantics.
      const headers = new Headers(input.headers);
      if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
      const ct = headers.get("content-type") ?? "";
      if (/application\/json|x-www-form-urlencoded/i.test(ct)) {
        const text = await input.clone().text();
        if (text) {
          // Spread init so caller options survive, keep the merged headers (so init's
          // Content-Type/auth aren't dropped), and pin the abort signal so "Stop
          // generating" still cancels the rewritten request.
          return origFetch.call(
            window,
            new Request(input, {
              ...init,
              method: "POST",
              headers,
              body: rewriteBodyForSend(kind, text),
              signal: init?.signal ?? input.signal,
            }),
          );
        }
      }
    }
  } catch (err) {
    console.warn("[sovereign-shield] fetch passthrough after error:", err);
    failopen();
  }
  return origFetch.call(window, input, init);
}

// Report each newly-redacted identifier to the bridge (ISOLATED world) for the
// activity log + badge. We send only the category — never the value.
session.onMint = (category) => {
  try {
    window.postMessage({ source: "ss-guard", category }, location.origin);
  } catch {
    /* best-effort telemetry; never block the guard */
  }
};

installDomRehydrator();
installClipboardRehydrator(session);
console.debug(
  `[sovereign-shield] guard installed on ${HOST} (${XHR_ONLY ? "xhr" : FETCH_ONLY ? "fetch" : "xhr+fetch"}) build ${BUILD}.`,
);
