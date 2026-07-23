// Stacking order for everything the extension paints over a host page.
//
// In one place because the three surfaces live in three files (and two worlds), and their
// relative order is load-bearing rather than cosmetic — a number nudged in isolation is
// exactly how the pill ended up floating on top of the panel meant to explain it.
//
// Top of the stack downwards:
//   BANNER — "redaction is broken / this send was not inspected". Must never be covered by
//            anything, least of all by our own UI reassuring the user things are fine.
//   PANEL  — the inspector. Above the pill, because it opens FROM the pill and overlaps it.
//   PILL   — the pre-send indicator. Ambient, so it yields to both.
export const Z_BANNER = 2147483647;
export const Z_PANEL = 2147483646;
export const Z_PILL = 2147483645;
