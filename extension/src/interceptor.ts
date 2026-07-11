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

type BodyKind = "freq" | "json";

const session = new Session();

// Build stamp so a reload can be verified from the page (data-ss-build on <html>).
const BUILD = "7-transport-scope";
document.documentElement.dataset.ssBuild = BUILD;

// Default ON: if the bridge has not set the flag yet, guard anyway (fail-safe).
function guardEnabled(): boolean {
  return document.documentElement.dataset.ssEnabled !== "off";
}

function reportCount(): void {
  document.documentElement.dataset.ssKept = String(session.count);
}

function failopen(): void {
  try {
    window.postMessage({ source: "ss-guard", kind: "failopen" }, location.origin);
  } catch {
    /* best-effort */
  }
}

// Which generate endpoint is this, and how is its body wrapped?
//   "freq" = url-encoded `f.req` (Gemini)   "json" = raw JSON (ChatGPT, Claude)
function generateKind(url: string): BodyKind | null {
  if (url.includes("StreamGenerate")) return "freq";
  if (/\/backend-api\/(?:f\/)?conversation(?:$|\?)/.test(url)) return "json"; // ChatGPT
  if (url.includes("/chat_conversations/") && url.includes("/completion")) return "json"; // Claude
  return null;
}

// Which categories the user has left enabled (bridge writes data-ss-cats from
// storage). Absent attribute => tokenize every category.
function allowedCategories(): ReadonlySet<string> | undefined {
  const raw = document.documentElement.dataset.ssCats;
  if (raw === undefined) return undefined;
  return new Set(raw.split(",").filter(Boolean));
}

// Walk every STRING in a parsed body and tokenize it; numbers/booleans/structure
// are left untouched (so ids, timestamps and enums never get corrupted).
// Structure-agnostic on purpose — no dependency on any provider's exact layout.
function walk(node: unknown, allowed: ReadonlySet<string> | undefined): unknown {
  if (node === null) return null;
  if (typeof node === "string") return session.tokenize(node, allowed);
  if (Array.isArray(node)) return node.map((n) => walk(n, allowed));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = walk(value, allowed);
    return out;
  }
  return node;
}

// Rewrite a request body string of the given kind. Returns the original body on
// any parse surprise (fail-open); reports the running count after a real rewrite.
function rewriteBody(kind: BodyKind, body: string): string {
  const allowed = allowedCategories();
  if (kind === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return body;
    }
    const out = JSON.stringify(walk(parsed, allowed));
    reportCount();
    return out;
  }
  // "freq": url-encoded  f.req=<json>&at=...&...
  const params = new URLSearchParams(body);
  const fReq = params.get("f.req");
  if (!fReq) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fReq);
  } catch {
    return body;
  }
  params.set("f.req", JSON.stringify(walk(parsed, allowed)));
  reportCount();
  return params.toString();
}

// Restore real values in the RENDERED DOM, not in the response stream. Gemini's
// stream is length-prefixed (each chunk announces its byte count), so rewriting a
// token to a longer value inside responseText desyncs the parser and hangs
// generation. We let every provider's stream parse untouched and swap token->value
// in the text nodes they paint. rehydrate is idempotent, so the mutation our own
// write triggers converges in one no-op pass. Editable regions (composers) skipped.
function installDomRehydrator(): void {
  const isEditable = (el: Element | null): boolean =>
    el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  const rehydrateText = (node: Text): void => {
    const v = node.nodeValue;
    if (!v || !v.includes("[")) return;
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

  proto.open = function (this: XMLHttpRequest, _method: string, url: string | URL) {
    xhrUrls.set(this, String(url));
    return origOpen.apply(this, arguments as unknown as Parameters<typeof origOpen>);
  } as typeof proto.open;

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const kind = generateKind(xhrUrls.get(this) ?? "");
    if (kind && guardEnabled() && typeof body === "string") {
      try {
        return origSend.call(this, rewriteBody(kind, body) as XMLHttpRequestBodyInit);
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
        body: rewriteBody(kind, init.body),
      });
    }
    // Fallback: the body rides on a Request object (POST only — no body on GET).
    if (input instanceof Request && input.method.toUpperCase() === "POST") {
      const text = await input.clone().text();
      if (text) {
        // Clone headers explicitly so a string body can't down-grade the original
        // Content-Type (e.g. application/json -> text/plain -> HTTP 415).
        const headers = new Headers(input.headers);
        return origFetch.call(window, new Request(input, { method: "POST", headers, body: rewriteBody(kind, text) }));
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
console.debug(
  `[sovereign-shield] guard installed on ${HOST} (${XHR_ONLY ? "xhr" : FETCH_ONLY ? "fetch" : "xhr+fetch"}) build ${BUILD}.`,
);
