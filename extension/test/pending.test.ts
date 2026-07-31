// decodePending reads an attribute off <html>, which lives in a DOM the page can write to.
// Everything it returns feeds the pill's copy ("N items (…) will be kept local"), so a page
// script could otherwise make the guard appear to promise something it will not do. Treated as
// untrusted input throughout: anything that isn't the exact shape we published is rejected, and
// the caller falls back to computing its own summary.
import assert from "node:assert/strict";
import test from "node:test";

import { composerText, decodePending, invalidateComposerText } from "../src/pending.ts";
import { summarize } from "../src/summarize.ts";

const good = JSON.stringify({ c: 2, k: ["Email", "Swiss AHV / AVS"], s: 1 });

test("a well-formed summary round-trips", () => {
  assert.deepEqual(decodePending(good), {
    count: 2,
    categories: ["Email", "Swiss AHV / AVS"],
    surrogatable: 1,
  });
});

test("absent or empty means 'nothing published'", () => {
  assert.equal(decodePending(undefined), null);
  assert.equal(decodePending(""), null);
});

test("malformed or hostile payloads are rejected, never partially trusted", () => {
  const bad = [
    "not json",
    "null",
    "[]", // arrays are objects but carry none of the fields
    '"a string"',
    "42",
    JSON.stringify({ c: 2 }), // missing k and s
    JSON.stringify({ c: "2", k: [], s: 0 }), // count as a string
    JSON.stringify({ c: -1, k: [], s: 0 }), // negative count
    JSON.stringify({ c: 1, k: "Email", s: 0 }), // categories not an array
    JSON.stringify({ c: 1, k: [1, 2], s: 0 }), // categories not strings
    JSON.stringify({ c: 1, k: [], s: "1" }), // surrogatable as a string
    JSON.stringify({ c: Number.NaN, k: [], s: 0 }), // NaN survives JSON as null, but guard anyway
  ];
  for (const raw of bad) {
    assert.equal(decodePending(raw), null, raw);
  }
});

test("a zero-count summary is valid, not falsy-rejected", () => {
  // Distinct from "nothing published": the pill hides on 0, and must not fall back to its own
  // count instead — falling back would resurrect the excused value it was told to drop.
  assert.deepEqual(decodePending(JSON.stringify({ c: 0, k: [], s: 0 })), {
    count: 0,
    categories: [],
    surrogatable: 0,
  });
});

// --- why the composer text must keep its line breaks ------------------------
//
// installPendingSummary reads composer.innerText, not textContent. This pins the reason, because
// the reason is not obvious and the code was wrong about it for two releases: the old comment
// claimed missing line breaks "could only matter if an identifier were split across a block
// boundary". They matter for the ordinary case. A composer puts each line in its own block, so
// textContent concatenates them and every value that ENDS a line loses the boundary its pattern
// needs.
//
// Observed live on Gemini: the pill read "1 item (CPF (BR))" while the inspector — which reads
// innerText — correctly showed 8 spans replaced, and the guard redacted all 8.

const EIGHT_LINES = [
  "Codice fiscale (IT): MRTMTT25D09F205Z",
  "NIR (FR): 2 69 05 49 588 157 80",
  "NHS number (UK): 943 476 5919",
  "Steuer-ID (DE): 86 095 742 719",
  "NIF (PT): 501442600",
  "PESEL (PL): 44051401359",
  "Rijksregisternr (BE): 93.05.18-223.61",
  "CPF (BR): 529.982.247-25",
];

test("every identifier is counted when the block boundaries survive", () => {
  assert.equal(summarize(EIGHT_LINES.join("\n"), undefined, undefined).count, 8);
});

test("REGRESSION: concatenating the blocks loses all but the last identifier", () => {
  // This is what textContent hands back, and why reverting to it would silently gut the pill.
  // Only the final value survives, because it alone still has a clean boundary after it.
  const concatenated = summarize(EIGHT_LINES.join(""), undefined, undefined);
  assert.equal(concatenated.count, 1);
  assert.deepEqual(concatenated.categories, ["CPF (BR)"]);
});

test("the count is boundary-sensitive, so the caller MUST preserve line breaks", () => {
  // Stated as a contract rather than a curiosity: whatever installPendingSummary reads from the
  // composer has to keep the newlines, or the pill under-reports how much is being protected.
  const withBreaks = summarize(EIGHT_LINES.join("\n"), undefined, undefined).count;
  const without = summarize(EIGHT_LINES.join(""), undefined, undefined).count;
  assert.ok(withBreaks > without, "line breaks must not be droppable without changing the count");
});

// --- composerText: the publisher-level guard --------------------------------
//
// The summarize() tests above prove line breaks change the count, but they would ALL still pass
// if installPendingSummary went back to reading textContent — they never touch the publisher.
// These do: composerText is what publish() actually calls, and it is duck-typed so a plain object
// stands in for the composer with no DOM. (Raised in review of #92.)

/** A composer whose two text views disagree exactly the way a real block-based one does. */
function fakeComposer(lines: string[]) {
  return { innerText: lines.join("\n"), textContent: lines.join("") };
}

test("composerText reads innerText, so block boundaries survive", () => {
  const el = fakeComposer(EIGHT_LINES);
  assert.equal(composerText(el), EIGHT_LINES.join("\n"));
  assert.notEqual(composerText(el), el.textContent, "textContent would lose the boundaries");
});

test("REGRESSION: the publisher's text yields every identifier, not just the last", () => {
  // The end-to-end shape of the reported bug, one layer above summarize().
  assert.equal(summarize(composerText(fakeComposer(EIGHT_LINES)), undefined, undefined).count, 8);
});

test("composerText returns empty for a missing composer rather than throwing", () => {
  assert.equal(composerText(null), "");
  assert.equal(composerText(undefined), "");
});

test("the layout-forcing read is cached, keyed on the cheap one", () => {
  // innerText forces a synchronous layout and publish() runs on every focusin anywhere in the
  // document, so an unchanged composer must not pay for it twice.
  let reads = 0;
  const el = {
    textContent: "ab",
    get innerText() {
      reads++;
      return "a\nb";
    },
  };
  assert.equal(composerText(el), "a\nb");
  assert.equal(composerText(el), "a\nb");
  assert.equal(reads, 1, "second call should have been served from the cache");
});

test("the cache invalidates when the text actually changes", () => {
  const el = { textContent: "ab", innerText: "a\nb" };
  assert.equal(composerText(el), "a\nb");
  el.textContent = "abc";
  el.innerText = "a\nb\nc";
  assert.equal(composerText(el), "a\nb\nc", "a real edit must not serve a stale count");
});

test("REGRESSION: splitting a line changes innerText but NOT textContent", () => {
  // The cache bug this pins, and the reason textContent alone is not a sound key. Pressing Enter
  // turns <p>AB</p> into <p>A</p><p>B</p>: the concatenation is identical, the rendered text is
  // not. Serving the cached value would hand back exactly the run-together form composerText
  // exists to avoid — on the commonest edit there is. (Raised in review of #92.)
  const el = { textContent: "AB", innerText: "AB" };
  assert.equal(composerText(el), "AB");

  el.innerText = "A\nB"; // the split; textContent deliberately left untouched
  assert.equal(composerText(el), "AB", "stale by design until the edit is announced");

  invalidateComposerText(el); // what the input listener does
  assert.equal(composerText(el), "A\nB", "after an edit the re-read must win");
});

test("invalidating is safe on a missing composer and on one never cached", () => {
  assert.doesNotThrow(() => invalidateComposerText(null));
  assert.doesNotThrow(() => invalidateComposerText(undefined));
  assert.doesNotThrow(() => invalidateComposerText({ textContent: "x", innerText: "x" }));
});

test("invalidation does not leak across composers", () => {
  // Two composers exist while editing an earlier message; clearing one must not force the other
  // to pay a reflow it did not need.
  let readsB = 0;
  const a = { textContent: "a", innerText: "a" };
  const b = {
    textContent: "b",
    get innerText() {
      readsB++;
      return "b";
    },
  };
  composerText(a);
  composerText(b);
  invalidateComposerText(a);
  composerText(b);
  assert.equal(readsB, 1, "b should still be served from cache");
});
