// The categories the guard can redact, with human labels. Shared by the options
// page, popup, and the activity log. Keys match web/lib/shield.ts PiiCategory.
export interface Category {
  key: string;
  label: string;
  /** UI grouping. Absent = checksum-validated identifier; "secrets" = API key / token. */
  group?: "secrets";
}

export const CATEGORIES: readonly Category[] = [
  { key: "ch_ahv", label: "Swiss AHV / AVS" },
  { key: "iban", label: "IBAN" },
  { key: "credit_card", label: "Credit card" },
  { key: "ch_phone", label: "Swiss phone" },
  { key: "email", label: "Email" },
  { key: "it_cf", label: "Codice fiscale (IT)" },
  { key: "es_dni", label: "DNI / NIE (ES)" },
  { key: "fr_nir", label: "NIR (FR)" },
  { key: "nl_bsn", label: "BSN (NL)" },
  { key: "de_steuerid", label: "Steuer-ID (DE)" },
  { key: "pl_pesel", label: "PESEL (PL)" },
  { key: "pt_nif", label: "NIF (PT)" },
  { key: "be_nrn", label: "Rijksregisternr. (BE)" },
  { key: "uk_nhs", label: "NHS number (UK)" },
  { key: "br_cpf", label: "CPF (BR)" },
  { key: "br_cnpj", label: "CNPJ (BR)" },
  { key: "za_id", label: "ID number (ZA)" },
  { key: "cn_resident", label: "Resident ID (CN)" },
  { key: "ca_sin", label: "SIN (CA)" },
  { key: "in_aadhaar", label: "Aadhaar (IN)" },
  // Secrets / API keys — pattern-matched (no checksum), high-specificity prefixes.
  { key: "aws_key", label: "AWS access key", group: "secrets" },
  { key: "openai_key", label: "OpenAI API key", group: "secrets" },
  { key: "anthropic_key", label: "Anthropic API key", group: "secrets" },
  { key: "github_token", label: "GitHub token", group: "secrets" },
  { key: "google_api_key", label: "Google API key", group: "secrets" },
  { key: "slack_token", label: "Slack token", group: "secrets" },
  { key: "stripe_key", label: "Stripe secret key", group: "secrets" },
  { key: "jwt", label: "JWT", group: "secrets" },
  { key: "private_key", label: "Private key (PEM)", group: "secrets" },
  // User-defined custom keyword / regex rules (extension-only; see custom.ts).
  { key: "custom", label: "Custom terms" },
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.label]),
);

export const ALL_CATEGORY_KEYS: string[] = CATEGORIES.map((c) => c.key);
