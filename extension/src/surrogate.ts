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
//
// THEMES are presentation inside those constraints, never an exception to them (see the
// amendment in ADR 0004). Every theme re-skins the SAME category set as the plain pools —
// eligibility is keyed off the plain pools alone, so "which categories may take a stand-in"
// can never depend on a cosmetic choice. Pool-content rules that apply to every theme:
//
//   - Emails use only reserved, unroutable suffixes: the RFC 2606 domains
//     (example.org/.com/.net) or a label under the RFC 6761 `.example` TLD
//     (e.g. camelot.example). A stand-in address can never belong to a real person.
//   - Names come from the public domain (pre-1900 legend, myth, Shakespeare) or are
//     invented originals. NO franchise marks: Tolkien, Star Wars/Trek, Doctor Who etc.
//     are actively trademarked, and a redaction tool must not paste someone's mark into
//     users' prompts. Pinned by a denylist test.
//   - Within every pool: no duplicate values anywhere across ALL themes, no local-part
//     prefix pairs, no stem ending in a digit (the overflow suffix scheme depends on it),
//     at least 8 entries. Appended to, never reordered — minting is deterministic on
//     (category, ordinal), so moving an entry would silently change every stand-in an
//     existing conversation had minted.

/** The selectable stand-in themes. `plain` is the default and the back-compat behaviour. */
export const THEME_IDS = ["plain", "scifi", "fantasy", "shakespeare"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);
}

/**
 * The original pools, byte-identical and order-preserved (append-only forever). These stay
 * a named object because they are load-bearing twice over: `surrogateEligible` is keyed off
 * THIS object alone, and `web/lib/demo.ts` mirrors its head entries.
 */
const PLAIN_POOLS: Readonly<Record<string, readonly string[]>> = {
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

/** Invented originals — spacefaring register, no franchise names. */
const SCIFI_POOLS: Readonly<Record<string, readonly string[]>> = {
  email: [
    "astra.venn@starhaven.example",
    "cael.morrow@orbital-relay.example",
    "dax.holloway@deepfield.example",
    "elara.quill@nova-terminus.example",
    "juno.calder@voidrunner.example",
    "kai.sterling@outer-arm.example",
    "lyra.vance@astral-freight.example",
    "mira.solano@redshift-labs.example",
    "nix.harrow@ion-drive.example",
    "orin.bellweather@stellar-cartography.example",
    "petra.skye@gravity-well.example",
    "rhea.calloway@moonside.example",
    "sable.antares@warpline.example",
    "talia.marsh@cometary.example",
    "ursa.pendrell@darkmatter.example",
    "zephyr.locke@heliopause.example",
  ],
  custom: [
    "Project Redshift",
    "Project Ionwake",
    "Project Cryosleep",
    "Project Heliopause",
    "Orbital Dynamics Group",
    "Deepfield Systems",
    "Nova Circuit Labs",
    "Asteria Logistics",
    "Project Gravity Well",
    "Outer Arm Ventures",
    "Starfall Holdings",
    "Project Umbriel",
  ],
};

/** Pre-1900 public domain only: Arthurian legend, Grimm, Norse and Greek myth.
 *  Deliberately NOT Tolkien or any modern fantasy — those names are trademarked. */
const FANTASY_POOLS: Readonly<Record<string, readonly string[]>> = {
  email: [
    "arthur.pendragon@camelot.example",
    "morgana.lefay@avalon.example",
    "merlin.ambrosius@broceliande.example",
    "lancelot.dulac@roundtable.example",
    "elaine.astolat@astolat.example",
    "tristan.lyonesse@cornwall.example",
    "isolde.whitehands@brittany.example",
    "gawain.orkney@greenchapel.example",
    "percival.gales@grailquest.example",
    "gretel.tannenwald@gingerbread.example",
    "rapunzel.turmfrau@briarrose.example",
    "freya.vanadis@asgard.example",
    "sigurd.volsung@rhinegold.example",
    "circe.aiaia@aegean.example",
    "atalanta.arcadia@calydon.example",
    "nimue.lakemaiden@lakecourt.example",
  ],
  custom: [
    "Project Excalibur",
    "Project Grail",
    "Round Table Group",
    "Avalon Holdings",
    "Project Briar Rose",
    "Gingerbread Labs",
    "Project Rhinegold",
    "Camelot Systems",
    "Project Wyvern",
    "Broceliande Partners",
    "Project Selkie",
    "Nine Realms Ventures",
  ],
};

/** The plays are four centuries into the public domain. */
const SHAKESPEARE_POOLS: Readonly<Record<string, readonly string[]>> = {
  email: [
    "hamlet.dane@elsinore.example",
    "ophelia.polonia@elsinore.example",
    "viola.cesario@illyria.example",
    "rosalind.ganymede@arden.example",
    "beatrice.messina@muchado.example",
    "benedick.padua@muchado.example",
    "prospero.milan@tempestisle.example",
    "miranda.naples@tempestisle.example",
    "portia.belmont@venicecourt.example",
    "cordelia.lear@albion.example",
    "titania.moonwood@midsummer.example",
    "oberon.nightcourt@midsummer.example",
    "macduff.fife@dunsinane.example",
    "hermione.sicilia@winterstale.example",
    "orlando.deboys@ardenforest.example",
    "imogen.cymbeline@britaincourt.example",
  ],
  custom: [
    "Project Elsinore",
    "Project Illyria",
    "Globe Stage Partners",
    "Arden Forest Group",
    "Project Tempest",
    "Verona Holdings",
    "Dunsinane Systems",
    "Project Winters Tale",
    "Belmont Ventures",
    "Project Birnam Wood",
    "Padua Labs",
    "Project Twelfth Night",
  ],
};

/** Every theme's pools. Each theme must cover EXACTLY the plain categories — pinned by
 *  test — so eligibility (below) answers the same for every theme by construction. */
export const THEME_POOLS: Readonly<
  Record<ThemeId, Readonly<Record<string, readonly string[]>>>
> = {
  plain: PLAIN_POOLS,
  scifi: SCIFI_POOLS,
  fantasy: FANTASY_POOLS,
  shakespeare: SHAKESPEARE_POOLS,
};

/**
 * Back-compat alias: the plain pools under their historic name. Kept exported because the
 * pinned tests in surrogate.test.ts assert against it positionally, and because it IS the
 * safety-property object — see surrogateEligible.
 */
export const SURROGATE_POOLS = PLAIN_POOLS;

/** First entry of each pool, for the options page's live "e.g. …" hint next to the theme
 *  picker. Derived from the pools so the hint can never drift from what would be minted. */
export function themePreview(theme: ThemeId): { email: string; custom: string } {
  const pools = isThemeId(theme) ? THEME_POOLS[theme] : PLAIN_POOLS;
  return { email: pools.email?.[0] ?? "", custom: pools.custom?.[0] ?? "" };
}

/**
 * Cap on live surrogates per session. Past this, new values fall back to bracket tokens —
 * still fully redacted, just less natural. Bounded on purpose: every minted surrogate adds
 * an alternative to the rehydrate regex AND a needle to the hot-path prefilter that runs on
 * every streamed text node, so an unbounded map would turn into visible jank during a long
 * reply. 64 is far above any realistic conversation while keeping both structures small.
 */
export const MAX_SURROGATES = 64;

/**
 * Whether `category` can take a synthetic stand-in. Keyed off the PLAIN pools alone, on
 * purpose: eligibility is the safety property (see the header), and summarize.ts's
 * pre-send "surrogatable" count relies on the answer being identical whatever theme the
 * user picked. A theme can re-skin a pool; it can never opt a category in.
 */
export function surrogateEligible(category: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLAIN_POOLS, category);
}

/**
 * Mint the stand-in for the `ordinal`-th distinct value of `category` (1-based, matching the
 * token counters in tokenize.ts). Returns null when the category has no pool — the caller
 * then falls back to a bracket token.
 *
 * `theme` defaults to plain so the pre-theme call sites and tests keep their exact
 * behaviour: mintSurrogate(c, n) === mintSurrogate(c, n, "plain"), always.
 *
 * Past the end of the pool the ordinal is folded back in as a numeric suffix
 * (`alice.morgan@example.org` → `alice.morgan2@example.org`), so the supply is unbounded and
 * every value stays distinct. For an email the suffix goes on the local part to keep the
 * reserved domain intact; anything else just gets it appended.
 */
export function mintSurrogate(
  category: string,
  ordinal: number,
  theme: ThemeId = "plain",
): string | null {
  // Defensive fallback: theme reaches the guard via a data-* attribute a page script could
  // scribble on, and category is an open string. Both lookups therefore refuse anything not
  // an OWN property — a bare index would resolve "constructor"/"toString" through
  // Object.prototype and hand back a function instead of a pool (review catch). Callers
  // validate with isThemeId/surrogateEligible already; this makes the function safe alone.
  const pools = isThemeId(theme) ? THEME_POOLS[theme] : PLAIN_POOLS;
  const pool = Object.prototype.hasOwnProperty.call(pools, category) ? pools[category] : undefined;
  if (!pool || pool.length === 0 || !Number.isInteger(ordinal) || ordinal < 1) return null;
  const base = pool[(ordinal - 1) % pool.length];
  const round = Math.floor((ordinal - 1) / pool.length);
  if (round === 0) return base;
  const at = base.indexOf("@");
  const suffix = String(round + 1);
  return at === -1 ? `${base}${suffix}` : `${base.slice(0, at)}${suffix}${base.slice(at)}`;
}
