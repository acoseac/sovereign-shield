// The categories the guard can redact, with human labels. Shared by the options
// page, popup, and the activity log. Keys match web/lib/shield.ts PiiCategory.
export interface Category {
  key: string;
  label: string;
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
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.label]),
);

export const ALL_CATEGORY_KEYS: string[] = CATEGORIES.map((c) => c.key);
