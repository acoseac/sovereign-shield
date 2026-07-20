// Stateful tokenizer for one Gemini conversation. Mirrors web/lib/gateway.ts
// (tokenizeText / detokenize) but keeps its value<->token map across turns, so
// the same identifier gets the same placeholder every time and the reply can be
// restored. Detection is the parity-gated shield — checksum-validated identifiers
// only, so clean text passes through untouched.
import { detectPii } from "../../web/lib/shield.ts";
import { acceptCustomHits, escapeRegExp, type CustomMatcher } from "./custom.ts";
import { MAX_SURROGATES, mintSurrogate, surrogateEligible } from "./surrogate.ts";

const TOKEN_PREFIX: Record<string, string> = {
  ch_ahv: "AHV",
  iban: "IBAN",
  it_cf: "CF",
  es_dni: "DNI",
  fr_nir: "NIR",
  nl_bsn: "BSN",
  ch_phone: "PHONE",
  email: "EMAIL",
  credit_card: "CARD",
  de_steuerid: "STEUERID",
  pl_pesel: "PESEL",
  pt_nif: "NIF",
  be_nrn: "NRN",
  uk_nhs: "NHS",
  br_cpf: "CPF",
  br_cnpj: "CNPJ",
  za_id: "ZAID",
  cn_resident: "CNID",
  ca_sin: "SIN",
  in_aadhaar: "AADHAAR",
  // Secrets / API keys.
  private_key: "PEM",
  jwt: "JWT",
  aws_key: "AWS",
  anthropic_key: "ANTHROPIC",
  openai_key: "OPENAI",
  github_token: "GITHUB",
  google_api_key: "GOOGLE",
  slack_token: "SLACK",
  stripe_key: "STRIPE",
  // User-defined custom rules.
  custom: "CUSTOM",
};

// The surrogate alternation is fenced with lookbehind, which V8 has had since Chrome 62 —
// well under the manifest's Chrome 111 floor. Probed once anyway, because the failure
// direction is not symmetric: minting a surrogate we then cannot restore would leave the
// user reading fabricated data believing it is real. If the probe fails we simply never mint
// surrogates and everything stays on bracket tokens.
let lookbehindOk: boolean | undefined;
function supportsLookbehind(): boolean {
  if (lookbehindOk === undefined) {
    try {
      lookbehindOk = new RegExp("(?<![A-Za-z0-9_])x(?![A-Za-z0-9_])").test("x");
    } catch {
      lookbehindOk = false;
    }
  }
  return lookbehindOk;
}

/**
 * Per-conversation redaction state. Held only in page memory; never persisted,
 * never sent anywhere.
 */
export class Session {
  private readonly valueToken = new Map<string, string>();
  private readonly tokenValue = new Map<string, string>();
  // Prototype-free so a counter key can never resolve to an inherited member. Today
  // the prefix is sanitised to uppercase [A-Z0-9_] (no collision with the lowercase
  // Object.prototype keys is possible), but this keeps that safe if the prefix logic
  // ever changes — a corrupted counter would break token/rehydrate parity.
  private readonly counters: Record<string, number> = Object.create(null);

  // --- smokescreen state (all empty unless the mode is on) ------------------
  /** Minted surrogates, longest-first, for the rehydrate alternation. */
  private surrogates: string[] = [];
  /** The same values pre-lowercased, for the hot-path prefilter. MUST stay in sync with
   *  `surrogates` — the prefilter and the case-insensitive regex have to agree, or a
   *  re-cased surrogate gets rejected before the regex that exists to catch it ever runs. */
  private surrogatesLower: string[] = [];
  /** Case-insensitive lookup, so a model that re-cases a surrogate still rehydrates. */
  private readonly tokenValueLower = new Map<string, string>();
  /** Cached alternation, invalidated on each mint. null = needs rebuild. */
  private surrogatePattern: RegExp | null = null;
  /** Set if building the alternation ever throws: stop minting surrogates for the rest of
   *  the session and fall back to bracket tokens. Degrading to brackets is safe; leaving a
   *  minted surrogate that can never be restored would show the user fabricated data they
   *  believe is real. */
  private surrogatesBroken = false;

  /**
   * Swap real values for realistic stand-ins instead of `[EMAIL_1]` placeholders, for the
   * categories that have a vendored pool (see surrogate.ts). Set per-send by the
   * interceptor from settings. Off by default: it changes what the model actually sees.
   */
  smokescreen = false;

  /** Fired once per newly-minted token (distinct value), with its category only. */
  onMint?: (category: string) => void;

  /**
   * Optional user keyword/regex blocklist, run alongside the built-in detectors. Set by
   * the interceptor/indicator from settings. Custom matches lose to built-in PII on overlap
   * and fail open — they can never block a send or shadow a real identifier.
   */
  customMatcher?: CustomMatcher;

  /**
   * Merge built-in PII hits (filtered by `allowed`) with custom-blocklist hits. Built-in
   * hits are already non-overlapping; custom hits that overlap a built-in span (or an
   * earlier custom hit) are dropped, so the result is a flat non-overlapping list.
   */
  private detect(
    text: string,
    allowed?: ReadonlySet<string>,
  ): Array<{ start: number; end: number; category: string }> {
    const builtin = detectPii(text).filter((h) => !allowed || allowed.has(h.category));
    const hits = builtin.map((h) => ({ start: h.start, end: h.end, category: h.category as string }));
    if (this.customMatcher && (!allowed || allowed.has("custom"))) {
      const spans = builtin.map((h) => [h.start, h.end] as [number, number]);
      for (const c of acceptCustomHits(text, spans, this.customMatcher)) {
        hits.push({ start: c.start, end: c.end, category: "custom" });
      }
    }
    return hits;
  }

  /**
   * Replace every checksum-valid identifier (and any custom-blocklist match) in `text`
   * with a stable placeholder. If `allowed` is given, only those categories are tokenized;
   * the rest pass through. Returns the SAME string reference when nothing is redacted, so
   * callers can detect "unchanged" by identity (the byte-faithful rewrite contract).
   */
  tokenize(text: string, allowed?: ReadonlySet<string>): string {
    const hits = this.detect(text, allowed);
    if (hits.length === 0) return text;
    // Replace back-to-front so earlier offsets stay valid as we splice.
    let out = text;
    for (const h of hits.sort((a, b) => b.start - a.start)) {
      const value = text.slice(h.start, h.end);
      // Already one of OUR placeholders — leave the span byte-identical. Bracket tokens
      // never needed this ("[EMAIL_1]" matches no detector), but a surrogate does:
      // "alice.morgan@example.org" IS a valid email. Two real paths bring one back here —
      // Gemini's f.req carries prior turns, and users paste model output back into the
      // composer ("now revise this draft"). Without this guard the surrogate would be
      // detected as a fresh value and mapped to a SECOND surrogate, corrupting the thread
      // and breaking rehydration for both.
      if (this.tokenValue.has(value)) continue;
      let token = this.valueToken.get(value);
      if (!token) {
        // Sanitise so the prefix can only contain characters the rehydrate regex
        // matches — a future category key with a digit or dash can't mint a token
        // that then never gets restored.
        const prefix = (TOKEN_PREFIX[h.category] ?? h.category.toUpperCase()).replace(/[^A-Z0-9_]/g, "_");
        this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
        token = this.mintPlaceholder(h.category, prefix, this.counters[prefix]);
        this.valueToken.set(value, token);
        this.tokenValue.set(token, value);
        this.tokenValueLower.set(token.toLowerCase(), value);
        this.onMint?.(h.category);
      }
      out = out.slice(0, h.start) + token + out.slice(h.end);
    }
    return out;
  }

  /**
   * The placeholder for a newly-seen value: a realistic stand-in when smokescreen is on and
   * the category has a vendored pool, otherwise the classic `[PREFIX_n]` token. Falling back
   * to a bracket token is always safe, which is why every guard below fails that way.
   */
  private mintPlaceholder(category: string, prefix: string, ordinal: number): string {
    if (
      this.smokescreen &&
      !this.surrogatesBroken &&
      this.surrogates.length < MAX_SURROGATES &&
      surrogateEligible(category) &&
      supportsLookbehind()
    ) {
      const surrogate = mintSurrogate(category, ordinal);
      // Two collisions to refuse, both of which would silently break the guard:
      //   - one we already issued: two distinct real values would rehydrate to one string.
      //   - one the user's own blocklist matches: because tokenize() skips anything already
      //     in tokenValue, a later mention of the user's real term would then pass through
      //     unredacted. Rare (it needs a pool value to equal one of their rules) but it is a
      //     leak, so rule it out at mint time rather than hope.
      if (surrogate && !this.tokenValue.has(surrogate) && !this.matchesCustomRule(surrogate)) {
        this.registerSurrogate(surrogate);
        return surrogate;
      }
    }
    return `[${prefix}_${ordinal}]`;
  }

  /** Would the user's own blocklist redact this candidate stand-in? Fails open to `false`
   *  (a throwing matcher must never stop us placing a placeholder). */
  private matchesCustomRule(candidate: string): boolean {
    if (!this.customMatcher) return false;
    try {
      return this.customMatcher(candidate).length > 0;
    } catch {
      return false;
    }
  }

  /** Track a new surrogate and invalidate the cached matchers that depend on the set. */
  private registerSurrogate(surrogate: string): void {
    this.surrogates.push(surrogate);
    // Longest-first so a short surrogate can never match inside a longer one.
    this.surrogates.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    this.surrogatesLower = this.surrogates.map((s) => s.toLowerCase());
    this.surrogatePattern = null;
  }

  /**
   * Alternation over every minted surrogate, or null if it could not be built (in which case
   * minting is disabled for the rest of the session). Word-boundary fenced with the same
   * ASCII lookarounds custom.ts uses, so a surrogate like "Acme Industries" can't rewrite the
   * middle of a longer identifier, and case-insensitive so a model that re-cases the value
   * still rehydrates.
   */
  private surrogateRe(): RegExp | null {
    if (this.surrogatePattern) return this.surrogatePattern;
    if (this.surrogates.length === 0 || this.surrogatesBroken) return null;
    try {
      const body = this.surrogates
        .map((s) => `(?<![A-Za-z0-9_])${escapeRegExp(s)}(?![A-Za-z0-9_])`)
        .join("|");
      this.surrogatePattern = new RegExp(body, "gi");
      return this.surrogatePattern;
    } catch {
      // Unreachable in practice: every literal is escaped and supportsLookbehind() gated
      // minting. Kept so a regex-engine surprise degrades instead of throwing on the DOM path.
      this.surrogatesBroken = true;
      return null;
    }
  }

  /**
   * Cheap prefilter for the DOM hot path: does `text` plausibly contain anything to restore?
   * The MutationObserver calls this per streamed text node, so it must be much cheaper than
   * the full replace — and it must agree with rehydrate() on both counts:
   *
   *   - **text-specific, not session-global.** Testing `this.surrogates.length > 0` would
   *     return true for every node on the page as soon as one surrogate exists, which
   *     silently deletes the fast path exactly during a long streaming reply.
   *   - **case-insensitive**, matching the `gi` alternation. A case-sensitive prefilter would
   *     reject a re-cased surrogate before the regex that exists to catch it ever ran.
   */
  mayNeedRehydration(text: string): boolean {
    if (this.tokenValue.size === 0) return false;
    if (text.includes("[")) return true;
    if (this.surrogatesLower.length === 0) return false;
    const hay = text.toLowerCase();
    return this.surrogatesLower.some((s) => hay.includes(s));
  }

  /**
   * Swap placeholders back to their real values. A token split across two stream
   * chunks (e.g. "[AHV_" now, "1]" next chunk) simply is not matched yet — it gets
   * restored once the closing chunk arrives, so partial reads never corrupt text.
   */
  rehydrate(text: string): string {
    if (this.tokenValue.size === 0) return text;
    let out = text;
    // Pass 1 — bracket tokens. One regex, O(1) lookup per match. Runs on every streamed
    // text-node mutation, so it must not scale with the token count.
    if (text.includes("[")) {
      out = out.replace(/\[[A-Z0-9_]+_\d+\]/g, (m) => this.tokenValue.get(m) ?? m);
    }
    // Pass 2 — surrogates, which carry no marker of their own. Skipped entirely (and the
    // alternation never built) in bracket-only sessions, so smokescreen-off behaviour is
    // bit-identical to before this feature existed.
    if (this.surrogates.length > 0) {
      const re = this.surrogateRe();
      if (re) {
        out = out.replace(
          re,
          (m) => this.tokenValue.get(m) ?? this.tokenValueLower.get(m.toLowerCase()) ?? m,
        );
      }
    }
    return out;
  }

  /** How many distinct identifiers have been kept local this conversation. */
  get count(): number {
    return this.tokenValue.size;
  }
}
