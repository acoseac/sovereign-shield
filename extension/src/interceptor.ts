// MAIN-world content script. Runs at document_start so our XMLHttpRequest patch
// is in place before Gemini's app code captures its own reference.
//
// Why this shape (confirmed by inspecting live gemini.google.com traffic):
//   - Gemini sends chat generation over XMLHttpRequest, NOT fetch. A fetch-only
//     hook (the ChatGPT playbook) would silently do nothing here.
//   - The generate call is  POST /_/BardChatUi/data/batchexecute?rpcids=aPya6c...
//     with the prompt buried in the url-encoded `f.req` field.
//   - The page enforces Trusted Types + a strict CSP, so a MAIN-world content
//     script (manifest `world: "MAIN"`, CSP-exempt) is the only way to patch the
//     page's real XHR — you cannot inject a <script> from an isolated world.
import { Session } from "./tokenize";

type XhrMeta = XMLHttpRequest & { __ssUrl?: string };

const session = new Session();

// Default ON: if the bridge has not set the flag yet, guard anyway (fail-safe).
function guardEnabled(): boolean {
  return document.documentElement.getAttribute("data-ss-enabled") !== "off";
}

function reportCount(): void {
  document.documentElement.setAttribute("data-ss-kept", String(session.count));
}

// Rewrite the batchexecute body: walk every STRING in f.req and tokenize it.
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

// Shadow this instance's responseText/response getters so whatever the app reads
// off the stream is already rehydrated. Cumulative reads make this cheap: each
// read gets the full text so far, and detokenize only swaps complete tokens.
function patchResponseReads(xhr: XMLHttpRequest): void {
  const proto = XMLHttpRequest.prototype;
  for (const prop of ["responseText", "response"] as const) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc?.get) continue;
    const nativeGet = desc.get;
    Object.defineProperty(xhr, prop, {
      configurable: true,
      get(this: XMLHttpRequest) {
        const raw = nativeGet.call(this);
        return typeof raw === "string" ? session.rehydrate(raw) : raw;
      },
    });
  }
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
  const isGenerate = url.includes("batchexecute") && url.includes("aPya6c");
  if (isGenerate && guardEnabled()) {
    try {
      let outBody = body;
      if (typeof body === "string") outBody = rewriteBody(body);
      patchResponseReads(this);
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

console.debug("[sovereign-shield] Gemini guard installed (XHR / aPya6c).");
