// What the home page's live preview computes: the outgoing prompt the extension would
// produce for a piece of text. Pure — the component is only a renderer.
//
// Detection comes from `@/lib/shield`, which IS the code the extension bundles (see
// CLAUDE.md: extension/src/tokenize.ts imports web/lib/shield.ts), so the counts and
// categories on this page are the ones a user would see in the pill.
//
// Two things the demo reproduces rather than imports, because they are extension-only
// modules that the web build must not depend on:
//   - custom terms: `extension/src/custom.ts` (literal, case-insensitive, whole-word —
//     the shipped default for a plain keyword rule);
//   - smokescreen stand-ins: `extension/src/surrogate.ts`. The pools below are the HEAD
//     of the shipped ones and mint by the same rule, so the first dozen of each match
//     the extension exactly; past that the demo repeats sooner than the real thing.

import { CATEGORY_LABEL } from "@/lib/gateway";
import { detectPii } from "@/lib/shield";

const TOKEN_PREFIX: Record<string, string> = {
  ch_ahv: "AHV",
  iban: "IBAN",
  credit_card: "CARD",
  ch_phone: "PHONE",
  email: "EMAIL",
  it_cf: "CF",
  es_dni: "DNI",
  fr_nir: "NIR",
  nl_bsn: "BSN",
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
  private_key: "PEM",
  jwt: "JWT",
  aws_key: "AWS",
  anthropic_key: "ANTHROPIC",
  openai_key: "OPENAI",
  github_token: "GITHUB",
  google_api_key: "GOOGLE",
  slack_token: "SLACK",
  stripe_key: "STRIPE",
  custom: "CUSTOM",
};

// Checksum-validated categories — the ones where a match means shape AND check digit
// agreed. Secrets match on a structured credential pattern instead, and email/phone on
// shape, so neither claims a checksum in the UI.
const CHECKSUMMED = new Set([
  "ch_ahv",
  "iban",
  "credit_card",
  "it_cf",
  "es_dni",
  "fr_nir",
  "nl_bsn",
  "de_steuerid",
  "pl_pesel",
  "pt_nif",
  "be_nrn",
  "uk_nhs",
  "br_cpf",
  "br_cnpj",
  "za_id",
  "cn_resident",
  "ca_sin",
  "in_aadhaar",
]);

/** Head of the shipped pools. A category is surrogate-eligible iff it appears here —
 *  the rule that keeps every checksum-validated identifier on a bracket token, because a
 *  valid-looking fake AHV or IBAN would plausibly be a real person's number. */
const SURROGATE_POOLS: Record<string, readonly string[]> = {
  email: [
    "alice.morgan@example.org",
    "ben.walker@example.com",
    "clara.hoffmann@example.net",
    "david.laurent@example.org",
    "elena.rossi@example.com",
    "felix.jansen@example.net",
    "greta.novak@example.org",
    "henri.dubois@example.com",
  ],
  custom: [
    "Project Northwind",
    "Project Larkspur",
    "Acme Industries",
    "Brightwater Group",
    "Meridian Partners",
    "Cobalt Systems",
    "Project Kestrel",
    "Project Sandpiper",
  ],
};

function mintSurrogate(category: string, ordinal: number): string | null {
  const pool = SURROGATE_POOLS[category];
  if (!pool || ordinal < 1) return null;
  const base = pool[(ordinal - 1) % pool.length];
  const round = Math.floor((ordinal - 1) / pool.length);
  if (round === 0) return base;
  const at = base.indexOf("@");
  const suffix = String(round + 1);
  return at === -1 ? `${base}${suffix}` : `${base.slice(0, at)}${suffix}${base.slice(at)}`;
}

export interface PreviewSpan {
  start: number;
  end: number;
  category: string;
  label: string;
  /** Masked, non-identifying description of the match (never the raw value). */
  marker: string;
  token: string;
  /** What actually goes out: the token, or a stand-in under smokescreen. */
  replacement: string;
  surrogate: boolean;
  checksummed: boolean;
}

export interface Preview {
  spans: PreviewSpan[];
  /** Unique category labels, first-seen order — what the pill lists. */
  categories: string[];
  count: number;
  /** How many of the matches are surrogate-eligible (drives the pill's wording). */
  surrogatable: number;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

/** Literal, case-insensitive, whole-word matches of a custom term — the extension's
 *  default for a plain keyword rule (regex is an explicit opt-in there). */
function customHits(text: string, term: string): { start: number; end: number }[] {
  const needle = term.trim();
  if (needle.length < 2) return [];
  const out: { start: number; end: number }[] = [];
  const re = new RegExp(escapeRe(needle), "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;
    out.push({ start, end });
    re.lastIndex = end;
  }
  return out;
}

export function buildPreview(
  text: string,
  opts: { term?: string; smokescreen?: boolean } = {},
): Preview {
  const built = detectPii(text).map((h) => ({
    start: h.start,
    end: h.end,
    category: h.category as string,
    marker: h.marker,
  }));
  // Built-in hits are already non-overlapping; a custom hit that lands on one is dropped.
  const overlaps = (a: { start: number; end: number }) =>
    built.some((b) => a.start < b.end && b.start < a.end);
  const custom = customHits(text, opts.term ?? "")
    .filter((c) => !overlaps(c))
    .map((c) => ({ ...c, category: "custom", marker: "custom rule" }));

  const all = [...built, ...custom].sort((a, b) => a.start - b.start);

  const tokenOf = new Map<string, { token: string; ordinal: number }>();
  const counters: Record<string, number> = {};
  const spans: PreviewSpan[] = [];

  for (const h of all) {
    const value = text.slice(h.start, h.end);
    // Never mint a second placeholder for a value already mapped — a repeated value has
    // to keep its token, or the reply can't be rehydrated.
    let assigned = tokenOf.get(value);
    if (!assigned) {
      const prefix = TOKEN_PREFIX[h.category] ?? h.category.toUpperCase();
      const ordinal = (counters[prefix] = (counters[prefix] ?? 0) + 1);
      assigned = { token: `[${prefix}_${ordinal}]`, ordinal };
      tokenOf.set(value, assigned);
    }
    const stand = opts.smokescreen ? mintSurrogate(h.category, assigned.ordinal) : null;
    spans.push({
      start: h.start,
      end: h.end,
      category: h.category,
      label: CATEGORY_LABEL[h.category] ?? h.category,
      marker: h.marker,
      token: assigned.token,
      replacement: stand ?? assigned.token,
      surrogate: stand !== null,
      checksummed: CHECKSUMMED.has(h.category),
    });
  }

  const categories: string[] = [];
  for (const s of spans) if (!categories.includes(s.label)) categories.push(s.label);

  return {
    spans,
    categories,
    count: spans.length,
    surrogatable: spans.filter((s) => SURROGATE_POOLS[s.category] !== undefined).length,
  };
}

/** The pre-send pill's copy, mirroring `extension/src/indicator.ts → pillText`. */
export function pillText(p: Preview, smokescreen: boolean): string {
  const noun = p.count === 1 ? "item" : "items";
  let how = "kept local";
  if (smokescreen && p.surrogatable > 0) {
    how =
      p.surrogatable === p.count
        ? "kept local (stand-ins sent instead)"
        : "kept local (stand-ins where supported)";
  }
  return `🛡️ ${p.count} ${noun} (${p.categories.join(", ")}) will be ${how} when you send`;
}
