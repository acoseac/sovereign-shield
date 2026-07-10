// Stateful tokenizer for one Gemini conversation. Mirrors web/lib/gateway.ts
// (tokenizeText / detokenize) but keeps its value<->token map across turns, so
// the same identifier gets the same placeholder every time and the reply can be
// restored. Detection is the parity-gated shield — checksum-validated identifiers
// only, so clean text passes through untouched.
import { detectPii } from "../../web/lib/shield";

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
};

/**
 * Per-conversation redaction state. Held only in page memory; never persisted,
 * never sent anywhere.
 */
export class Session {
  private readonly valueToken = new Map<string, string>();
  private readonly tokenValue = new Map<string, string>();
  private readonly counters: Record<string, number> = {};

  /** Fired once per newly-minted token (distinct value), with its category only. */
  onMint?: (category: string) => void;

  /**
   * Replace every checksum-valid identifier in `text` with a stable placeholder.
   * If `allowed` is given, only those categories are tokenized; the rest pass through.
   */
  tokenize(text: string, allowed?: ReadonlySet<string>): string {
    const hits = detectPii(text);
    if (hits.length === 0) return text;
    // Replace back-to-front so earlier offsets stay valid as we splice.
    let out = text;
    for (const h of [...hits].sort((a, b) => b.start - a.start)) {
      if (allowed && !allowed.has(h.category)) continue;
      const value = text.slice(h.start, h.end);
      let token = this.valueToken.get(value);
      if (!token) {
        const prefix = TOKEN_PREFIX[h.category] ?? h.category.toUpperCase();
        this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
        token = `[${prefix}_${this.counters[prefix]}]`;
        this.valueToken.set(value, token);
        this.tokenValue.set(token, value);
        this.onMint?.(h.category);
      }
      out = out.slice(0, h.start) + token + out.slice(h.end);
    }
    return out;
  }

  /**
   * Swap placeholders back to their real values. A token split across two stream
   * chunks (e.g. "[AHV_" now, "1]" next chunk) simply is not matched yet — it gets
   * restored once the closing chunk arrives, so partial reads never corrupt text.
   */
  rehydrate(text: string): string {
    if (this.tokenValue.size === 0 || !text.includes("[")) return text;
    let out = text;
    for (const [token, value] of this.tokenValue) {
      if (out.includes(token)) out = out.split(token).join(value);
    }
    return out;
  }

  /** How many distinct identifiers have been kept local this conversation. */
  get count(): number {
    return this.tokenValue.size;
  }
}
