// ISOLATED-world content script (Gemini, ChatGPT, Claude): a live pre-send indicator that
// shows how many identifiers the guard will keep local BEFORE the user hits send, so the
// otherwise-silent redaction is visible and trusted. Purely additive — it reads the
// composer text and the current settings, never the network. All counting lives in the
// pure, unit-tested summarize.ts; this file is just the DOM shell.
//
// Caveat (cosmetic): the pill counts the composer text, while the guard rewrites the
// outgoing request body. They agree for typed text; if the site ever augments the payload
// they could differ. And a keystroke landing within the ~200ms debounce right before
// Enter may not tick the pill — the guard still redacts (the XHR rewrite is synchronous).
import { getSettings, KEYS } from "./storage.ts";
import { summarize, type Summary } from "./summarize.ts";
import { compileRules, type CustomMatcher } from "./custom.ts";
import { showBanner } from "./banner.ts";
import { CANARY_GRACE_MS, isSendIntent, missedSend, readSeen } from "./canary.ts";
import { COMPOSER_SELECTOR } from "./composer.ts";
import { Z_PILL } from "./layers.ts";

const PILL_ID = "ss-indicator-pill";
const DEBOUNCE_MS = 200;
const CLIP_TOP_PX = 56; // hide if the composer scrolls above this (behind Gemini's header)

let enabled = true;
let smokescreen = false; // stand-ins instead of [TOKEN_1] placeholders (affects pill copy only)
let allowed: ReadonlySet<string> | undefined; // the guard's enabled category set
let customMatcher: CustomMatcher | undefined; // compiled user keyword/regex blocklist
let pill: HTMLElement | null = null;
let pillText_: HTMLElement | null = null; // the ellipsised label inside the pill
let activeComposer: HTMLElement | null = null;
let composerContent: MutationObserver | undefined;
let composerResize: ResizeObserver | undefined;
let wantVisible = false; // the pill has content to show (distinct from clip-hidden)
let lastRendered = ""; // last pill text, to skip no-op writes (and aria re-announcements)
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let rafPending = false;
// --- send canary state (see canary.ts) ---
let lastComposerText = ""; // to spot the non-empty -> empty drain that means "sent"
let lastIntentAt = 0; // Enter, or a press on a button beside the composer

// --- pill -----------------------------------------------------------------
function ensurePill(): HTMLElement {
  if (pill && pill.isConnected) return pill;
  pill = document.createElement("div");
  pill.id = PILL_ID;
  pill.setAttribute("role", "status");
  pill.setAttribute("aria-live", "polite");
  // Self-contained translucent-dark chip: legible on Gemini's light AND dark surfaces
  // without depending on its (undocumented) CSS variables. pointer-events:none so it
  // never intercepts clicks meant for the page; layers.ts owns where it sits in the stack.
  pill.style.cssText = [
    "position:fixed",
    "left:0;top:0",
    `z-index:${Z_PILL}`,
    "visibility:hidden",
    "pointer-events:none",
    "box-sizing:border-box",
    "max-width:90vw",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "padding:6px 8px 6px 14px",
    "border-radius:9999px",
    "background:rgba(15,23,42,.85)",
    "color:#f8fafc",
    "border:1px solid rgba(255,255,255,.15)",
    "backdrop-filter:blur(8px)",
    "-webkit-backdrop-filter:blur(8px)",
    "box-shadow:0 4px 12px rgba(0,0,0,.25)",
    "font:500 12px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif",
  ].join(";");
  // The label carries the ellipsis so a long category list truncates without squeezing the
  // button out of the pill.
  pillText_ = document.createElement("span");
  pillText_.style.cssText = "overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0";
  // The pill stays pointer-events:none — a descendant re-enabling them is the whole point, so
  // exactly one 60x20px target is clickable and the rest of the chip still can't intercept a
  // click meant for the page. mousedown is cancelled so opening the panel never pulls focus
  // out of the composer mid-sentence.
  const inspect = document.createElement("button");
  inspect.type = "button";
  inspect.textContent = "Inspect";
  inspect.title = "Show what the provider will receive";
  inspect.style.cssText =
    "pointer-events:auto;flex:none;cursor:pointer;background:rgba(255,255,255,.12);" +
    "color:inherit;border:1px solid rgba(255,255,255,.18);border-radius:9999px;" +
    "padding:2px 10px;font:inherit;font-weight:600";
  inspect.addEventListener("mousedown", (e) => e.preventDefault());
  inspect.addEventListener("click", () => {
    // Command only, no data: the panel lives in the MAIN world because that is where the real
    // values are, and nothing sensitive comes back across this boundary.
    window.postMessage({ source: "ss-ui", kind: "toggle-inspector" }, location.origin);
  });
  pill.append(pillText_, inspect);
  (document.body ?? document.documentElement).append(pill);
  return pill;
}

function hidePill(): void {
  wantVisible = false;
  lastRendered = "";
  if (pill) pill.style.visibility = "hidden";
}

// Never promise stand-ins for values that will actually be sent as bracket tokens: with
// smokescreen on, an AHV/IBAN/secret still gets [AHV_1] because minting a checksum-valid
// fake could collide with a real person's number. So the copy tracks how many of the
// detected values are genuinely surrogate-eligible — all, some, or none.
function pillText(s: Summary): string {
  const noun = s.count === 1 ? "item" : "items";
  let how = "kept local";
  if (smokescreen && s.surrogatable > 0) {
    how =
      s.surrogatable === s.count
        ? "kept local (stand-ins sent instead)"
        : "kept local (stand-ins where supported)";
  }
  return `🛡️ ${s.count} ${noun} (${s.categories.join(", ")}) will be ${how} when you send`;
}

function positionPill(): void {
  if (!pill || !wantVisible || !activeComposer?.isConnected) return;
  const r = activeComposer.getBoundingClientRect();
  if (r.top < CLIP_TOP_PX) {
    // Composer scrolled up behind the header — don't float over the nav.
    pill.style.visibility = "hidden";
    return;
  }
  pill.style.top = `${Math.max(8, r.top - pill.offsetHeight - 8)}px`;
  pill.style.left = `${Math.round(r.left)}px`;
  pill.style.visibility = "visible";
}

// --- compute + render -----------------------------------------------------
function render(): void {
  if (!enabled || !activeComposer?.isConnected) return hidePill();
  const summary = summarize(activeComposer.innerText, allowed, customMatcher);
  if (summary.count === 0) return hidePill();
  const text = pillText(summary);
  ensurePill();
  if (text !== lastRendered && pillText_) {
    // Only touch the DOM (and thus re-announce via aria-live) when the summary changes,
    // not on every keystroke — otherwise screen readers would spam.
    pillText_.textContent = text;
    lastRendered = text;
  }
  wantVisible = true;
  positionPill();
}

function scheduleRender(): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, DEBOUNCE_MS);
}

function requestReposition(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    positionPill();
  });
}

// --- send canary ----------------------------------------------------------
// Notice when a message went out that the MAIN-world guard never inspected, which is what a
// moved generate endpoint looks like from here. Decision logic lives in canary.ts; this is
// the DOM shell. Everything below is passive — no preventDefault, no composer mutation — so
// it cannot block a send, the same rule the pill follows.

/** How far up from the composer a button still counts as "the send button". Generous enough
 *  to cover the toolbar row every site puts beside/below the box, tight enough to exclude the
 *  sidebar's "new chat" (which also drains the composer, and must not corroborate). Guessing
 *  wrong only ever costs a spurious or a suppressed WARNING — never a send, never a redaction. */
const COMPOSER_SCOPE_DEPTH = 4;

function composerScope(): Element | null {
  if (!activeComposer) return null;
  const form = activeComposer.closest("form");
  if (form) return form;
  let node: Element = activeComposer;
  for (let i = 0; i < COMPOSER_SCOPE_DEPTH && node.parentElement; i++) node = node.parentElement;
  return node;
}

function noteIntent(): void {
  lastIntentAt = Date.now();
}

/** Watch the composer's text for the non-empty -> empty transition. Called undebounced from
 *  the content observer: the drain has to be timestamped against the keypress that caused it,
 *  and a 200ms debounce would blur that.
 *
 *  textContent, NOT innerText: this runs on every keystroke, and innerText forces a synchronous
 *  layout reflow — which is exactly why the pill's own recompute is debounced behind it.
 *  textContent needs no layout, and "is it empty" is a question it answers just as well. */
function noteComposerContent(): void {
  const text = activeComposer?.textContent?.trim() ?? "";
  const drained = lastComposerText !== "" && text === "";
  lastComposerText = text;
  if (drained && enabled) armCanary();
}

function armCanary(): void {
  const drainedAt = Date.now();
  if (!isSendIntent(lastIntentAt, drainedAt)) return; // a manual clear, not a send
  const seenAtDrain = readSeen(document.documentElement.dataset.ssSeen);
  setTimeout(() => {
    if (!missedSend(seenAtDrain, readSeen(document.documentElement.dataset.ssSeen))) return;
    warnMissedSend();
  }, CANARY_GRACE_MS);
}

function warnMissedSend(): void {
  // One bar per page: a site whose endpoint has moved will trip this on every message.
  showBanner({
    id: "ss-missed-send",
    tone: "warning",
    text:
      "🛡️ Sovereign Shield didn't inspect that message — it was sent as you typed it. " +
      "This site may have changed its API.",
  });
  chrome.runtime.sendMessage({ type: "ss-missed" }).catch(() => undefined);
}

// --- composer binding (no leaked listeners) -------------------------------
function bindComposer(found: HTMLElement | null = document.querySelector<HTMLElement>(COMPOSER_SELECTOR)): void {
  if (found === activeComposer) return;
  if (activeComposer) {
    // A site that REPLACES the composer on send rather than clearing it never trips the
    // content observer — the old element's text never changed, it just left the document. So
    // losing a non-empty composer counts as a drain too.
    if (lastComposerText !== "" && !activeComposer.isConnected && enabled) armCanary();
    composerContent?.disconnect();
    composerResize?.disconnect();
  }
  activeComposer = found;
  if (!activeComposer) {
    lastComposerText = "";
    return hidePill();
  }
  // Drive recompute off the composer's CONTENT, not `input` events: Gemini clears the box
  // programmatically after send (and delete/cut don't reliably fire `input`), which would
  // otherwise leave a stale count. Any DOM change → debounced recompute; this also covers
  // typing, paste and IME. The indicator never mutates the composer, so no feedback loop.
  // Drain detection runs undebounced (it must stay correlated with the keypress that caused
  // it); the pill's recompute stays debounced behind it.
  composerContent = new MutationObserver(() => {
    noteComposerContent();
    scheduleRender();
  });
  composerContent.observe(activeComposer, { childList: true, subtree: true, characterData: true });
  // Seed, so re-binding isn't read as a drain. textContent to match noteComposerContent.
  lastComposerText = activeComposer.textContent?.trim() ?? "";
  composerResize = new ResizeObserver(requestReposition); // composer grows as prompt wraps
  composerResize.observe(activeComposer);
  render();
}

// --- lifecycle ------------------------------------------------------------
async function loadSettings(): Promise<void> {
  const s = await getSettings();
  enabled = s.enabled;
  smokescreen = s.smokescreen;
  allowed = new Set(s.categories); // getSettings() defaults to all categories when unset
  customMatcher = compileRules(s.custom); // undefined when there are no (valid) rules
}

function init(): void {
  void loadSettings().then(render);
  bindComposer();
  // Bind whichever composer the user focuses — on ChatGPT/Claude, editing an earlier
  // message spawns a second contenteditable, and the pill should follow the box being
  // edited rather than the main one at the bottom.
  window.addEventListener(
    "focusin",
    (e) => {
      if (e.target instanceof HTMLElement && e.target.matches(COMPOSER_SELECTOR)) bindComposer(e.target);
    },
    { capture: true },
  );
  // Re-bind when the SPA swaps the composer in/out (and hide on destruction); ignore our
  // own pill's mutations.
  new MutationObserver((muts) => {
    if (muts.every((m) => m.target instanceof Element && m.target.closest(`#${PILL_ID}`))) return;
    if (!activeComposer || !activeComposer.isConnected) bindComposer();
  }).observe(document.body, { childList: true, subtree: true });
  // capture:true so we also catch scrolls on Gemini's inner scroll container (scroll
  // events don't bubble, but the capture phase reaches window).
  window.addEventListener("scroll", requestReposition, { passive: true, capture: true });
  window.addEventListener("resize", requestReposition, { passive: true });
  // Send-intent corroborators for the canary. Capture phase so a site that stops propagation
  // on its own composer can't hide the keypress from us; passive so we can never delay or
  // cancel a send. Cmd/Ctrl+Enter falls out for free — only Shift is excluded, because that
  // is the one modifier that means "newline" rather than "send" on all three sites.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.isComposing) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      // Enter in the composer itself.
      if (e.key === "Enter" && !e.shiftKey && activeComposer?.contains(target)) return noteIntent();
      // Enter/Space on a focused send button. A keyboard user who tabs to Send never types in
      // the composer at all, so without this the canary would systematically never fire for
      // them — a blind spot, not the random miss the design tolerates.
      if ((e.key === "Enter" || e.key === " ") && target instanceof Element) {
        const button = target.closest('button, [role="button"]');
        if (button && composerScope()?.contains(button)) noteIntent();
      }
    },
    { passive: true, capture: true },
  );
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!(e.target instanceof Element)) return;
      const button = e.target.closest('button, [role="button"]');
      if (button && composerScope()?.contains(button)) noteIntent();
    },
    { passive: true, capture: true },
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      (KEYS.enabled in changes ||
        KEYS.categories in changes ||
        KEYS.custom in changes ||
        KEYS.smokescreen in changes)
    ) {
      void loadSettings().then(render);
    }
  });
}

init();
