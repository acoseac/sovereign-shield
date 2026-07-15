// Pure request-body rewriter shared by the transport hooks in interceptor.ts.
// Deliberately DOM-free (no window/document) so it unit-tests directly.
//
// Byte-faithful contract: when the tokenizer redacts nothing, the ORIGINAL body
// is returned unchanged — a clean prompt must reach the provider exactly as the
// page composed it. Re-encoding even a clean body was observed to make some
// Gemini backends reject the send outright (the thinking model is stricter than
// the default); see test/rewrite.test.ts for the pinned cases.
import type { Session } from "./tokenize";

export type BodyKind = "freq" | "json";

// Walk every STRING in a parsed body and tokenize it; numbers/booleans/structure
// are left untouched (so ids, timestamps and enums never get corrupted).
// Structure-agnostic on purpose — no dependency on any provider's exact layout.
// `ctx.changed` flips true the instant a string is actually redacted, so the
// caller can hand back the original body verbatim when nothing matched.
function walk(
  node: unknown,
  allowed: ReadonlySet<string> | undefined,
  session: Session,
  ctx: { changed: boolean },
): unknown {
  if (node === null) return null;
  if (typeof node === "string") {
    const out = session.tokenize(node, allowed);
    // tokenize returns the SAME string reference when it makes no substitution,
    // so an identity check is a reliable "did this string change" signal.
    if (out !== node) ctx.changed = true;
    return out;
  }
  if (Array.isArray(node)) return node.map((n) => walk(n, allowed, session, ctx));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = walk(value, allowed, session, ctx);
    return out;
  }
  return node;
}

export interface RewriteResult {
  body: string;
  changed: boolean; // true iff at least one identifier was redacted
}

/**
 * Rewrite a request body of the given kind, redacting via `session`. Returns the
 * original body untouched (`changed:false`) on a clean prompt OR any parse
 * surprise — the guard never corrupts a body it did not need to touch.
 */
export function rewriteBody(
  kind: BodyKind,
  body: string,
  session: Session,
  allowed: ReadonlySet<string> | undefined,
): RewriteResult {
  const ctx = { changed: false };
  if (kind === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { body, changed: false };
    }
    const walked = walk(parsed, allowed, session, ctx);
    if (!ctx.changed) return { body, changed: false }; // clean prompt → byte-for-byte passthrough
    return { body: JSON.stringify(walked), changed: true };
  }
  // "freq": url-encoded  f.req=<json>&at=...&...
  const params = new URLSearchParams(body);
  const fReq = params.get("f.req");
  if (!fReq) return { body, changed: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fReq);
  } catch {
    return { body, changed: false };
  }
  const walked = walk(parsed, allowed, session, ctx);
  if (!ctx.changed) return { body, changed: false }; // clean prompt → byte-for-byte passthrough
  // Swap ONLY the f.req value, in place, inside the original body. Every other
  // byte — param order, the `at` token's encoding, any trailing separator — is
  // preserved exactly as the page sent it, so the sole delta the backend sees is
  // the redacted span itself. (The former `URLSearchParams(body).toString()`
  // re-encoded the WHOLE body: it dropped the client's trailing "&" and
  // re-percent-encoded ' ( ) ! ~, which some Gemini backends reject.) f.req is
  // encodeURIComponent-encoded — spaces as %20 — matching the client's encoding.
  const encoded = encodeURIComponent(JSON.stringify(walked));
  const out = body.replace(/(^|&)(f\.req=)[^&]*/, (_m, pre: string, key: string) => pre + key + encoded);
  return { body: out, changed: true };
}
