# ADR 0004 — Smokescreen mode: synthetic stand-ins instead of bracket placeholders

**Status:** Accepted · **Date:** July 2026 · **Amended:** August 2026 (themed pools, below)

## Context

The guard redacts by substituting bracket placeholders — `[EMAIL_1]`, `[AHV_1]` — minted in
`extension/src/tokenize.ts` and restored in the painted DOM. That is exactly right for
analytical prompts, and it is unambiguous: a bracket token matches no detector, so it can
never be confused with real data.

It is wrong for *generative* work. Asked to draft an email, fix grammar, adjust tone or
reformat a block of text, models visibly degrade when the prompt is full of `[EMAIL_1]`:
they address the placeholder, refuse, or produce copy that reads wrong once the real value
is substituted back. Users noticed and worked around it by turning the guard off for
exactly the tasks where a leak is most likely — pasting a real customer email to get help
replying to it.

A realistic stand-in (`alice.morgan@example.org`) keeps the prompt natural while the real
value still never leaves the page. But a stand-in is, by design, indistinguishable from
real data — and that is what makes this feature more than a string swap.

## Decision

### 1. A category is surrogate-eligible **iff** it has a vendored pool

`extension/src/surrogate.ts` holds `SURROGATE_POOLS`, keyed by category. Membership in that
object is the *only* way a category opts in. v1 ships pools for `email` and `custom`; the
NER work will add `person`, `org` and `location`.

Everything else — `ch_ahv`, `iban`, `credit_card`, every national ID, and all nine secret
categories — keeps bracket tokens **always**, even with the mode on. This is deliberate and
load-bearing: a checksum-**valid** synthetic AHV, IBAN or card number is, by construction,
plausibly **a real person's actual identifier**. Minting one would be worse than the problem
it solves. Models don't need a plausible IBAN to write a good email; the generative win comes
almost entirely from names and addresses.

Emails draw only on **RFC 2606 reserved domains** (`example.org`/`.com`/`.net`), which are
permanently reserved for documentation and cannot route mail, so a stand-in address can never
belong to a real person. `ch_phone` is deliberately excluded: Switzerland has no equivalent of
the UK's `07700 900xxx` drama range, so any "realistic" Swiss mobile number we invented might
be a live subscriber's.

Minting is **deterministic** given `(category, ordinal)` — never random — so tests are stable
and a conversation always produces the same stand-ins. Past the end of a pool the ordinal
folds in as a suffix (`alice.morgan2@example.org`), keeping the supply unbounded and
collision-free.

### 2. Opt-in, default OFF

Unlike the guard itself — which defaults **on** and redacts even before the bridge has
reported settings, because failing safe means redacting — smokescreen defaults **off**. It
changes what the model actually sees, so it waits for an explicit user decision. The MAIN-world
guard treats only `data-ss-smoke="on"` as truthy; a missing attribute means brackets.

Toggling mid-conversation is safe by construction: `valueToken` maps value → placeholder, so a
value already seen keeps whatever placeholder it was first given. Only values encountered
afterwards are affected — no remapping, no broken rehydration.

### 3. Three consequences of stand-ins looking like real data

Each of these is a bug the bracket design never had, and each is pinned by a test in
`extension/test/surrogate.test.ts`.

- **A stand-in is re-detectable, so it must never be re-tokenized.**
  `alice.morgan@example.org` *is* a valid email. Gemini's `f.req` carries prior turns, and
  users paste model output back into the composer ("now revise this draft"), so a stand-in
  does come back through `tokenize()`. Without a guard it would be detected as a fresh value
  and mapped to a **second** stand-in, corrupting the thread and breaking rehydration for
  both. `Session.tokenize` therefore skips any span already present in `tokenValue` — it is
  already one of our placeholders, so it passes through byte-identical.

- **A stand-in carries no marker, so the DOM fast path had to change.** The rehydrator in
  `interceptor.ts` short-circuited on `!nodeValue.includes("[")` before ever calling
  `rehydrate()`. A stand-in has no bracket, so every one of them would have failed to restore
  on screen while looking perfectly correct on the wire. That check is now
  `session.mayNeedRehydration(v)`, which must be **text-specific** (asking "does this session
  have stand-ins?" would return true for every node on the page and delete the fast path
  exactly during a long streaming reply) and **case-insensitive**, to agree with the
  alternation below.

- **Restoration is best-effort, and the UI must not imply otherwise.** Rehydration matches
  the literal stand-in, word-boundary fenced with the same ASCII lookarounds `custom.ts` uses,
  longest-first, and case-insensitively — so a model that re-cases the value still restores.
  A model that reformats it any other way (inserting a space, translating a name, splitting it
  across markup) is **unrecoverable**, and the value simply stays as the harmless stand-in.

A fourth, subtler consequence falls out of the first: because `tokenize()` skips anything
already in `tokenValue`, a pool value that happened to equal one of the **user's own custom
rules** would make their real mention of that term pass through unredacted. Narrow, but a
leak — so a candidate stand-in is refused at mint time if the user's blocklist matches it,
and the value degrades to a bracket token instead.

Live stand-ins are capped (`MAX_SURROGATES = 64`); beyond the cap new values fall back to
bracket tokens. The cap is not arbitrary: every stand-in adds an alternative to the rehydrate
regex *and* a needle to the prefilter that runs on every streamed text node, so an unbounded
map becomes visible jank. Bracket-only sessions never build either structure, so behaviour
with the mode off is bit-identical to before this feature existed.

## Consequences

- Smokescreen is extension-only and **does not touch the parity-locked shield**. Detection is
  unchanged — this changes only what a detected value is replaced *with*. `web/lib/shield.ts`
  and `src/sovereign_shield/` are untouched, so no parity vectors need regenerating.
- The "nothing sensitive is persisted" promise is unchanged: the value↔stand-in map lives in
  page memory only, and the activity log stays category-only.
- A user reading a chat transcript out of context can no longer tell at a glance that
  redaction happened — `[EMAIL_1]` was self-announcing, `alice.morgan@example.org` is not. The
  pre-send pill says so explicitly ("stand-ins sent instead"), and the options copy spells out
  which categories are affected.
- Adding a category to `SURROGATE_POOLS` is a **security-relevant** change, not a cosmetic
  one. Never add a checksum-validated category, and never add a pool whose values could
  collide with real-world data.

## Amendment (August 2026): themed pools

The decision above is unchanged; this records how selectable **themes** (Plain / Sci-Fi /
Fantasy / Shakespeare, `extension/src/surrogate.ts` `THEME_POOLS`) fit inside it. Themes are
presentation within the same rules, never an exception to them:

- **Eligibility is theme-independent by construction.** `surrogateEligible` is keyed off the
  plain pools alone, and a test asserts every theme carries exactly the plain category set.
  A theme can re-skin a pool; it can never opt a category in — so the pre-send pill's
  `surrogatable` count (summarize.ts) agrees with the guard whatever theme is selected, and
  the checksum/secret prohibition cannot be bypassed cosmetically.
- **Every themed email stays unroutable**: RFC 2606 domains or a label under the RFC 6761
  `.example` TLD. Every themed entry must be re-detected by the shield's own email detector
  (pinned by test), because re-detectability is what drives the no-re-tokenize guard.
- **Names are public domain or invented.** Shakespeare and pre-1900 legend/myth (Arthurian,
  Grimm, Norse, Greek) are fine; franchise marks (Tolkien, Star Wars/Trek, Doctor Who…) are
  not — a redaction tool must not paste someone's trademark into users' prompts. Pinned by a
  denylist test.
- **Mid-session switching is safe** for the same reason mid-session toggling was: minted
  stand-ins live in `Session.tokenValue`/`surrogates` and the rehydrate alternation is built
  from those strings, so earlier stand-ins keep restoring; the theme is read per send and
  affects only future mints. Ordinal counters are shared across themes and never rewound, so
  no ordinal repeats; if two themes ever carried an identical string (they must not — global
  uniqueness across all pools of all themes is tested), `candidateSurrogate`'s existing
  collision checks would refuse it and degrade to a bracket token.
- The theme is an ordinary local setting (`ssTheme`), mirrored to the MAIN world as
  `data-ss-theme` and **re-validated on every read** — an unknown value degrades to plain.
  It changes nothing about what is detected, stored or logged, so the privacy surface is
  untouched.
