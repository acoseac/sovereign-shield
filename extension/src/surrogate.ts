// Smokescreen mode: realistic stand-in values used INSTEAD of bracket placeholders.
// Extension-only (NOT part of the parity-locked shield), pure and DOM-free so it
// unit-tests in plain Node — same shape as custom.ts / summarize.ts / rewrite.ts.
//
// Why this exists: models degrade on generative work (draft this email, fix the grammar,
// reformat this) when the prompt is full of `[EMAIL_1]`. They comment on the placeholder,
// or produce copy that reads wrong once rehydrated. A natural-looking stand-in keeps the
// prompt readable while the real value still never leaves the page.
//
// Two hard constraints shape everything here:
//
//   1. A surrogate must be GUARANTEED FAKE. Only categories with a vendored pool below are
//      eligible, which is what permanently keeps checksum-validated identifiers (AHV, IBAN,
//      card, national IDs) and secrets on bracket tokens. A checksum-VALID synthetic AHV or
//      IBAN would, by construction, plausibly be some real person's actual identifier —
//      minting one is worse than the problem it solves.
//   2. Minting must be DETERMINISTIC given (category, ordinal) — never random — so tests are
//      stable and the same conversation always produces the same stand-ins.

/**
 * Vendored pools of guaranteed-fake but natural-reading values, keyed by category key
 * (see categories.ts). **A category is surrogate-eligible iff it appears here.** That single
 * rule is the safety property — adding a pool is the only way to opt a category in, so a
 * checksum category can never acquire a synthetic value by accident.
 *
 * Email addresses use only RFC 2606 reserved domains (example.org / example.com / example.net),
 * which are permanently reserved for documentation and cannot route mail — so a surrogate
 * address can never belong to a real person.
 */
export const SURROGATE_POOLS: Readonly<Record<string, readonly string[]>> = {
  // Appended to, never reordered: mintSurrogate is deterministic on (category, ordinal), so
  // moving an entry would silently change every stand-in an existing conversation had minted.
  // New names are added at the END for that reason.
  email: [
    "alice.morgan@example.org",
    "ben.walker@example.com",
    "clara.hoffmann@example.net",
    "david.laurent@example.org",
    "elena.rossi@example.com",
    "felix.jansen@example.net",
    "greta.novak@example.org",
    "henri.dubois@example.com",
    "iris.lindqvist@example.org",
    "jonas.becker@example.com",
    "karin.andersen@example.net",
    "lucas.ferreira@example.org",
    "maja.kowalski@example.com",
    "noah.oconnell@example.net",
    "olivia.tanaka@example.org",
    "pieter.devries@example.com",
    "quentin.moreau@example.net",
    "rosa.iglesias@example.org",
    "samir.haddad@example.com",
    "tessa.bergman@example.net",
    "ulrich.vogel@example.org",
    "vera.stanescu@example.com",
    "willem.bakker@example.net",
    "yusuf.demir@example.org",
  ],
  // User-defined blocklist terms (project/client code names). Neutral, obviously-generic
  // stand-ins — they read as real code names without naming a real company. Constructed from
  // ordinary nouns rather than borrowed from anywhere, so none of them lands on a trademark.
  custom: [
    "Project Northwind",
    "Project Larkspur",
    "Acme Industries",
    "Brightwater Group",
    "Meridian Partners",
    "Cobalt Systems",
    "Project Kestrel",
    "Project Sandpiper",
    "Project Hollowbrook",
    "Ridgeline Holdings",
    "Silverbirch Group",
    "Tallgrass Ventures",
    "Ironwood Labs",
    "Blue Harbour Partners",
    "Quarrystone Group",
    "Fernbank Systems",
    "Thornfield Industries",
    "Wintermoor Associates",
  ],
};

/**
 * Cap on live surrogates per session. Past this, new values fall back to bracket tokens —
 * still fully redacted, just less natural. Bounded on purpose: every minted surrogate adds
 * an alternative to the rehydrate regex AND a needle to the hot-path prefilter that runs on
 * every streamed text node, so an unbounded map would turn into visible jank during a long
 * reply. 64 is far above any realistic conversation while keeping both structures small.
 */
export const MAX_SURROGATES = 64;

/** Whether `category` can take a synthetic stand-in. See the pools above for why. */
export function surrogateEligible(category: string): boolean {
  return Object.prototype.hasOwnProperty.call(SURROGATE_POOLS, category);
}

/**
 * Mint the stand-in for the `ordinal`-th distinct value of `category` (1-based, matching the
 * token counters in tokenize.ts). Returns null when the category has no pool — the caller
 * then falls back to a bracket token.
 *
 * Past the end of the pool the ordinal is folded back in as a numeric suffix
 * (`alice.morgan@example.org` → `alice.morgan2@example.org`), so the supply is unbounded and
 * every value stays distinct. For an email the suffix goes on the local part to keep the
 * reserved domain intact; anything else just gets it appended.
 */
export function mintSurrogate(category: string, ordinal: number): string | null {
  const pool = SURROGATE_POOLS[category];
  if (!pool || pool.length === 0 || !Number.isInteger(ordinal) || ordinal < 1) return null;
  const base = pool[(ordinal - 1) % pool.length];
  const round = Math.floor((ordinal - 1) / pool.length);
  if (round === 0) return base;
  const at = base.indexOf("@");
  const suffix = String(round + 1);
  return at === -1 ? `${base}${suffix}` : `${base.slice(0, at)}${suffix}${base.slice(at)}`;
}
