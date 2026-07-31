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
import { decodePending, PENDING_ATTR } from "./pending.ts";
import { notifyWorker } from "./runtime.ts";
import { summarize, type Summary } from "./summarize.ts";
import { compileRules, type CustomMatcher } from "./custom.ts";
import { dismissBanner, showBanner, type BannerAction } from "./banner.ts";
import { buildReportLinks } from "./report.ts";
import { CANARY_POLL_MS, createCanaryWatch, isSendIntent, readSeen, sendBaseline } from "./canary.ts";
import { COMPOSER_SELECTOR, findComposer } from "./composer.ts";
import { Z_PILL } from "./layers.ts";

const PILL_ID = "ss-indicator-pill";
/** Shared by the warning and its retraction, so the two can never drift apart. */
const MISSED_SEND_BANNER = "ss-missed-send";
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
// data-ss-seen as it stood at that intent — the ONLY reading that is reliably from before the
// request could have been dispatched. See sendBaseline() for the false alarm this prevents.
let seenAtIntent = 0;
let canaryPoll: ReturnType<typeof setInterval> | undefined; // active post-drain inspect watch

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
// What the guard will actually keep local for the current composer text.
//
// Prefer the MAIN world's published summary. It is the authoritative one: only that world can
// see the values the user excused via the inspector's "stop redacting this", and sending those
// across would be real PII on a postMessage — the thing ADR 0005 rules out. Counting here
// instead is what used to make the pill and the panel disagree.
//
// Falls back to computing locally when the attribute is missing or malformed: the MAIN script
// not yet installed, or a page script having scribbled on it. That is the pre-0.7.0 behaviour,
// so a fallback costs at most the excused-value discrepancy rather than an empty pill.
function currentSummary(text: string): Summary {
  return (
    decodePending(document.documentElement.dataset[PENDING_ATTR]) ??
    summarize(text, allowed, customMatcher)
  );
}

function render(): void {
  if (!enabled || !activeComposer?.isConnected) return hidePill();
  const summary = currentSummary(activeComposer.innerText);
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
  // Sample HERE, not at the drain. The keypress is the last moment guaranteed to precede the
  // generate request; by the time the composer empties the guard may already have inspected it.
  seenAtIntent = readSeen(document.documentElement.dataset.ssSeen);
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

/** Stop any in-flight canary poll and forget its id. Nulling the id matters: a stale, already-
 *  cleared timer id could otherwise be handed to a later clearInterval and, if the runtime had
 *  recycled that numeric id, cancel an unrelated timer. */
function stopCanary(): void {
  clearInterval(canaryPoll);
  canaryPoll = undefined;
}

function armCanary(): void {
  const drainedAt = Date.now();
  if (!isSendIntent(lastIntentAt, drainedAt)) return; // a manual clear, not a send
  // The bar this send has to clear. Taken from the INTENT sample, because the inspect can land
  // before the drain as easily as after it — reading the counter here instead is what made the
  // guard warn about sends it had already redacted. See sendBaseline().
  const baseline = sendBaseline(seenAtIntent, readSeen(document.documentElement.dataset.ssSeen));
  // POLL, don't check once. The guard may inspect a send seconds after the composer drains —
  // Gemini's Thinking model issues its StreamGenerate request only after preparatory RPCs — and a
  // single fixed-deadline check false-fired on a send that WAS redacted, just later. Everything
  // the poll then decides — when to warn, when to take the warning back, when a newer send has
  // made the counter unreadable — lives in createCanaryWatch, where it is unit-tested. Three
  // interacting flags with order-dependent updates is precisely what should not sit untested
  // inside a timer callback, and four separate defects here proved it.
  const tick = createCanaryWatch(
    { baseline, drainedAt, intentAtArm: lastIntentAt },
    { warn: warnMissedSend, retract: () => void dismissBanner(MISSED_SEND_BANNER) },
  );
  stopCanary(); // a fresh send supersedes any pending poll
  canaryPoll = setInterval(() => {
    const result = tick({
      now: Date.now(),
      seenNow: readSeen(document.documentElement.dataset.ssSeen),
      lastIntentAt,
    });
    if (result === "done") stopCanary();
  }, CANARY_POLL_MS);
}

/**
 * Raise the warning. Returns whether THIS call is what put the bar on screen — false means an
 * earlier missed send had already raised it, and that send's warning is not ours to retract.
 */
function warnMissedSend(): boolean {
  // Offer a way to tell us. There is no telemetry — by design — so this banner is the only
  // place a moved transport can become a maintainer signal, and until now that signal stopped
  // at the user. Both links are user-initiated and carry metadata only: site, version, build.
  // Never a byte of the prompt. See report.ts.
  //
  // Two paths because most users are not developers: the GitHub link assumes an account and a
  // willingness to sign in at the moment something broke, which would filter out most of the
  // reports worth having.
  let actions: BannerAction[] | undefined;
  try {
    const links = buildReportLinks({
      host: location.hostname,
      version: chrome.runtime.getManifest().version,
      build: document.documentElement.dataset.ssBuild,
    });
    actions = [
      { label: "Report this", href: links.issue },
      { label: "or email", href: links.email, subtle: true },
    ];
  } catch {
    // A dead extension context (see bridge.ts) makes getManifest() throw. The warning itself is
    // the load-bearing half — show it regardless, just without the links.
  }

  // One bar per page: a site whose endpoint has moved will trip this on every message.
  // The cause clause names attachments deliberately. An uninspected send is most often a file
  // attachment — those ride a transport the guard doesn't hook and are out of scope anyway (it
  // guards typed prompts, not uploads). Detecting an attachment programmatically would mean
  // per-site chip selectors, exactly the rot-prone thing the canary avoids, so we name the
  // likely benign cause instead of asserting "the API changed" — which was often just wrong —
  // and leave "Report this" for the case the user rules out.
  const raised = showBanner({
    id: MISSED_SEND_BANNER,
    tone: "warning",
    text:
      "🛡️ Sovereign Shield didn't inspect that message — it was sent as you typed it. " +
      "Attachments aren't guarded; if you didn't attach one, the site may have changed how it sends.",
    actions,
  });
  // notifyWorker, not a bare sendMessage().catch(): a missed send very often coincides with an
  // invalidated context (the extension was just updated), where sendMessage throws SYNCHRONOUSLY
  // and .catch() can't see it. See runtime.ts.
  //
  // Fired per missed SEND, not per bar raised: the bar dedups to one per page, but the badge and
  // activity log want to know that a second message also went out uninspected.
  notifyWorker({ type: "ss-missed" });
  return raised;
}

// --- composer binding (no leaked listeners) -------------------------------
// Default via findComposer(), not a bare querySelector: it prefers the FOCUSED composer, which
// is the same rule the MAIN world uses to decide which box to summarise (pending.ts) and
// preview (inspector.ts). With two composers on the page — editing an earlier message spawns a
// second one on ChatGPT and Claude — picking differently would park the pill beside one box
// showing the other's count. The focusin handler below already converged them in practice;
// this closes the initial-bind case.
function bindComposer(found: HTMLElement | null = findComposer()): void {
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
  // If the guard was just switched off, drop any in-flight canary watch — a "this send wasn't
  // inspected" banner arriving seconds after the user disabled the guard would be pure noise.
  if (!enabled) stopCanary();
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
      // .closest, not .matches: focus can land on a child of the composer (see composer.ts).
      const composer = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(COMPOSER_SELECTOR) : null;
      if (composer) bindComposer(composer);
    },
    { capture: true },
  );
  // Re-bind when the SPA swaps the composer in/out (and hide on destruction); ignore our
  // own pill's mutations.
  new MutationObserver((muts) => {
    if (muts.every((m) => m.target instanceof Element && m.target.closest(`#${PILL_ID}`))) return;
    if (!activeComposer || !activeComposer.isConnected) bindComposer();
  }).observe(document.body, { childList: true, subtree: true });
  // Re-render when the MAIN world republishes its summary. Without this, excusing a value in
  // the inspector would not reach the pill until the next keystroke — and "stop redacting this"
  // is exactly the moment the two must visibly agree.
  //
  // render() directly, not scheduleRender(): pending.ts has already debounced (and only writes
  // when the summary actually changed), so a second 200ms wait here would stack onto that one
  // and add nothing — there is nothing left to coalesce. render() is idempotent and skips the
  // DOM write when the text is unchanged.
  new MutationObserver(render).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-ss-pending"],
  });
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
