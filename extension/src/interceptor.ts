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

type XhrMeta = XMLHttpRequest & { __ssUrl?: string };
type BodyKind = "freq" | "json";

const session = new Session();

// Build stamp so a reload can be verified from the page (data-ss-build on <html>).
const BUILD = "5-multisite";
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
  const EDITABLE = 'input, textarea, [contenteditable="true"], .ql-editor';
  const rehydrateText = (node: Text): void => {
    const v = node.nodeValue;
    if (!v || !v.includes("[")) return;
    if (node.parentElement?.closest(EDITABLE)) return;
    const next = session.rehydrate(v);
    if (next !== v) node.nodeValue = next;
  };
  const scan = (root: Node): void => {
    if (root.nodeType === Node.TEXT_NODE) return rehydrateText(root as Text);
    if (!(root instanceof Element) || root.closest(EDITABLE)) return;
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
  const start = (): void =>
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

// ---- XHR hook (Gemini) ----------------------------------------------------
const proto = XMLHttpRequest.prototype;
const origOpen = proto.open;
const origSend = proto.send;

proto.open = function (this: XhrMeta, _method: string, url: string | URL) {
  this.__ssUrl = String(url);
  return origOpen.apply(this, arguments as unknown as Parameters<typeof origOpen>);
} as typeof proto.open;

proto.send = function (this: XhrMeta, body?: Document | XMLHttpRequestBodyInit | null) {
  const kind = generateKind(this.__ssUrl ?? "");
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

// ---- fetch hook (ChatGPT, Claude; and anything that migrates to fetch) -----
const origFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const url =
      typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    const kind = generateKind(url);
    if (kind && guardEnabled()) {
      return rewriteFetch(kind, input, init);
    }
  } catch {
    /* fall through to native */
  }
  return origFetch.call(window, input, init);
} as typeof window.fetch;

async function rewriteFetch(
  kind: BodyKind,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    // Common case: the body is a JSON string in init.body.
    if (init && typeof init.body === "string") {
      return origFetch.call(window, input, { ...init, body: rewriteBody(kind, init.body) });
    }
    // Fallback: the body rides on a Request object.
    if (input instanceof Request) {
      const text = await input.clone().text();
      if (text) {
        return origFetch.call(window, new Request(input, { body: rewriteBody(kind, text) }));
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
console.debug(`[sovereign-shield] guard installed (fetch + XHR, 3 sites) build ${BUILD}.`);
