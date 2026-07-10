// MAIN-world content script. Runs at document_start so our XMLHttpRequest patch
// is in place before Gemini's app code captures its own reference.
//
// Why this shape (confirmed by inspecting live gemini.google.com traffic):
//   - Gemini sends chat generation over XMLHttpRequest, NOT fetch. A fetch-only
//     hook (the ChatGPT playbook) would silently do nothing here.
//   - The generate call is  POST /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
//     (rt=c streaming), with the prompt buried in the url-encoded `f.req` field.
//     (NOT batchexecute — that path only carries side RPCs like history/titling.)
//   - The page enforces Trusted Types + a strict CSP, so a MAIN-world content
//     script (manifest `world: "MAIN"`, CSP-exempt) is the only way to patch the
//     page's real XHR — you cannot inject a <script> from an isolated world.
import { Session } from "./tokenize";

type XhrMeta = XMLHttpRequest & { __ssUrl?: string };

const session = new Session();

// Build stamp so a reload can be verified from the page (data-ss-build on <html>).
const BUILD = "3-dom-rehydrate";
document.documentElement.setAttribute("data-ss-build", BUILD);

// Default ON: if the bridge has not set the flag yet, guard anyway (fail-safe).
function guardEnabled(): boolean {
  return document.documentElement.getAttribute("data-ss-enabled") !== "off";
}

function reportCount(): void {
  document.documentElement.setAttribute("data-ss-kept", String(session.count));
}

// Rewrite the StreamGenerate body: walk every STRING in f.req and tokenize it.
// Numbers (timestamps, request ids) are left untouched, so we never corrupt the
// envelope. Structure-agnostic on purpose — it does not depend on Google's exact
// array indices, so it survives their frequent reshuffles.
function rewriteBody(body: string): string {
  const params = new URLSearchParams(body);
  const fReq = params.get("f.req");
  if (!fReq) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fReq);
  } catch {
    return body; // not the JSON envelope we expected — leave it alone
  }
  params.set("f.req", JSON.stringify(walk(parsed)));
  return params.toString();
}

function walk(node: unknown): unknown {
  if (typeof node === "string") return session.tokenize(node);
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = walk(value);
    return out;
  }
  return node;
}

// Restore real values in the RENDERED DOM, not in the response stream. Gemini's
// stream is length-prefixed (each chunk announces its byte count), so rewriting
// [AHV_1] -> a longer real value inside responseText desyncs the parser and hangs
// generation. Instead we let the stream parse untouched, then swap token->value in
// the text nodes Gemini paints. rehydrate is idempotent, so the mutation our own
// write triggers converges in one no-op pass. Editable regions (the composer, where
// the user typed the real value already) are skipped.
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

const proto = XMLHttpRequest.prototype;
const origOpen = proto.open;
const origSend = proto.send;

proto.open = function (this: XhrMeta, _method: string, url: string | URL) {
  this.__ssUrl = String(url);
  return origOpen.apply(this, arguments as unknown as Parameters<typeof origOpen>);
} as typeof proto.open;

proto.send = function (this: XhrMeta, body?: Document | XMLHttpRequestBodyInit | null) {
  const url = this.__ssUrl ?? "";
  const isGenerate = url.includes("StreamGenerate");
  if (isGenerate && guardEnabled()) {
    try {
      let outBody = body;
      if (typeof body === "string") outBody = rewriteBody(body);
      this.addEventListener("loadend", reportCount);
      return origSend.call(this, outBody as XMLHttpRequestBodyInit);
    } catch (err) {
      // MVP is fail-open: a parser hiccup must never brick the user's Gemini.
      // A production build would fail-closed (abort the send) instead — see README.
      console.warn("[sovereign-shield] passthrough after error:", err);
    }
  }
  return origSend.call(this, body ?? null);
} as typeof proto.send;

installDomRehydrator();
console.debug(`[sovereign-shield] Gemini guard installed (XHR / StreamGenerate) build ${BUILD}.`);
