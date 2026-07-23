// Tests for the inspector panel's one piece of real logic: turning preview() spans into the
// two sides of the diff. The rest of inspector.ts is DOM shell.
//
// This has to be right in a specific way. The panel's whole job is to be believed — a user
// checks it precisely when they are unsure whether it is safe to send. A diff that mislabels
// which bytes were replaced is worse than no diff, because it manufactures confidence.
import assert from "node:assert/strict";
import test from "node:test";

import { diffSegments } from "../src/inspector.ts";
import { Session } from "../src/tokenize.ts";

const AHV = "756.1234.5678.97";
const EMAIL = "hans.muster@bluewin.ch";

/** Reassembling the segments must reproduce the exact string that side represents. */
function joined(segments: ReturnType<typeof diffSegments>): string {
  return segments.map((s) => s.text).join("");
}

test("clean text is one unmarked run on both sides", () => {
  const s = new Session();
  const text = "nothing sensitive here";
  const preview = s.preview(text);
  for (const side of ["original", "redacted"] as const) {
    assert.deepEqual(diffSegments(text, preview, side), [{ text, mark: false }]);
  }
});

test("empty text produces no segments at all", () => {
  const s = new Session();
  assert.deepEqual(diffSegments("", s.preview(""), "original"), []);
});

test("the original side reassembles to exactly what the user typed", () => {
  const s = new Session();
  const text = `AHV ${AHV} and mail ${EMAIL} today`;
  assert.equal(joined(diffSegments(text, s.preview(text), "original")), text);
});

test("the redacted side reassembles to exactly what the provider receives", () => {
  const s = new Session();
  const text = `AHV ${AHV} and mail ${EMAIL} today`;
  const preview = s.preview(text);
  assert.equal(joined(diffSegments(text, preview, "redacted")), preview.text);
});

test("marked runs are the values on the left and the placeholders on the right", () => {
  const s = new Session();
  const text = `AHV ${AHV} and mail ${EMAIL} today`;
  const preview = s.preview(text);
  const marked = (side: "original" | "redacted") =>
    diffSegments(text, preview, side)
      .filter((seg) => seg.mark)
      .map((seg) => seg.text);
  assert.deepEqual(marked("original"), [AHV, EMAIL]);
  assert.deepEqual(marked("redacted"), ["[AHV_1]", "[EMAIL_1]"]);
});

test("unmarked runs are identical on both sides — only spans differ", () => {
  const s = new Session();
  const text = `AHV ${AHV} and mail ${EMAIL} today`;
  const preview = s.preview(text);
  const unmarked = (side: "original" | "redacted") =>
    diffSegments(text, preview, side)
      .filter((seg) => !seg.mark)
      .map((seg) => seg.text);
  assert.deepEqual(unmarked("original"), unmarked("redacted"));
  assert.deepEqual(unmarked("original"), ["AHV ", " and mail ", " today"]);
});

test("a value at the very start emits no leading empty run", () => {
  const s = new Session();
  const text = `${AHV} is the number`;
  const segments = diffSegments(text, s.preview(text), "original");
  assert.deepEqual(segments, [
    { text: AHV, mark: true },
    { text: " is the number", mark: false },
  ]);
});

test("a value at the very end emits no trailing empty run", () => {
  const s = new Session();
  const text = `the number is ${AHV}`;
  const segments = diffSegments(text, s.preview(text), "original");
  assert.deepEqual(segments, [
    { text: "the number is ", mark: false },
    { text: AHV, mark: true },
  ]);
});

test("adjacent values do not collapse into one run", () => {
  const s = new Session();
  const text = `${AHV} ${EMAIL}`;
  const segments = diffSegments(text, s.preview(text), "original");
  assert.deepEqual(segments, [
    { text: AHV, mark: true },
    { text: " ", mark: false },
    { text: EMAIL, mark: true },
  ]);
});

test("a repeated value is marked at every occurrence, with the same placeholder", () => {
  const s = new Session();
  const text = `${AHV} then again ${AHV}`;
  const preview = s.preview(text);
  const marked = diffSegments(text, preview, "redacted").filter((seg) => seg.mark);
  assert.deepEqual(
    marked.map((seg) => seg.text),
    ["[AHV_1]", "[AHV_1]"],
  );
  assert.equal(joined(diffSegments(text, preview, "redacted")), preview.text);
});

test("smokescreen stand-ins render as the marked runs, and still reassemble", () => {
  const s = new Session();
  s.smokescreen = true;
  const text = `write to ${EMAIL} please`;
  const preview = s.preview(text);
  const [marked] = diffSegments(text, preview, "redacted").filter((seg) => seg.mark);
  assert.ok(!marked.text.startsWith("["), "a stand-in, not a bracket token");
  assert.equal(joined(diffSegments(text, preview, "redacted")), preview.text);
});
