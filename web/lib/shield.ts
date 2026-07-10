// The Sovereign Compliance Shield — TypeScript port of Python `sovereign_shield.pii` +
// `sovereign_shield.shield`, kept byte-for-byte in parity via web/scripts/parity.ts against
// vectors generated from the Python source (web/lib/shield/parity-vectors.json).
// Deterministic, offline, no dependencies. This is the SAME shield the sovereign-shield
// library runs; it just runs in the browser so the demo needs no API keys and no server.

export type PiiCategory =
  | "ch_ahv"
  | "iban"
  | "it_cf"
  | "es_dni"
  | "fr_nir"
  | "nl_bsn"
  | "de_steuerid"
  | "pl_pesel"
  | "pt_nif"
  | "be_nrn"
  | "uk_nhs"
  | "br_cpf"
  | "br_cnpj"
  | "za_id"
  | "cn_resident"
  | "ca_sin"
  | "in_aadhaar"
  | "ch_phone"
  | "email"
  | "credit_card"
  | "dob";

export interface PiiHit {
  category: PiiCategory;
  marker: string; // masked, non-identifying — never the raw value
  start: number;
  end: number;
}

export interface ShieldResult {
  blocked: boolean;
  reason: string;
  safeResponse: string;
  rawViolation: boolean; // the specific contained record leaked (separator-robust)
  categories: string[];
}

// What the client receives when the shield blocks. Matches sovereign_shield.shield.CONTAINED_RESPONSE.
export const CONTAINED_RESPONSE =
  '{"status": "error", "message": ' +
  '"Response withheld: data-residency / PII containment policy (FADP)."}';

const onlyDigits = (s: string): string => s.replace(/\D/g, "");
const normRecord = (s: string): string => s.replace(/[^0-9A-Za-z]/g, "").toUpperCase();

// --- checksums (the false-positive filter; strip separators first) ---
export function ean13Ok(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(d[12]);
}

export function ibanMod97Ok(value: string): boolean {
  const iban = value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (iban.length < 5) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let mapped = "";
  for (const c of rearranged) {
    if (c >= "A" && c <= "Z") mapped += parseInt(c, 36).toString();
    else if (c >= "0" && c <= "9") mapped += c;
    else return false;
  }
  try {
    return BigInt(mapped) % 97n === 1n;
  } catch {
    return false;
  }
}

export function luhnOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length < 13 || d.length > 19) return false;
  let total = 0;
  const parity = d.length % 2;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[i]);
    if (i % 2 === parity) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
  }
  return total % 10 === 0;
}

// ISO 13616 IBAN length per country — paired with mod-97 to stay precise per country.
const IBAN_LEN: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22,
  BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22,
  DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27,
  GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28,
  IE: 22, IL: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28,
  LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22,
  MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28,
  PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24,
  SI: 19, SK: 24, SM: 27, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
};

function ibanOk(value: string): boolean {
  const iban = value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (iban.length !== IBAN_LEN[iban.slice(0, 2)]) return false;
  return ibanMod97Ok(iban);
}

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

function esDniOk(value: string): boolean {
  const s = value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(s);
  if (!m) return false;
  const [, prefix, digits, letter] = m;
  if (prefix && digits.length !== 7) return false;
  if (!prefix && digits.length !== 8) return false;
  const num = Number((prefix ? String("XYZ".indexOf(prefix)) : "") + digits);
  return DNI_LETTERS[num % 23] === letter;
}

function frNirOk(value: string): boolean {
  const s = value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (s.length !== 15 || !/^[12]/.test(s) || !/^\d{2}$/.test(s.slice(13))) return false;
  const body = s.slice(0, 13).replaceAll("2A", "19").replaceAll("2B", "18");
  if (!/^\d{13}$/.test(body)) return false;
  return 97 - (Number(body) % 97) === Number(s.slice(13));
}

// Codice Fiscale odd/even position conversion tables (odd = 1-indexed positions 1,3,…).
const CF_ODD: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

function cfEven(c: string): number {
  return /\d/.test(c) ? Number(c) : (c.codePointAt(0) ?? 0) - 65;
}

function itCfOk(value: string): boolean {
  const s = value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (!/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(s)) return false;
  let total = 0;
  for (let i = 0; i < 15; i++) total += i % 2 === 0 ? CF_ODD[s[i]] : cfEven(s[i]);
  return String.fromCodePoint(65 + (total % 26)) === s[15];
}

function nlBsnOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 9 || d === "000000000") return false;
  const w = [9, 8, 7, 6, 5, 4, 3, 2, -1];
  let total = 0;
  for (let i = 0; i < 9; i++) total += Number(d[i]) * w[i];
  return total % 11 === 0;
}

// --- EU / UK / global pack (same shape-then-checksum contract) ---
const MDAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function luhnCore(d: string): boolean {
  let total = 0;
  const parity = d.length % 2;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[i]);
    if (i % 2 === parity) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
  }
  return total % 10 === 0;
}

function deSteueridOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || d[0] === "0") return false;
  let product = 10;
  for (let i = 0; i < 10; i++) {
    let s = (Number(d[i]) + product) % 10;
    if (s === 0) s = 10;
    product = (s * 2) % 11;
  }
  return (11 - product) % 10 === Number(d[10]);
}

function plPeselOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11) return false;
  const month = Number(d.slice(2, 4)) % 20;
  const day = Number(d.slice(4, 6));
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= MDAYS[month - 1])) return false;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let total = 0;
  for (let i = 0; i < 10; i++) total += Number(d[i]) * w[i];
  return (10 - (total % 10)) % 10 === Number(d[10]);
}

function ptNifOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 9 || !"1235689".includes(d[0])) return false;
  let total = 0;
  for (let i = 0; i < 8; i++) total += Number(d[i]) * (9 - i);
  const check = 11 - (total % 11);
  return (check >= 10 ? 0 : check) === Number(d[8]);
}

function beNrnOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || Number(d.slice(2, 4)) > 12 || Number(d.slice(4, 6)) > 31) return false;
  const body = Number(d.slice(0, 9));
  const check = Number(d.slice(9));
  return 97 - (body % 97) === check || 97 - ((2000000000 + body) % 97) === check;
}

function ukNhsOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 10) return false;
  let total = 0;
  for (let i = 0; i < 9; i++) total += Number(d[i]) * (10 - i);
  let check = 11 - (total % 11);
  if (check === 11) check = 0;
  return check !== 10 && check === Number(d[9]);
}

function brCpfOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || d === d[0].repeat(11)) return false;
  for (const n of [9, 10]) {
    let total = 0;
    for (let i = 0; i < n; i++) total += Number(d[i]) * (n + 1 - i);
    const check = ((total * 10) % 11) % 10;
    if (check !== Number(d[n])) return false;
  }
  return true;
}

function brCnpjOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || d === d[0].repeat(14)) return false;
  const weightSets: [number[], number][] = [
    [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], 12],
    [[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], 13],
  ];
  for (const [weights, pos] of weightSets) {
    let total = 0;
    for (let i = 0; i < pos; i++) total += Number(d[i]) * weights[i];
    const r = total % 11;
    if ((r < 2 ? 0 : 11 - r) !== Number(d[pos])) return false;
  }
  return true;
}

function zaIdOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 13) return false;
  const month = Number(d.slice(2, 4));
  const day = Number(d.slice(4, 6));
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= MDAYS[month - 1])) return false;
  return luhnCore(d);
}

function cnIdOk(value: string): boolean {
  const s = normRecord(value);
  if (!/^\d{17}[\dX]$/.test(s)) return false;
  const year = Number(s.slice(6, 10));
  const month = Number(s.slice(10, 12));
  const day = Number(s.slice(12, 14));
  if (!(year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= MDAYS[month - 1]))
    return false;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  let total = 0;
  for (let i = 0; i < 17; i++) total += Number(s[i]) * w[i];
  return "10X98765432"[total % 11] === s[17];
}

function caSinOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 9 || d[0] === "0") return false;
  return luhnCore(d);
}

// Verhoeff dihedral-group tables for the Aadhaar check digit.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function inAadhaarOk(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 12 || d[0] === "0" || d[0] === "1") return false;
  let c = 0;
  const rev = [...d].reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(rev[i])]];
  return c === 0;
}

// --- shape regexes (priority order; specific/validated first) ---
const AHV_RE = /\b756[.  ]?\d{4}[.  ]?\d{4}[.  ]?\d{2}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[0-9A-Z]{11,30}|(?: [0-9A-Z]{4}){2,7}(?: [0-9A-Z]{1,3})?)\b/gi;
const PAN_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
const PHONE_CH_RE = /(?<!\d)(?:\+41|0041|0)(?:[ .]?\d){9}(?!\d)/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DOB_RE = /\b(?:0?[1-9]|[12]\d|3[01])[.\-/](?:0?[1-9]|1[0-2])[.\-/](?:19|20)\d{2}\b/g;
const ES_DNI_RE = /\b[XYZ]?\d{7,8}[A-Z]\b/gi;
const FR_NIR_RE = /\b[12] ?\d{2} ?\d{2} ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}\b/gi;
const IT_CF_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi;
const NL_BSN_RE = /\b\d{9}\b/g;
// EU / UK / global pack — common separators tolerated; each closed by its checksum.
const DE_STEUERID_RE = /\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b/g;
const PL_PESEL_RE = /\b\d{11}\b/g;
const PT_NIF_RE = /\b\d{3} ?\d{3} ?\d{3}\b/g;
const BE_NRN_RE = /\b\d{2}[. ]?\d{2}[. ]?\d{2}[- ]?\d{3}[. ]?\d{2}\b/g;
const UK_NHS_RE = /\b\d{3} ?\d{3} ?\d{4}\b/g;
const BR_CPF_RE = /\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b/g;
const BR_CNPJ_RE = /\b\d{2}[. ]?\d{3}[. ]?\d{3}[/ ]?\d{4}[- ]?\d{2}\b/g;
const ZA_ID_RE = /\b\d{13}\b/g;
const CN_ID_RE = /\b\d{17}[\dXx]\b/g;
const CA_SIN_RE = /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g;
const IN_AADHAAR_RE = /\b\d{4} ?\d{4} ?\d{4}\b/g;

// EU IDs render as a short prefix + last two chars (never the raw value).
const SUFFIX_MASK: Record<string, [string, (r: string) => string]> = {
  it_cf: ["cf", normRecord],
  es_dni: ["dni", normRecord],
  fr_nir: ["nir", onlyDigits],
  nl_bsn: ["bsn", onlyDigits],
  de_steuerid: ["steuerid", onlyDigits],
  pl_pesel: ["pesel", onlyDigits],
  pt_nif: ["nif", onlyDigits],
  be_nrn: ["nrn", onlyDigits],
  uk_nhs: ["nhs", onlyDigits],
  br_cpf: ["cpf", onlyDigits],
  br_cnpj: ["cnpj", onlyDigits],
  za_id: ["zaid", onlyDigits],
  cn_resident: ["cnid", normRecord],
  ca_sin: ["sin", onlyDigits],
  in_aadhaar: ["aadhaar", onlyDigits],
};

function mask(raw: string, category: PiiCategory): string {
  if (category === "ch_ahv") {
    const d = onlyDigits(raw);
    return d.length === 13 ? `756.XXXX.XXXX.${d.slice(-2)}` : "756.XXXX.XXXX.XX";
  }
  if (category === "iban") {
    const n = normRecord(raw);
    return `${n.slice(0, 2)}…${n.slice(-2)} (${n.length})`;
  }
  if (category === "credit_card") return `card:…${onlyDigits(raw).slice(-4)}`;
  if (category === "ch_phone") return `phone:…${onlyDigits(raw).slice(-2)}`;
  if (category === "email") {
    const at = raw.indexOf("@");
    const local = at >= 0 ? raw.slice(0, at) : raw;
    const domain = at >= 0 ? raw.slice(at + 1) : "";
    const head = local ? local[0] : "";
    return `${head}***@${domain}`;
  }
  const suffix = SUFFIX_MASK[category];
  if (suffix) return `${suffix[0]}:…${suffix[1](raw).slice(-2)}`;
  return "dob:XXXX-XX-XX";
}

type Detector = [PiiCategory, RegExp, ((s: string) => boolean) | null];
const DETECTORS: Detector[] = [
  ["ch_ahv", AHV_RE, ean13Ok],
  ["iban", IBAN_RE, ibanOk],
  ["it_cf", IT_CF_RE, itCfOk],
  ["es_dni", ES_DNI_RE, esDniOk],
  ["fr_nir", FR_NIR_RE, frNirOk],
  ["be_nrn", BE_NRN_RE, beNrnOk],
  ["pl_pesel", PL_PESEL_RE, plPeselOk],
  ["br_cpf", BR_CPF_RE, brCpfOk],
  ["br_cnpj", BR_CNPJ_RE, brCnpjOk],
  ["za_id", ZA_ID_RE, zaIdOk],
  ["cn_resident", CN_ID_RE, cnIdOk],
  ["de_steuerid", DE_STEUERID_RE, deSteueridOk],
  ["pt_nif", PT_NIF_RE, ptNifOk],
  ["ch_phone", PHONE_CH_RE, null],
  ["email", EMAIL_RE, null],
  ["credit_card", PAN_RE, luhnOk],
  ["uk_nhs", UK_NHS_RE, ukNhsOk],
  ["in_aadhaar", IN_AADHAAR_RE, inAadhaarOk],
  ["nl_bsn", NL_BSN_RE, nlBsnOk],
  ["ca_sin", CA_SIN_RE, caSinOk],
];

interface RawHit {
  category: PiiCategory;
  raw: string;
  start: number;
  end: number;
}

function detectRaw(text: string, includeDob = false): RawHit[] {
  const dob: Detector = ["dob", DOB_RE, null];
  const detectors: Detector[] = includeDob ? [...DETECTORS, dob] : DETECTORS;
  const accepted: RawHit[] = [];
  const spans: [number, number][] = [];
  for (const [category, pattern, validator] of detectors) {
    for (const m of text.matchAll(pattern)) {
      const raw = m[0];
      if (validator && !validator(raw)) continue;
      const start = m.index ?? 0;
      const end = start + raw.length;
      if (spans.some(([s, e]) => start < e && s < end)) continue; // overlaps higher-priority hit
      accepted.push({ category, raw, start, end });
      spans.push([start, end]);
    }
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

/** Deterministic offline PII scan. Returns masked hits only — never raw PII. */
export function detectPii(text: string, includeDob = false): PiiHit[] {
  return detectRaw(text, includeDob).map((h) => ({
    category: h.category,
    marker: mask(h.raw, h.category),
    start: h.start,
    end: h.end,
  }));
}

/** True iff `record` appears in `text` separator-insensitively (whitespace-robust). */
export function recordPresent(text: string, record: string): boolean {
  if (!record) return false;
  const target = normRecord(record);
  return detectRaw(text).some((h) => normRecord(h.raw) === target);
}

/** Replace every detected PII span with its masked marker (no-op on clean text). */
export function redactPii(text: string, includeDob = false): string {
  let out = text;
  for (const h of detectPii(text, includeDob).sort((a, b) => b.start - a.start)) {
    out = out.slice(0, h.start) + h.marker + out.slice(h.end);
  }
  return out;
}

function detectExactLeak(secret: string, response: string): boolean {
  if (!secret) return false;
  return response.toLowerCase().includes(secret.toLowerCase());
}

function recordLeaked(text: string, containedPii: string): boolean {
  if (!containedPii) return false;
  return detectExactLeak(containedPii, text) || recordPresent(text, containedPii);
}

function categoriesOf(text: string, includeDob: boolean): string[] {
  return [...new Set(detectPii(text, includeDob).map((h) => h.category as string))].sort();
}

/** Egress side: flag any Swiss/EU PII in an outbound prompt. */
export function scanPrompt(text: string, includeDob = false): ShieldResult {
  const categories = categoriesOf(text, includeDob);
  const blocked = categories.length > 0;
  return {
    blocked,
    reason: blocked ? categories.join(",") : "clean",
    safeResponse: blocked ? CONTAINED_RESPONSE : text,
    rawViolation: false,
    categories,
  };
}

/** Containment side: block if the contained record leaked OR any validated PII appears. */
export function scanCompletion(text: string, containedPii = "", includeDob = false): ShieldResult {
  const recordHit = recordLeaked(text, containedPii);
  const categories = categoriesOf(text, includeDob);
  const reasons = (recordHit ? ["contained-record"] : []).concat(categories);
  const blocked = reasons.length > 0;
  return {
    blocked,
    reason: blocked ? reasons.join(",") : "clean",
    safeResponse: blocked ? CONTAINED_RESPONSE : text,
    rawViolation: recordHit,
    categories,
  };
}
