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
 *  an earlier message spawns a second contenteditable on ChatGPT/Claude), else the first. */
export function findComposer(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches(COMPOSER_SELECTOR)) return active;
  return document.querySelector<HTMLElement>(COMPOSER_SELECTOR);
}
