// Tests for clipboard rehydration — the third surface where real values are restored
// (ADR 0005). The DOM wiring in clipboard.ts is a thin shell; everything decided here is
// in the pure rehydrateClipboardText / escapeHtml, same split as rewrite.ts and summarize.ts.
//
// The load-bearing case is the smokescreen one: with the mode on, an unrehydrated copy does
// not merely look broken, it hands the user a FABRICATED email address that reads as real.
import assert from "node:assert/strict";
import test from "node:test";

import {
  escapeHtml,
  planClipboardRewrite,
  rehydrateClipboardText,
  rehydrateFlavour,
} from "../src/clipboard.ts";
import { Session } from "../src/tokenize.ts";
import { SURROGATE_POOLS } from "../src/surrogate.ts";
import { compileRules } from "../src/custom.ts";

const AHV = "756.1234.5678.97";
const EMAIL = "hans.muster@bluewin.ch";

// --- "leave it alone" cases: null means do not touch the clipboard at all ----

test("clean text returns null (nothing to restore)", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  assert.equal(rehydrateClipboardText(s, "nothing sensitive here"), null);
});

test("an empty session returns null even for token-shaped text", () => {
  assert.equal(rehydrateClipboardText(new Session(), "call me on [AHV_1]"), null);
});

test("non-strings and empty strings return null rather than throwing", () => {
  const s = new Session();
  s.tokenize(AHV);
  for (const input of [undefined, null, 42, {}, [], ""]) {
    assert.equal(rehydrateClipboardText(s, input), null, `input ${JSON.stringify(input)}`);
  }
});

test("already-rehydrated text returns null — the hook is a no-op on DOM-sourced copies", () => {
  // Whichever source a site copies from, this must be safe. If its Copy button already
  // serves the painted (restored) text, we must not touch the clipboard.
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  assert.equal(rehydrateClipboardText(s, `the number is ${AHV}`), null);
});

// --- the actual restore ------------------------------------------------------

test("a bracket token in copied markdown is restored", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV} and ${EMAIL}`);
  assert.equal(
    rehydrateClipboardText(s, "Dear [EMAIL_1], your number [AHV_1] is on file."),
    `Dear ${EMAIL}, your number ${AHV} is on file.`,
  );
});

test("a smokescreen stand-in is restored — the fabricated-data escape path", () => {
  const s = new Session();
  s.smokescreen = true;
  const stand = s.tokenize(EMAIL);
  assert.ok(SURROGATE_POOLS.email.includes(stand), "should have minted a pool stand-in");
  // What the site's Copy button serves is the model's source text, which still carries the
  // stand-in. Unrehydrated, the user pastes a plausible address that belongs to nobody.
  assert.equal(
    rehydrateClipboardText(s, `Reply to ${stand} by Friday.`),
    `Reply to ${EMAIL} by Friday.`,
  );
});

test("a re-cased stand-in still restores (models reformat)", () => {
  const s = new Session();
  s.smokescreen = true;
  const stand = s.tokenize(EMAIL);
  assert.equal(rehydrateClipboardText(s, `Mail ${stand.toUpperCase()}.`), `Mail ${EMAIL}.`);
});

// --- text/html flavour -------------------------------------------------------

test("escapeHtml neutralises the characters that could corrupt markup", () => {
  assert.equal(escapeHtml(`Tom & "Jerry" <inc>`), "Tom &amp; &quot;Jerry&quot; &lt;inc&gt;");
  assert.equal(escapeHtml(EMAIL), EMAIL, "an ordinary identifier passes through unchanged");
});

test("the html flavour restores inside markup, escaping the substituted value", () => {
  // A user's custom-blocklist term is arbitrary text, so it is the one value that can carry
  // markup characters into the HTML flavour a rich paste target (Gmail) will read.
  const s = new Session();
  s.customMatcher = (text: string) => {
    const at = text.indexOf("Smith & Sons");
    return at === -1 ? [] : [{ start: at, end: at + "Smith & Sons".length }];
  };
  assert.equal(s.tokenize("client Smith & Sons"), "client [CUSTOM_1]");
  assert.equal(
    rehydrateClipboardText(s, "<p>Invoice for [CUSTOM_1].</p>", escapeHtml),
    "<p>Invoice for Smith &amp; Sons.</p>",
  );
});

test("without the escaper the same value would go in raw (why map exists)", () => {
  const s = new Session();
  s.customMatcher = (text: string) => {
    const at = text.indexOf("Smith & Sons");
    return at === -1 ? [] : [{ start: at, end: at + "Smith & Sons".length }];
  };
  s.tokenize("client Smith & Sons");
  assert.equal(
    rehydrateClipboardText(s, "<p>Invoice for [CUSTOM_1].</p>"),
    "<p>Invoice for Smith & Sons.</p>",
  );
});

// --- which source a copy event is actually going to use ----------------------
// Getting this branch wrong is not cosmetic: read the site's setData() when the browser was
// going to discard it and we PROMOTE dead data; read the selection when the site owns the
// payload and we miss the rewrite entirely.

const evt = (over: Partial<Parameters<typeof planClipboardRewrite>[1]>) => ({
  defaultPrevented: false,
  plain: "",
  html: "",
  selection: "",
  htmlSelection: () => "",
  ...over,
});

test("uncancelled + already-restored selection → touch nothing", () => {
  // The overwhelmingly common path: Ctrl-C over a painted reply. The DOM rehydrator already
  // restored it, so cancelling would only cost us the browser's other flavours.
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  assert.deepEqual(planClipboardRewrite(s, evt({ selection: `number ${AHV}` })), {
    writes: [],
    cancel: false,
  });
});

test("uncancelled + tokenized selection → cancel and substitute (execCommand shim)", () => {
  // A copy button that stuffs markdown into a hidden textarea, selects it and calls
  // execCommand("copy") lands here, and that text never passed the DOM rehydrator.
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  assert.deepEqual(planClipboardRewrite(s, evt({ selection: "number [AHV_1]" })), {
    writes: [{ format: "text/plain", data: `number ${AHV}` }],
    cancel: true,
  });
});

test("uncancelled → the site's setData is ignored, because the browser will discard it too", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  assert.deepEqual(
    planClipboardRewrite(s, evt({ plain: "number [AHV_1]", selection: "" })),
    { writes: [], cancel: false },
  );
});

test("cancelled → rewrite both flavours, and never re-take a decision already made", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV} for ${EMAIL}`);
  assert.deepEqual(
    planClipboardRewrite(
      s,
      evt({
        defaultPrevented: true,
        plain: "[EMAIL_1] — [AHV_1]",
        html: "<p><a>[EMAIL_1]</a> — [AHV_1]</p>",
      }),
    ),
    {
      writes: [
        { format: "text/plain", data: `${EMAIL} — ${AHV}` },
        { format: "text/html", data: `<p><a>${EMAIL}</a> — ${AHV}</p>` },
      ],
      cancel: false,
    },
  );
});

test("cancelled + clean payload → no writes at all", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  assert.deepEqual(
    planClipboardRewrite(s, evt({ defaultPrevented: true, plain: "just some prose" })),
    { writes: [], cancel: false },
  );
});

test("cancelling replaces the browser's html flavour instead of dropping it", () => {
  // preventDefault takes the browser's own text/html with it, so a paste into Gmail would
  // otherwise lose every link, list and bold in the selection.
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  assert.deepEqual(
    planClipboardRewrite(
      s,
      evt({ selection: "number [AHV_1]", htmlSelection: () => "<b>number</b> [AHV_1]" }),
    ),
    {
      writes: [
        { format: "text/plain", data: `number ${AHV}` },
        { format: "text/html", data: `<b>number</b> ${AHV}` },
      ],
      cancel: true,
    },
  );
});

test("cancelling keeps markup that needed no rehydration at all", () => {
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  const plan = planClipboardRewrite(
    s,
    evt({ selection: "[AHV_1]", htmlSelection: () => "<ul><li>formatting</li></ul>" }),
  );
  assert.deepEqual(plan.writes[1], {
    format: "text/html",
    data: "<ul><li>formatting</li></ul>",
  });
});

test("the html selection is never serialised on the common no-op path", () => {
  // cloneContents over a large selection on every single Ctrl-C would be a real cost.
  const s = new Session();
  s.tokenize(`AHV ${AHV}`);
  let calls = 0;
  planClipboardRewrite(
    s,
    evt({
      selection: `already real ${AHV}`,
      htmlSelection: () => {
        calls++;
        return "";
      },
    }),
  );
  assert.equal(calls, 0);
});

test("escapeHtml covers both quote forms", () => {
  assert.equal(escapeHtml(`O'Brien & "Co" <x>`), "O&#39;Brien &amp; &quot;Co&quot; &lt;x&gt;");
});

// --- rehydrateFlavour: which clipboard flavours write() rewrites --------------
//
// Gemini's Copy button calls navigator.clipboard.write([ClipboardItem]) with
// types ["text/html","text/plain"] — confirmed against the live site. It fires neither
// writeText nor a `copy` event, so until the write() hook existed every copy of a reply
// left the tab unrehydrated: with smokescreen on, a FABRICATED address the user cannot
// tell from a real one. These pin which flavours we touch and how each is encoded; the
// ClipboardItem plumbing itself is shell (ClipboardItem does not exist in Node).

test("text/plain is rehydrated verbatim", () => {
  const s = new Session();
  const token = s.tokenize("mail hans.muster@bluewin.ch now");
  assert.equal(rehydrateFlavour(s, "text/plain", token), "mail hans.muster@bluewin.ch now");
});

test("text/html is rehydrated with the value HTML-escaped", () => {
  // A custom blocklist term is arbitrary user text and can carry markup-significant bytes;
  // splicing it raw into the html flavour would corrupt whatever it lands in.
  const s = new Session();
  s.customMatcher = compileRules([{ kind: "keyword", pattern: `Ben & "Jerry" <co>` }]);
  const token = s.tokenize(`ship to Ben & "Jerry" <co> today`);
  const out = rehydrateFlavour(s, "text/html", `<p>${token}</p>`);
  assert.equal(out, `<p>ship to Ben &amp; &quot;Jerry&quot; &lt;co&gt; today</p>`);
});

test("a flavour we have no model of is left alone", () => {
  // Images and `web ` custom types pass through untouched — same byte-faithful rule the
  // request rewriter follows: never rewrite a payload we did not need to touch.
  const s = new Session();
  const token = s.tokenize("hans.muster@bluewin.ch");
  for (const type of ["image/png", "text/uri-list", "web text/custom", "application/json"]) {
    assert.equal(rehydrateFlavour(s, type, token), null, type);
  }
});

test("an unchanged flavour returns null so the original blob is reused", () => {
  // null is the "leave it alone" signal: the hook hands back the caller's own Blob rather
  // than constructing an identical one, keeping the no-op path allocation-free.
  const s = new Session();
  s.tokenize("hans.muster@bluewin.ch");
  assert.equal(rehydrateFlavour(s, "text/plain", "nothing sensitive here"), null);
  assert.equal(rehydrateFlavour(s, "text/html", "<p>nothing sensitive here</p>"), null);
});

test("a stand-in copied from a Gemini reply is restored on both flavours", () => {
  // The end-to-end shape of the bug: smokescreen on, the reply carries the stand-in, the user
  // hits Copy. Both flavours must come back real or the paste is fabricated data.
  const s = new Session();
  s.smokescreen = true;
  const sent = s.tokenize("write to hans.muster@bluewin.ch");
  const standIn = SURROGATE_POOLS.email.find((e) => sent.includes(e));
  assert.ok(standIn, "smokescreen should have minted an email stand-in");
  assert.equal(rehydrateFlavour(s, "text/plain", sent), "write to hans.muster@bluewin.ch");
  assert.equal(
    rehydrateFlavour(s, "text/html", `<p>${sent}</p>`),
    "<p>write to hans.muster@bluewin.ch</p>",
  );
});
