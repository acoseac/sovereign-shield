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

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Hard cap on live value↔placeholder mappings, oldest evicted first.
 *
 * Purely hygiene, not performance: 2 000 mappings is on the order of 200 KB, and the DOM hot
 * path is already bounded by MAX_SURROGATES. It exists so a tab left open for days on a
 * single-page chat app cannot grow without limit.
 *
 * **The tradeoff:** an evicted placeholder can no longer be restored, so scrolling back to a
 * very old turn in a 2 000-identifier thread will show `[EMAIL_1]` raw. That is the correct
 * direction to fail — degraded display, never a leak — but it is a visible behaviour change.
 *
 * Note what this deliberately is NOT: a reset on SPA navigation. ChatGPT and Claude rewrite
 * the URL from `/` to `/c/<uuid>` *after* the first message of a new chat is sent, so a
 * route-change reset would wipe the mapping for the message that is streaming right then and
 * paint `[EMAIL_1]` into its reply. Bounded growth, no navigation heuristics.
 */
export const MAX_MAPPINGS = 2000;

/** How many successive pool entries recycleSurrogate will try before giving up and leaving the
 *  mapping as it is. Small: every candidate is checked against the same mint-time rules, and
 *  refusing to change is always safe. */
const RECYCLE_ATTEMPTS = 8;

/** One live mapping, for the inspector's Mappings tab. Contains a REAL value — this type only
 *  ever crosses function calls inside the MAIN world, never a postMessage or chrome.storage. */
export interface SessionEntry {
  value: string;
  placeholder: string;
  category: string;
  /** True when the placeholder is a smokescreen stand-in rather than a bracket token. */
  surrogate: boolean;
}

/** One span the guard would redact, located in the ORIGINAL text so the panel can highlight
 *  both sides of the diff. */
export interface PreviewSpan {
  start: number;
  end: number;
  category: string;
  placeholder: string;
}

export interface Preview {
  /** What the provider would receive. */
  text: string;
  /** Redacted spans, ascending by offset in the original text. */
  spans: PreviewSpan[];
}

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
  /** value → the placeholder currently used for it. Insertion-ordered, which is what makes
   *  "evict the oldest" a single call. One entry per distinct value. */
  private readonly valueToken = new Map<string, string>();
  /** placeholder → value, the RESTORE direction. May hold more entries than `valueToken`:
   *  recycleSurrogate retires a stand-in without dropping it, so turns already on screen
   *  carrying the old one keep rehydrating. */
  private readonly tokenValue = new Map<string, string>();
  /** placeholder → category, for the inspector's Mappings tab. */
  private readonly tokenCategory = new Map<string, string>();
  /** Values the user has explicitly excused via the inspector ("stop redacting this").
   *  Session-only and never persisted: writing it to chrome.storage would put a real PII
   *  value on disk, which is the one thing storage.ts promises never happens. */
  private readonly allowlist = new Set<string>();
  /** Values whose stand-in has been recycled — the only ones that map from more than one
   *  placeholder. Lets forget() skip a reverse scan of `tokenValue` in the normal case. */
  private readonly recycled = new Set<string>();
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
    const builtin = detectPii(text)
      .filter((h) => !allowed || allowed.has(h.category))
      // Excused by the user in the inspector. Filtered BEFORE the spans below are computed, so
      // an excused value doesn't go on blocking an overlapping custom-rule hit. Exact-match on
      // the value, so a differently-cased mention is redacted again — the conservative
      // direction for a manual override.
      .filter((h) => !this.allowlist.has(text.slice(h.start, h.end)));
    const hits = builtin.map((h) => ({ start: h.start, end: h.end, category: h.category as string }));
    if (this.customMatcher && (!allowed || allowed.has("custom"))) {
      const spans = builtin.map((h) => [h.start, h.end] as [number, number]);
      for (const c of acceptCustomHits(text, spans, this.customMatcher)) {
        if (this.allowlist.has(text.slice(c.start, c.end))) continue;
        hits.push({ start: c.start, end: c.end, category: "custom" });
      }
    }
    return hits;
  }

  /** The token prefix for a category, sanitised so it can only contain characters the
   *  rehydrate regex matches — a future category key with a digit or dash can't mint a token
   *  that then never gets restored. Shared by tokenize and preview so their ordinals agree. */
  private prefixFor(category: string): string {
    return (TOKEN_PREFIX[category] ?? category.toUpperCase()).replace(/[^A-Z0-9_]/g, "_");
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
        this.evictIfFull();
        const prefix = this.prefixFor(h.category);
        this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
        token = this.mintPlaceholder(h.category, prefix, this.counters[prefix]);
        this.remember(value, token, h.category);
        this.onMint?.(h.category);
      }
      out = out.slice(0, h.start) + token + out.slice(h.end);
    }
    return out;
  }

  /**
   * What `tokenize` WOULD produce for `text`, without mutating anything — no mapping stored,
   * no counter advanced, no surrogate registered, `onMint` never fired. Backs the inspector's
   * pre-send diff.
   *
   * Accuracy is the whole point, which is why this lives on Session rather than being computed
   * from a throwaway one in the ISOLATED world: a fresh Session would number from `_1` and pick
   * different pool entries than the real conversation, so the panel would promise
   * `alice.morgan@example.org` while the model actually received `clara.hoffmann@example.net`.
   * A preview that lies is worse than no preview.
   *
   * Ordinals are the live counters plus this preview's own deltas, and stand-ins run the same
   * candidateSurrogate checks, so the prediction holds as long as the user sends what they
   * previewed.
   */
  preview(text: string, allowed?: ReadonlySet<string>): Preview {
    const hits = this.detect(text, allowed);
    if (hits.length === 0) return { text, spans: [] };
    const deltas: Record<string, number> = Object.create(null); // per-prefix, this preview only
    const hypothetical = new Map<string, string>(); // value → placeholder, this preview only
    const taken = new Set<string>(); // stand-ins claimed here but not registered
    const spans: PreviewSpan[] = [];
    let out = text;
    // Back-to-front, like tokenize, so earlier offsets stay valid as we splice.
    for (const h of [...hits].sort((a, b) => b.start - a.start)) {
      const value = text.slice(h.start, h.end);
      if (this.tokenValue.has(value)) continue; // already one of our placeholders
      let placeholder = this.valueToken.get(value) ?? hypothetical.get(value);
      if (!placeholder) {
        const prefix = this.prefixFor(h.category);
        deltas[prefix] = (deltas[prefix] ?? 0) + 1;
        const ordinal = (this.counters[prefix] ?? 0) + deltas[prefix];
        const surrogate = this.candidateSurrogate(
          h.category,
          ordinal,
          taken,
          this.surrogates.length + taken.size,
        );
        if (surrogate) taken.add(surrogate);
        placeholder = surrogate ?? `[${prefix}_${ordinal}]`;
        hypothetical.set(value, placeholder);
      }
      spans.push({ start: h.start, end: h.end, category: h.category, placeholder });
      out = out.slice(0, h.start) + placeholder + out.slice(h.end);
    }
    spans.reverse(); // we walked back-to-front; hand back ascending offsets
    return { text: out, spans };
  }

  /**
   * The stand-in this `(category, ordinal)` would take, or **null when it must fall back to a
   * bracket token**. Every guard fails that way, because degrading to a bracket costs nothing
   * while a bad stand-in is a silent leak.
   *
   * Shared by the three callers that must agree on the answer — mintPlaceholder (which then
   * registers it), preview (which must NOT, but must predict exactly what mint would do, or
   * the inspector panel lies to the user) and recycleSurrogate. `alsoTaken` and `liveCount`
   * let a caller account for candidates it is holding but has not registered.
   */
  private candidateSurrogate(
    category: string,
    ordinal: number,
    alsoTaken: ReadonlySet<string>,
    liveCount: number,
  ): string | null {
    if (!this.smokescreen || this.surrogatesBroken) return null;
    if (liveCount >= MAX_SURROGATES) return null;
    if (!surrogateEligible(category) || !supportsLookbehind()) return null;
    const surrogate = mintSurrogate(category, ordinal);
    if (!surrogate) return null;
    // Two collisions to refuse, both of which would silently break the guard:
    //   - one we already issued: two distinct real values would rehydrate to one string.
    //   - one the user's own blocklist matches: because tokenize() skips anything already
    //     in tokenValue, a later mention of the user's real term would then pass through
    //     unredacted. Rare (it needs a pool value to equal one of their rules) but it is a
    //     leak, so rule it out at mint time rather than hope.
    if (this.tokenValue.has(surrogate) || alsoTaken.has(surrogate)) return null;
    if (this.matchesCustomRule(surrogate)) return null;
    return surrogate;
  }

  /**
   * The placeholder for a newly-seen value: a realistic stand-in when smokescreen is on and
   * the category has a vendored pool, otherwise the classic `[PREFIX_n]` token.
   */
  private mintPlaceholder(category: string, prefix: string, ordinal: number): string {
    const surrogate = this.candidateSurrogate(category, ordinal, EMPTY, this.surrogates.length);
    if (surrogate) {
      this.registerSurrogate(surrogate);
      return surrogate;
    }
    return `[${prefix}_${ordinal}]`;
  }

  // --- mapping lifecycle ----------------------------------------------------

  /** Install a value↔placeholder mapping in every index that has to know about it. */
  private remember(value: string, token: string, category: string): void {
    this.valueToken.set(value, token);
    this.tokenValue.set(token, value);
    this.tokenValueLower.set(token.toLowerCase(), value);
    this.tokenCategory.set(token, category);
  }

  /** Make room before minting, oldest value first. See MAX_MAPPINGS for the tradeoff. */
  private evictIfFull(): void {
    while (this.valueToken.size >= MAX_MAPPINGS) {
      const oldest = this.valueToken.keys().next();
      if (oldest.done) return;
      this.forget(oldest.value);
    }
  }

  /** Remove one placeholder from every index that restores it. */
  private dropPlaceholder(token: string): void {
    this.tokenValue.delete(token);
    this.tokenValueLower.delete(token.toLowerCase());
    this.tokenCategory.delete(token);
    const at = this.surrogates.indexOf(token);
    if (at !== -1) {
      // surrogatesLower is built index-parallel to surrogates (see registerSurrogate), so the
      // same index removes the matching needle from the hot-path prefilter.
      this.surrogates.splice(at, 1);
      this.surrogatesLower.splice(at, 1);
      this.surrogatePattern = null;
    }
  }

  /**
   * Drop a value and EVERY placeholder that maps to it, so nothing is left pointing at a value
   * we no longer hold.
   *
   * Counters are deliberately not rewound. Ordinals stay monotonic, so a forgotten value that
   * is typed again gets a fresh `[EMAIL_9]` rather than a recycled `[EMAIL_1]` — otherwise the
   * DOM rehydrator would restore the NEW value into an OLD message still showing that token.
   *
   * Returns false if the value was not mapped.
   */
  forget(value: string): boolean {
    const token = this.valueToken.get(value);
    if (token === undefined) return false;
    this.valueToken.delete(value);
    this.dropPlaceholder(token);
    // Only a recycled value maps from more than one placeholder, so the reverse scan is gated
    // on that set rather than run every time. eviction calls this from the synchronous send
    // path, and an O(map) walk per mint at the cap is not a cost worth paying for a rare case.
    if (this.recycled.delete(value)) {
      for (const [retired, mapped] of [...this.tokenValue]) {
        if (mapped === value) this.dropPlaceholder(retired);
      }
    }
    return true;
  }

  /**
   * "Stop redacting this" — a false-positive escape hatch for the inspector. Drops the mapping
   * and excuses the value for the rest of this page's life.
   *
   * Two consequences the UI has to state rather than hide: turns already sent still carry the
   * placeholder and will now render it unrestored, and the excuse is **not persisted** — a
   * reload redacts the value again. Persisting it would mean writing a real PII value to
   * chrome.storage.
   */
  allow(value: string): void {
    this.allowlist.add(value);
    this.forget(value);
  }

  /** Drop every mapping. Counters survive, for the same reason forget() does not rewind them. */
  clear(): void {
    this.valueToken.clear();
    this.tokenValue.clear();
    this.tokenValueLower.clear();
    this.tokenCategory.clear();
    this.recycled.clear();
    this.surrogates = [];
    this.surrogatesLower = [];
    this.surrogatePattern = null;
  }

  /** Every live mapping, oldest first. Real values — MAIN world only. */
  entries(): SessionEntry[] {
    const isSurrogate = new Set(this.surrogates);
    return [...this.valueToken].map(([value, placeholder]) => ({
      value,
      placeholder,
      category: this.tokenCategory.get(placeholder) ?? "",
      surrogate: isSurrogate.has(placeholder),
    }));
  }

  /**
   * Swap a stand-in for the next one the pool offers — the inspector's escape hatch for "this
   * fake name is confusing me". Returns the new stand-in, or null if the mapping isn't a
   * stand-in or no safe candidate exists (in which case nothing changes).
   *
   * Free-text replacement is deliberately not offered: a user-supplied stand-in could be a real
   * person's address, or collide with their own blocklist, which is exactly the hazard ADR 0004
   * closes. Every candidate here comes from the vetted pool and passes the same mint-time checks.
   *
   * The OLD stand-in is retired, not deleted: it stays in `tokenValue` so turns already on
   * screen carrying it keep restoring to the real value. Only future sends use the new one.
   */
  recycleSurrogate(value: string): string | null {
    const current = this.valueToken.get(value);
    if (current === undefined || !this.surrogates.includes(current)) return null;
    const category = this.tokenCategory.get(current);
    if (category === undefined) return null;
    const prefix = this.prefixFor(category);
    for (let attempt = 0; attempt < RECYCLE_ATTEMPTS; attempt++) {
      this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
      const next = this.candidateSurrogate(
        category,
        this.counters[prefix],
        EMPTY,
        this.surrogates.length,
      );
      if (!next) continue;
      this.registerSurrogate(next);
      this.remember(value, next, category); // rewrites valueToken; leaves `current` restorable
      this.recycled.add(value);
      return next;
    }
    return null;
  }

  /** Would the user's own blocklist redact this candidate stand-in? On a throwing matcher
   *  we answer **true** — "assume it collides" — so the value degrades to a bracket token.
   *  That is the safe direction: losing a stand-in costs nothing, whereas wrongly keeping
   *  one would let a later real mention of the user's term through unredacted (tokenize()
   *  skips anything already in tokenValue). Matches the fail-toward-brackets rule every
   *  other guard in mintPlaceholder follows. */
  private matchesCustomRule(candidate: string): boolean {
    if (!this.customMatcher) return false;
    try {
      return this.customMatcher(candidate).length > 0;
    } catch {
      return true;
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

  /** How many distinct identifiers have been kept local this conversation. Counts VALUES, not
   *  placeholders — recycleSurrogate can leave a value with a retired stand-in still restorable,
   *  and that is one identifier kept local, not two. */
  get count(): number {
    return this.valueToken.size;
  }
}
