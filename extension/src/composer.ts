// How to find the prompt box, shared by the ISOLATED indicator (which watches it) and the
// MAIN-world inspector (which previews what is in it). One definition, because the two must
// agree: a panel previewing a different box than the pill counts would be worse than no panel.

// One selector for all three sites — verified live that each exposes exactly one match:
// Gemini's Quill editor, ChatGPT's #prompt-textarea, and Claude's ProseMirror all render
// the composer as div[contenteditable][role="textbox"]. role="textbox" is what excludes
// Gemini's hidden .ql-clipboard; plaintext-only is future-proofing.
export const COMPOSER_SELECTOR =
  'div[contenteditable="plaintext-only"][role="textbox"], div[contenteditable="true"][role="textbox"]';

/** The composer the user is most likely working in: the focused one if there is one (editing
 *  an earlier message spawns a second contenteditable on ChatGPT/Claude), else the first.
 *
 *  `.closest`, not `.matches`: on today's three sites the contenteditable root IS the focused
 *  element, so both behave the same — but an editor that puts focus on a child node would slip
 *  past `.matches` and fall back to the *first* composer on the page (the wrong box mid-edit).
 *  `.closest` returns the composer whether the focused node is it or sits inside it, the same
 *  ancestor-climb the DOM rehydrator's `isEditable` uses. Cheap hardening, no behaviour change
 *  on the sites as they stand. */
export function findComposer(): HTMLElement | null {
  const active = document.activeElement;
  const focused = active instanceof HTMLElement ? active.closest<HTMLElement>(COMPOSER_SELECTOR) : null;
  if (focused) return focused;
  return document.querySelector<HTMLElement>(COMPOSER_SELECTOR);
}
