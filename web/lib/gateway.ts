import gatewayData from "@/data/gateway.json";
import { detectPii } from "@/lib/shield";

export interface Entity {
  start: number;
  end: number;
  category: string;
  token: string;
  value: string;
}
export interface GDoc {
  id: string;
  label: string;
  task: string;
  text: string;
  sanitized: string;
  entities: Entity[];
}
export interface GModel {
  id: string;
  label: string;
  vendor: string;
}
export interface Gateway {
  note: string;
  models: GModel[];
  documents: GDoc[];
  responses: Record<string, { text: string }>;
}

export const gateway = gatewayData as Gateway;

export const CATEGORY_LABEL: Record<string, string> = {
  name: "Name",
  address: "Address",
  ch_ahv: "AHV / AVS no.",
  iban: "IBAN",
  it_cf: "Codice fiscale",
  es_dni: "DNI / NIE",
  fr_nir: "NIR / SSN",
  nl_bsn: "BSN",
  ch_phone: "Phone",
  email: "Email",
  credit_card: "Card",
  de_steuerid: "Steuer-ID (DE)",
  pl_pesel: "PESEL (PL)",
  pt_nif: "NIF (PT)",
  be_nrn: "Rijksregisternr. (BE)",
  uk_nhs: "NHS number (UK)",
  br_cpf: "CPF (BR)",
  br_cnpj: "CNPJ (BR)",
  za_id: "ID number (ZA)",
  cn_resident: "Resident ID (CN)",
  ca_sin: "SIN (CA)",
  in_aadhaar: "Aadhaar (IN)",
  private_key: "Private key (PEM)",
  jwt: "JWT",
  aws_key: "AWS access key",
  anthropic_key: "Anthropic API key",
  openai_key: "OpenAI API key",
  github_token: "GitHub token",
  google_api_key: "Google API key",
  slack_token: "Slack token",
  stripe_key: "Stripe secret key",
};

export function responseFor(docId: string, modelId: string): string | null {
  return gateway.responses[`${docId}::${modelId}`]?.text ?? null;
}

/** Restore the real values in a model response by swapping placeholders back. */
export function detokenize(text: string, entities: Entity[]): string {
  let out = text;
  for (const e of entities) out = out.split(e.token).join(e.value);
  return out;
}

export interface AuditItem {
  category: string;
  label: string;
  count: number;
}

/** Per-category counts of PII in an entity list. */
export function auditOf(entities: Entity[]): { items: AuditItem[]; total: number } {
  const byCat = new Map<string, number>();
  for (const e of entities) byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
  const items = [...byCat.entries()].map(([category, count]) => ({
    category,
    label: CATEGORY_LABEL[category] ?? category,
    count,
  }));
  return { items, total: entities.length };
}

/** Per-category counts of what the gateway kept on-shore for a document. */
export function auditFor(doc: GDoc): { items: AuditItem[]; total: number } {
  return auditOf(doc.entities);
}

const TOKEN_PREFIX: Record<string, string> = {
  name: "PERSON",
  address: "ADDRESS",
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
  // Secrets / API keys — pure-uppercase-letter prefixes (see core.py _TOKEN_RE).
  private_key: "PEM",
  jwt: "JWT",
  aws_key: "AWS",
  anthropic_key: "ANTHROPIC",
  openai_key: "OPENAI",
  github_token: "GITHUB",
  google_api_key: "GOOGLE",
  slack_token: "SLACK",
  stripe_key: "STRIPE",
};

/** Live, client-side tokenization of arbitrary text (deterministic; structured
 * identifiers only — names/addresses need an NER model). Same placeholder scheme
 * as the recorded corpus. */
export function tokenizeText(text: string): { entities: Entity[]; sanitized: string } {
  const hits = [...detectPii(text)].sort((a, b) => a.start - b.start);
  const entities: Entity[] = [];
  const valueToken = new Map<string, string>();
  const counters: Record<string, number> = {};
  for (const h of hits) {
    const value = text.slice(h.start, h.end);
    let token = valueToken.get(value);
    if (!token) {
      const p = TOKEN_PREFIX[h.category] ?? h.category.toUpperCase();
      counters[p] = (counters[p] ?? 0) + 1;
      token = `[${p}_${counters[p]}]`;
      valueToken.set(value, token);
    }
    entities.push({ start: h.start, end: h.end, category: h.category, token, value });
  }
  let sanitized = text;
  for (const e of [...entities].sort((a, b) => b.start - a.start)) {
    sanitized = sanitized.slice(0, e.start) + e.token + sanitized.slice(e.end);
  }
  return { entities, sanitized };
}
