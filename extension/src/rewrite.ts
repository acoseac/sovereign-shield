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

/**
 * A string that is *itself* a JSON structure, or undefined if it should be treated as plain
 * text. Gemini's `f.req` nests its payload one level deep — `[null, "<json>"]` — so without
 * this the inner document reaches the detectors **escape-encoded**, and `\t` or `\n` are two
 * literal characters rather than one.
 *
 * That is not cosmetic. In `"Name\tango@corp.example\tactive"` the detector matched
 * `tango@corp.example`, eating the `t` of the escape: the replacement left a dangling `\[`,
 * which is invalid JSON, so the provider rejected the send outright — and the mapping stored
 * the wrong address, so a restore would have shown a value nobody has. It only bites when a
 * value sits directly after an escape, which is why a pasted table (tab- or newline-separated)
 * broke while ordinary prose did not.
 *
 * Two guards keep this from becoming its own byte-faithfulness bug (ADR 0002):
 *   - only `[`/`{` structures qualify, so a prompt of `123` or `"hi"` is never reinterpreted;
 *   - `JSON.stringify(parsed)` must reproduce the input **byte for byte**. If the user pasted
 *     pretty-printed JSON as their prompt, re-serialising would silently reformat it, so we
 *     decline and treat it as text. We only take this path when the round-trip is provably
 *     lossless.
 */
function nestedJson(value: string): unknown {
  const first = value.charCodeAt(0);
  if (first !== 0x5b /* [ */ && first !== 0x7b /* { */) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return undefined;
    return JSON.stringify(parsed) === value ? parsed : undefined;
  } catch {
    return undefined; // not JSON, or not round-trippable — plain text
  }
}

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
    const nested = nestedJson(node);
    if (nested !== undefined) {
      // Recurse into the parsed form, so detectors see real characters. Track this subtree's
      // changes separately: when nothing inside it was redacted we must hand back the ORIGINAL
      // string, not a re-serialisation of it, or a clean prompt stops being byte-faithful.
      const outerChanged = ctx.changed;
      ctx.changed = false;
      const walked = walk(nested, allowed, session, ctx);
      const innerChanged = ctx.changed;
      ctx.changed = outerChanged || innerChanged;
      return innerChanged ? JSON.stringify(walked) : node;
    }
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
  /**
   * Did we actually READ the prompt? False means we recognised the endpoint but could not
   * parse its body, so the request goes out **unredacted and unchecked**.
   *
   * This exists because `changed:false` alone is ambiguous, and the ambiguity was a real
   * defect: a clean prompt and an unparseable body returned byte-identical results, so the
   * caller bumped the inspected counter, left the badge green and never fired `failopen()`.
   * The prompt went out in the clear with all three warning channels silent — precisely the
   * silent breakage `canary.ts` exists to catch, bypassed one layer below it. The realistic
   * trigger is Gemini renaming `f.req` or reshaping its payload.
   *
   * Callers must treat `inspected:false` as "warn loudly, do not count this as a look".
   */
  inspected: boolean;
}

/** Nothing to read, so nothing was missed. Distinguished from a parse failure so an empty
 *  body can't cry wolf — the XHR hook forwards any string, including "". */
function nothingToInspect(body: string): RewriteResult {
  return { body, changed: false, inspected: true };
}

/** Recognised the endpoint, could not read the body. The caller must warn. */
function uninspected(body: string): RewriteResult {
  return { body, changed: false, inspected: false };
}

/**
 * Rewrite a request body of the given kind, redacting via `session`. Returns the
 * original body untouched (`changed:false`) on a clean prompt OR any parse
 * surprise — the guard never corrupts a body it did not need to touch. A parse
 * surprise additionally reports `inspected:false` so the caller can fail LOUDLY;
 * silence there is what let an unredacted prompt through unnoticed.
 */
export function rewriteBody(
  kind: BodyKind,
  body: string,
  session: Session,
  allowed: ReadonlySet<string> | undefined,
): RewriteResult {
  const ctx = { changed: false };
  if (body === "") return nothingToInspect(body);
  if (kind === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return uninspected(body);
    }
    const walked = walk(parsed, allowed, session, ctx);
    if (!ctx.changed) return nothingToInspect(body); // clean prompt → byte-for-byte passthrough
    return { body: JSON.stringify(walked), changed: true, inspected: true };
  }
  // "freq": url-encoded  f.req=<json>&at=...&...
  const params = new URLSearchParams(body);
  const fReq = params.get("f.req");
  // No f.req in a body we matched as Gemini's generate call: either the endpoint moved onto a
  // different payload shape or the parameter was renamed. Either way the prompt is in there
  // somewhere and we did not look at it.
  if (!fReq) return uninspected(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fReq);
  } catch {
    return uninspected(body);
  }
  const walked = walk(parsed, allowed, session, ctx);
  if (!ctx.changed) return nothingToInspect(body); // clean prompt → byte-for-byte passthrough
  // Swap ONLY the f.req value, in place, inside the original body. Every other
  // byte — param order, the `at` token's encoding, any trailing separator — is
  // preserved exactly as the page sent it, so the sole delta the backend sees is
  // the redacted span itself. (The former `URLSearchParams(body).toString()`
  // re-encoded the WHOLE body: it dropped the client's trailing "&" and
  // re-percent-encoded ' ( ) ! ~, which some Gemini backends reject.) f.req is
  // encodeURIComponent-encoded — spaces as %20 — matching the client's encoding.
  const encoded = encodeURIComponent(JSON.stringify(walked));
  const out = body.replace(/(^|&)(f\.req=)[^&]*/, (_m, pre: string, key: string) => pre + key + encoded);
  return { body: out, changed: true, inspected: true };
}
