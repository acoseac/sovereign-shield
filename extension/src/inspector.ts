// The inspector panel: "show me exactly what you are about to send" and "show me what you are
// holding". Two tabs over one shell, opened from the pre-send pill.
//
// ---------------------------------------------------------------------------------------
// WHY THIS RENDERS IN THE MAIN WORLD
//
// It is the only surface that displays real values, and it renders in the world that already
// holds them. No real value crosses a world boundary, a postMessage or chrome.storage — the
// promise in storage.ts ("the value<->token map lives in page memory and is never persisted")
// is untouched. Only a bare "toggle" command crosses from the ISOLATED indicator.
//
// The Preview tab has a second reason to live here: accuracy. Computing it from a throwaway
// Session in the isolated world would number tokens from _1 and pick different stand-ins than
// the real conversation, so the panel would promise alice.morgan@example.org while the model
// received clara.hoffmann@example.net. See Session.preview.
// ---------------------------------------------------------------------------------------
//
// Interaction rules, all inherited from the pill's "cannot block a send" invariant:
//   - never auto-opens, and never takes focus;
//   - no capture-phase key handlers, and Escape closes WITHOUT preventDefault, so the site's
//     own shortcuts keep working;
//   - built with createElement + element.style (CSSOM), never innerHTML or a <style> tag —
//     Gemini enforces Trusted Types and a strict CSP, and CSSOM writes are exempt from both.
import { CATEGORY_LABEL } from "./categories.ts";
import { findComposer } from "./composer.ts";
import type { CustomMatcher } from "./custom.ts";
import { Z_PANEL } from "./layers.ts";
import { refreshPending } from "./pending.ts";
import type { ThemeId } from "./surrogate.ts";
import type { Preview, Session } from "./tokenize.ts";

const PANEL_ID = "ss-inspector";
const REFRESH_MS = 250;

/** Most mapping rows to render at once. MAX_MAPPINGS is 2 000, and eight elements per row makes
 *  that 16 000 nodes rebuilt whenever the set changes — for a list nobody is going to read past
 *  the top of. Newest first, and the count of what is hidden is stated rather than silently
 *  dropped; the guard still holds every mapping either way. */
const MAX_ROWS = 200;

// Captured at document_start, before any page script runs, so the panel is attached with the
// real attachShadow even if the page later patches Element.prototype to hand itself our root.
// We share a realm with the page — this closes the realistic window, not every window.
//
// typeof-guarded because this module is imported by the unit tests, which run in plain Node
// where there is no Element. Undefined only ever happens there; Chrome has had attachShadow
// since long before the manifest's 111 floor.
const nativeAttachShadow: typeof Element.prototype.attachShadow | undefined =
  typeof Element === "undefined" ? undefined : Element.prototype.attachShadow;

/** Settings the panel needs to predict what a send would do. Getters, not values: the bridge
 *  can change any of them between opening the panel and typing into it. */
export interface InspectorContext {
  allowedCategories: () => ReadonlySet<string> | undefined;
  customMatcher: () => CustomMatcher | undefined;
  smokescreen: () => boolean;
  theme: () => ThemeId;
}

const FG = "#e2e8f0";
const MUTED = "#94a3b8";
const BG = "#0f172a";
const LINE = "rgba(255,255,255,.12)";
const BRAND = "#0e7c66";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const SANS = "system-ui,-apple-system,'Segoe UI',sans-serif";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, css: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", css, label);
  // Never let a control in the panel pull focus out of the composer mid-sentence.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}

const CHIP =
  `background:transparent;color:${MUTED};border:1px solid ${LINE};border-radius:6px;` +
  `padding:3px 9px;font:500 11px ${SANS};cursor:pointer`;

export class Inspector {
  private panel: HTMLElement | null = null;
  /** The light-DOM element hosting the closed shadow root the panel lives in. Kept because a
   *  pointerdown inside a closed root is RETARGETED to the host by the time it reaches window,
   *  so "was that click inside the panel?" has to be asked of the host, not the panel. */
  private host: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private tab: "preview" | "mappings" = "preview";
  private tabButtons: HTMLButtonElement[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  /** What the body currently shows. Held in a FIELD, never a data-* attribute: it is built
   *  from real values, and there is no reason to write those anywhere the page can read them
   *  more conveniently than it already can. */
  private signature = "";
  /** Cache behind the innerText read in renderPreview — see there for why. */
  private lastTextContent = "";
  private lastInnerText = "";
  /** Prev/Next state for the preview's replaced spans. Rebuilt with the preview DOM; the
   *  signature skip in render() is what lets it survive idle ticks while the user reads.
   *  Index 0 = the "You typed" pane, 1 = "what the provider receives" — same mark count by
   *  construction (diffSegments emits one mark per span on both sides), but applyNav stays
   *  bounds-safe anyway because a zero-width segment is dropped defensively in diff(). */
  private nav: {
    counter: HTMLElement;
    boxes: [HTMLElement, HTMLElement];
    marks: [HTMLElement[], HTMLElement[]];
  } | null = null;
  private navIndex = 0;
  private readonly session: Session;
  private readonly ctx: InspectorContext;

  // Fields assigned explicitly rather than via constructor parameter properties: the tests run
  // on Node's strip-only TypeScript support, which rejects that syntax outright.
  constructor(session: Session, ctx: InspectorContext) {
    this.session = session;
    this.ctx = ctx;
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  toggle(): void {
    if (this.panel) this.close();
    else this.open();
  }

  open(): void {
    if (this.panel) return;
    this.build();
    // Cheap poll rather than a MutationObserver on the composer: the panel is open only while
    // the user is looking at it, a quarter-second is imperceptible for a diff, and it also
    // picks up mappings minted by a send without having to chain onMint.
    this.timer = setInterval(() => this.render(), REFRESH_MS);
    this.render();
  }

  close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    document.removeEventListener("keydown", this.onKeydown);
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    this.host?.remove(); // takes the shadow root, and the panel inside it, with it
    this.host = null;
    this.panel = null;
    this.body = null;
    this.tabButtons = [];
    this.signature = "";
    this.nav = null;
    this.navIndex = 0;
  }

  /** Re-render if open. Safe to call from anywhere; a no-op when closed. */
  refresh(): void {
    if (this.panel) this.render();
  }

  // --- shell ---------------------------------------------------------------

  private build(): void {
    const panel = el(
      "div",
      `position:fixed;top:0;right:0;height:100vh;width:min(460px,94vw);z-index:${Z_PANEL};` +
        `box-sizing:border-box;display:flex;flex-direction:column;background:${BG};color:${FG};` +
        `border-left:1px solid ${LINE};box-shadow:-8px 0 28px rgba(0,0,0,.35);font:13px/1.5 ${SANS}`,
    );
    panel.id = PANEL_ID;
    panel.setAttribute("role", "dialog");
    // NOT aria-modal: the page behind stays fully usable, including the composer. This panel
    // is a side view, never a modal that could stand between the user and their send button.
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "Sovereign Shield inspector");

    const header = el(
      "header",
      `display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid ${LINE}`,
    );
    header.append(el("strong", `font:600 13px ${SANS}`, "🛡️ Sovereign Shield"));

    const tabs = el("div", "display:flex;gap:6px;margin-left:auto");
    tabs.setAttribute("role", "tablist");
    this.tabButtons = [
      this.tabButton("Preview", "preview"),
      this.tabButton("Mappings", "mappings"),
    ];
    tabs.append(...this.tabButtons);
    header.append(tabs);
    header.append(
      button("✕", `${CHIP};padding:3px 7px`, () => this.close()),
    );

    this.body = el("div", "flex:1;overflow:auto;padding:14px");
    this.body.id = `${PANEL_ID}-panel`;
    this.body.setAttribute("role", "tabpanel");
    panel.append(header, this.body);

    // A CLOSED shadow root, not the light DOM. The Mappings tab renders every real value this
    // session holds, and in the light DOM a `document.querySelector("#ss-inspector")` would
    // scrape the lot. Closed means `host.shadowRoot` is null, so the page has no handle on the
    // subtree. Worth being precise about what this does and does not buy: every one of those
    // values came from the composer, which the site's own JS reads as the user types, and we
    // share a JS realm with the page — so this raises the bar against opportunistic scraping
    // rather than defeating a page that is actively hunting for us. It costs nothing, and the
    // isolation from the site's own CSS is a bonus.
    // display:contents so the host generates no box of its own — it must not add layout to the
    // page, and it must not become a stacking context, or the panel's z-index would be trapped
    // inside it and layers.ts's ordering would silently stop applying. (position on the host
    // would do exactly that.) The panel's own position:fixed still resolves to the viewport.
    this.host = el("div", "display:contents");
    this.host.id = `${PANEL_ID}-host`;
    if (nativeAttachShadow) {
      nativeAttachShadow.call(this.host, { mode: "closed" }).append(panel);
    } else {
      this.host.append(panel); // unreachable in Chrome; degrade to the light DOM, not to nothing
    }
    (document.body ?? document.documentElement).append(this.host);
    this.panel = panel;
    this.signature = "";
    this.syncTabs();

    // Escape closes, but does NOT preventDefault — the site's own Escape handling still runs.
    // Bubble phase, so anything the page cares about has already seen the key. Both listeners
    // are removed again in close(), so repeated opens don't stack them up.
    document.addEventListener("keydown", this.onKeydown);
    // Capture, so a site that stops propagation on its own surfaces can't strand the panel
    // open. Passive in spirit — it never calls preventDefault, so it cannot swallow a click.
    window.addEventListener("pointerdown", this.onPointerDown, true);
  }

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.panel) this.close();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.panel) return;
    const target = e.target;
    // Compared against the HOST: the shadow root is closed, so by the time a click inside the
    // panel reaches window it has been retargeted and `panel.contains(target)` is false —
    // which would close the panel on every click in it.
    if (target instanceof Node && (target === this.host || this.host?.contains(target))) return;
    // The pill's own toggle re-opens us; let it handle its own click rather than racing it.
    if (target instanceof Element && target.closest("#ss-indicator-pill")) return;
    this.close();
  };

  private tabButton(label: string, key: "preview" | "mappings"): HTMLButtonElement {
    const b = button(label, CHIP, () => {
      this.tab = key;
      this.syncTabs();
      this.render();
    });
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", `${PANEL_ID}-panel`);
    b.dataset.ssTab = key;
    return b;
  }

  private syncTabs(): void {
    for (const b of this.tabButtons) {
      const active = b.dataset.ssTab === this.tab;
      b.setAttribute("aria-selected", String(active));
      b.style.color = active ? FG : MUTED;
      b.style.borderColor = active ? BRAND : LINE;
      b.style.background = active ? "rgba(14,124,102,.18)" : "transparent";
    }
  }

  private render(): void {
    if (!this.body) return;
    // Settings can change under us; mirror what rewriteBodyForSend does before every send so
    // the preview is computed with exactly the configuration a send would use.
    this.session.customMatcher = this.ctx.customMatcher();
    this.session.smokescreen = this.ctx.smokescreen();
    this.session.theme = this.ctx.theme();
    const next = this.tab === "preview" ? this.renderPreview() : this.renderMappings();
    // Rebuilding wholesale on every tick would drop focus from a button mid-interaction and
    // could even swallow a click (the element vanishing between pointerdown and pointerup), so
    // only touch the DOM when the rendered content actually differs.
    if (this.signature === next.signature) return;
    this.signature = next.signature;
    this.body.replaceChildren(next.node);
    // Scroll-to-mark needs layout, so it runs after the new nodes are attached — never
    // inside renderPreview, where offsetTop would still read 0 on detached elements.
    if (this.tab === "preview") this.applyNav();
    else this.nav = null;
  }

  // --- prev/next over the replaced spans ------------------------------------
  // On a long pasted prompt the two 34vh scrollboxes bury the marks; this is the "where
  // ARE the needles" control. One index drives BOTH panes in lockstep, so what you typed
  // and what replaces it are always on screen together.

  private stepNav(delta: number): void {
    this.navIndex += delta;
    this.applyNav();
  }

  private applyNav(): void {
    const nav = this.nav;
    if (!nav) return;
    const count = Math.max(nav.marks[0].length, nav.marks[1].length);
    if (count === 0) return;
    this.navIndex = ((this.navIndex % count) + count) % count; // wrap both directions
    nav.counter.textContent = `${this.navIndex + 1} / ${count}`;
    for (const side of [0, 1] as const) {
      nav.marks[side].forEach((mark, i) => {
        const active = i === this.navIndex;
        mark.style.outline = active ? `2px solid ${BRAND}` : "";
        mark.style.outlineOffset = active ? "1px" : "";
        mark.style.background = active ? "rgba(14,124,102,.55)" : "rgba(14,124,102,.32)";
      });
      const mark = nav.marks[side][this.navIndex];
      const box = nav.boxes[side];
      if (!mark) continue;
      // Manual scroll math, NOT scrollIntoView: that walks ancestor scrollers and would
      // yank the page behind this fixed panel. offsetTop is box-relative because diff()
      // makes the box position:relative.
      box.scrollTop = Math.max(0, mark.offsetTop + mark.offsetHeight / 2 - box.clientHeight / 2);
    }
  }

  // --- tab 1: what the provider would receive ------------------------------

  private renderPreview(): { node: HTMLElement; signature: string } {
    const composer = findComposer();
    // innerText, not textContent, because it reflects the visual line breaks — which is what
    // summarize and the guard see. But innerText forces a synchronous layout, and this runs on
    // a timer, so it would thrash layout four times a second even with the user completely
    // idle. textContent is free and changes whenever the text does, so it gates the expensive
    // read: no edit, no reflow.
    const textContent = composer?.textContent ?? "";
    if (textContent !== this.lastTextContent) {
      this.lastTextContent = textContent;
      this.lastInnerText = composer?.innerText ?? "";
    }
    const original = this.lastInnerText;
    const smoke = this.ctx.smokescreen();
    // Theme is in the signature so switching it in options re-renders an open panel with
    // otherwise-unchanged text — the preview must show the stand-ins a send would NOW mint.
    const key = `p:${smoke}:${this.ctx.theme()}:${original}`;
    // Detection over a long prompt four times a second is real work for no gain when the user
    // is reading rather than typing. The caller compares this signature and skips the rebuild;
    // returning the current node keeps that comparison cheap.
    if (key === this.signature) return { node: this.body ?? el("div", ""), signature: key };
    const wrap = el("div", "");
    if (!original.trim()) {
      wrap.append(
        note("Type a prompt and it will appear here, side by side with what the provider receives."),
      );
      return { node: wrap, signature: key };
    }
    const preview = this.session.preview(original, this.ctx.allowedCategories());
    const originalBox = diff(original, preview, "original");
    const redactedBox = diff(original, preview, "redacted");

    // Fresh preview DOM ⇒ fresh nav state. render() calls applyNav() after attaching, so
    // the first mark is centred in both panes the moment the panel (re)builds.
    this.navIndex = 0;
    this.nav = null;
    if (preview.spans.length > 0) {
      const counter = el("span", `font:600 12px ${SANS};color:${FG}`, "");
      const navRow = el("div", "display:flex;align-items:center;gap:8px;margin:0 0 10px");
      navRow.append(
        counter,
        button("‹ Prev", CHIP, () => this.stepNav(-1)),
        button("Next ›", CHIP, () => this.stepNav(1)),
        el("span", `font:11px ${SANS};color:${MUTED}`, "replacements — both panes scroll together"),
      );
      this.nav = {
        counter,
        boxes: [originalBox, redactedBox],
        marks: [
          Array.from(originalBox.querySelectorAll("mark")),
          Array.from(redactedBox.querySelectorAll("mark")),
        ],
      };
      wrap.append(navRow);
    }

    wrap.append(
      section("You typed", originalBox),
      section(
        preview.spans.length ? "What the provider receives" : "What the provider receives — unchanged",
        redactedBox,
      ),
    );
    wrap.append(
      note(
        preview.spans.length === 0
          ? "Nothing in this prompt matches a detector, so it is sent exactly as you typed it."
          : `${preview.spans.length} span${preview.spans.length === 1 ? "" : "s"} replaced. ` +
              "This previews your composer text; the request may also carry earlier turns of " +
              "this conversation and the site's own scaffolding.",
      ),
    );
    return { node: wrap, signature: key };
  }

  // --- tab 2: what we are holding ------------------------------------------

  private renderMappings(): { node: HTMLElement; signature: string } {
    const all = this.session.entries();
    // Newest first: entries() is in mint order, and the row a user came here to find is almost
    // always the one they just sent.
    const entries = all.slice(-MAX_ROWS).reverse();
    const hidden = all.length - entries.length;
    // Every signature carries its tab's prefix, so switching tabs can never look "unchanged"
    // to render() and skip the rebuild. Built over the SHOWN rows only, so it stays bounded —
    // stringifying 2 000 mappings four times a second is the cost this check exists to avoid.
    const key = `m:${hidden}:${entries.map((e) => `${e.placeholder}=${e.value}`).join(" ")}`;
    // Computed BEFORE building anything: rebuilding rows every refresh tick only for render()
    // to throw them away is a lot of allocation for a panel the user is sitting and reading.
    if (key === this.signature) return { node: this.body ?? el("div", ""), signature: key };
    const wrap = el("div", "");
    if (all.length === 0) {
      wrap.append(note("Nothing kept local in this tab yet."));
      return { node: wrap, signature: key };
    }

    for (const entry of entries) {
      const row = el(
        "div",
        `border:1px solid ${LINE};border-radius:8px;padding:10px;margin:0 0 8px`,
      );
      const top = el("div", "display:flex;align-items:baseline;gap:8px;flex-wrap:wrap");
      top.append(
        el(
          "code",
          `font:12px ${MONO};background:rgba(14,124,102,.18);border:1px solid ${LINE};` +
            "border-radius:5px;padding:1px 6px;word-break:break-all",
          entry.placeholder,
        ),
        el("span", `color:${MUTED}`, "↔"),
        el("code", `font:12px ${MONO};word-break:break-all`, entry.value),
      );
      const meta = el(
        "div",
        `color:${MUTED};font-size:11px;margin:6px 0 8px`,
        CATEGORY_LABEL[entry.category] ?? entry.category,
      );
      const actions = el("div", "display:flex;gap:6px;flex-wrap:wrap");
      if (entry.surrogate) {
        actions.append(
          button("Next stand-in", CHIP, () => {
            this.session.recycleSurrogate(entry.value);
            this.refresh();
          }),
        );
      }
      actions.append(
        button("Stop redacting", CHIP, () => {
          this.session.allow(entry.value);
          this.refresh();
          // The pill counts from a summary published by pending.ts. Republish now rather than
          // at the next keystroke, or the panel and the pill would disagree about the value the
          // user just excused — which is the whole defect this closes.
          refreshPending();
        }),
      );
      row.append(top, meta, actions);
      wrap.append(row);
    }

    if (hidden > 0) {
      wrap.append(
        note(`Showing the ${entries.length} most recent. ${hidden} older mapping${hidden === 1 ? " is" : "s are"} still held and still restored — just not listed here.`),
      );
    }
    wrap.append(
      button(`Clear all ${all.length} mappings`, `${CHIP};margin-top:4px`, () => {
        this.session.clear();
        this.refresh();
      }),
      note(
        "Stopping redaction applies to this tab only — it is never written to disk, so a " +
          "reload redacts the value again. Either way, messages already sent keep their " +
          "placeholder and will stop being restored on screen.",
      ),
      note("These are real values. Close the panel before sharing your screen."),
    );
    return { node: wrap, signature: key };
  }
}

// --- small presentational helpers ------------------------------------------

function section(title: string, content: HTMLElement): HTMLElement {
  const box = el("section", "margin:0 0 14px");
  box.append(
    el(
      "h2",
      `font:600 11px ${SANS};letter-spacing:.06em;text-transform:uppercase;color:${MUTED};margin:0 0 6px`,
      title,
    ),
    content,
  );
  return box;
}

function note(text: string): HTMLElement {
  return el("p", `color:${MUTED};font-size:11px;line-height:1.5;margin:10px 0 0`, text);
}

/** A run of text on one side of the diff. `mark` is true for the redacted spans. */
export interface DiffSegment {
  text: string;
  mark: boolean;
}

/**
 * Split one side of the diff into marked and unmarked runs.
 *
 * Both sides share the untouched chunks between spans — which is exactly how preview() builds
 * its output — so a single ascending walk over the ORIGINAL offsets renders either side, with
 * no second set of offsets to keep in step. Pure, so the offset arithmetic is unit-tested:
 * getting it wrong would show the user a diff that does not describe their prompt.
 */
export function diffSegments(
  original: string,
  preview: Preview,
  side: "original" | "redacted",
): DiffSegment[] {
  const out: DiffSegment[] = [];
  let cursor = 0;
  for (const span of preview.spans) {
    if (span.start > cursor) out.push({ text: original.slice(cursor, span.start), mark: false });
    out.push({
      text: side === "original" ? original.slice(span.start, span.end) : span.placeholder,
      mark: true,
    });
    cursor = span.end;
  }
  if (cursor < original.length) out.push({ text: original.slice(cursor), mark: false });
  return out;
}

/** Render one side of the diff. */
function diff(original: string, preview: Preview, side: "original" | "redacted"): HTMLElement {
  const box = el(
    "div",
    // position:relative so the marks' offsetTop is box-relative — the prev/next scroll
    // math depends on it (see Inspector.applyNav).
    `position:relative;font:12px/1.6 ${MONO};white-space:pre-wrap;word-break:break-word;` +
      `background:rgba(255,255,255,.04);border:1px solid ${LINE};border-radius:8px;` +
      `padding:10px;max-height:34vh;overflow:auto`,
  );
  const mark = (text: string): HTMLElement =>
    el(
      "mark",
      `background:rgba(14,124,102,.32);color:${FG};border-radius:4px;padding:0 3px;` +
        "box-decoration-break:clone;-webkit-box-decoration-break:clone",
      text,
    );
  for (const segment of diffSegments(original, preview, side)) {
    // Defensive: a zero-width span would render as a bare <mark> that is nothing but padding.
    // Neither detector can produce one today (custom.ts drops zero-width matches), so this
    // guards a future rule rather than a current bug.
    if (!segment.text) continue;
    box.append(segment.mark ? mark(segment.text) : segment.text);
  }
  return box;
}

/**
 * Wire the panel up to the toggle command the ISOLATED indicator posts. The command carries no
 * data, so a page script forging it can only make the panel appear — showing the user their own
 * composer text, which the page already has.
 */
export function installInspector(session: Session, ctx: InspectorContext): Inspector {
  const inspector = new Inspector(session, ctx);
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const data = ev.data as { source?: string; kind?: string } | null;
    if (data?.source === "ss-ui" && data.kind === "toggle-inspector") inspector.toggle();
  });
  return inspector;
}
