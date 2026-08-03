// Options page: master on/off, per-category block toggles, and the activity log
// (type + time + site only). Live-updates on storage changes.
import { CATEGORIES, type Category, CATEGORY_LABEL } from "./categories";
import { KEYS, LOG_CAP, getSettings, readLog } from "./storage";
import { lintRegex, MAX_LABEL, MAX_PATTERN, MAX_RULES, type CustomRule } from "./custom";
import {
  RULE_TEMPLATES,
  instantiateTemplate,
  templateAlreadyAdded,
  type RuleTemplate,
} from "./templates";
import { notifyWorker } from "./runtime";
import {
  STATS_KEY,
  STATS_SEEN_KEY,
  lastMilestone,
  lastNDays,
  nextMilestone,
  readStats,
} from "./stats";

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const enabledEl = byId("enabled") as HTMLInputElement;
const smokescreenEl = byId("smokescreen") as HTMLInputElement;

// "custom" has no checkbox here — it is driven by whether rules exist (below), and is kept
// enabled in the category set so its redaction events aren't dropped by the bridge/background.
const ID_CATS = CATEGORIES.filter((c) => c.group !== "secrets" && c.key !== "custom");
const SECRET_CATS = CATEGORIES.filter((c) => c.group === "secrets");

function buildGrid(box: HTMLElement, cats: Category[], checked: Set<string>): void {
  for (const c of cats) {
    const label = document.createElement("label");
    label.className = "cat";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = `cat-${c.key}`;
    cb.checked = checked.has(c.key);
    cb.addEventListener("change", saveCategories);
    label.append(cb, document.createTextNode(c.label));
    box.append(label);
  }
}

async function renderSettings(): Promise<void> {
  const s = await getSettings();
  enabledEl.checked = s.enabled;
  smokescreenEl.checked = s.smokescreen;
  const checked = new Set(s.categories);
  const idBox = byId("categories");
  if (idBox.childElementCount === 0) {
    // First render: build the two checkbox grids once.
    buildGrid(idBox, ID_CATS, checked);
    buildGrid(byId("secrets"), SECRET_CATS, checked);
    return;
  }
  // Live update (a storage change echoes back here): only sync the checked state, so
  // toggling a box mid-keyboard-navigation doesn't blow away the list and lose focus.
  for (const c of [...ID_CATS, ...SECRET_CATS]) {
    const cb = document.getElementById(`cat-${c.key}`) as HTMLInputElement | null;
    if (cb) cb.checked = checked.has(c.key);
  }
}

async function saveCategories(): Promise<void> {
  const enabled = [...ID_CATS, ...SECRET_CATS]
    .filter((c) => (document.getElementById(`cat-${c.key}`) as HTMLInputElement | null)?.checked)
    .map((c) => c.key);
  enabled.push("custom"); // no checkbox — gated by rule existence, kept in the allowed set
  await chrome.storage.local.set({ [KEYS.categories]: enabled });
}

// --- custom rules editor --------------------------------------------------
// The editor drives a local `draft`; edits mutate it in place (so focus survives) and
// persist only the valid rules. An invalid/unsafe regex is shown inline and NEVER written to
// storage, so it can't reach the guard's send path. Loaded once; not re-rendered on storage
// echoes (this options page is the only editor of custom rules).
let draft: CustomRule[] = [];

function ruleError(r: CustomRule): string | null {
  const pattern = r.pattern.trim();
  if (!pattern) return null; // empty draft row — not an error, just not saved
  if (pattern.length > MAX_PATTERN) return `Too long (max ${MAX_PATTERN} chars).`;
  return r.isRegex ? lintRegex(pattern) : null;
}

async function persistRules(): Promise<void> {
  const valid = draft.filter((r) => r.pattern.trim() && !ruleError(r));
  await chrome.storage.local.set({ [KEYS.custom]: valid });
}

function optCheckbox(text: string, checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const label = document.createElement("label");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  label.append(cb, document.createTextNode(` ${text}`));
  return label;
}

function ruleRow(rule: CustomRule, index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "rule";
  const pat = document.createElement("input");
  pat.type = "text";
  pat.value = rule.pattern;
  pat.maxLength = MAX_PATTERN;
  pat.setAttribute("aria-label", "Pattern");
  const rm = document.createElement("button");
  rm.className = "btn rm";
  rm.textContent = "Remove";
  const opts = document.createElement("div");
  opts.className = "opts";
  const label = document.createElement("input");
  label.type = "text";
  label.value = rule.label ?? "";
  label.placeholder = "label (optional)";
  label.maxLength = MAX_LABEL;
  label.setAttribute("aria-label", "Label");
  const err = document.createElement("div");
  err.className = "err";

  function refresh(): void {
    pat.placeholder = rule.isRegex ? "regular expression" : "text to redact (e.g. Project-Apollo)";
    (ww.firstElementChild as HTMLInputElement).disabled = rule.isRegex; // whole-word: literal only
    err.textContent = ruleError(rule) ?? "";
  }
  function sync(): void {
    rule.pattern = pat.value;
    rule.label = label.value.trim() || undefined;
    refresh();
    void persistRules();
  }
  const rx = optCheckbox("Regex", rule.isRegex, (v) => {
    rule.isRegex = v;
    sync();
  });
  const cs = optCheckbox("Case-sensitive", rule.caseSensitive === true, (v) => {
    rule.caseSensitive = v;
    sync();
  });
  const ww = optCheckbox("Whole word", rule.wholeWord !== false, (v) => {
    rule.wholeWord = v;
    sync();
  });
  pat.addEventListener("input", sync);
  label.addEventListener("input", sync);
  rm.addEventListener("click", () => {
    draft.splice(index, 1);
    renderRules();
    void persistRules();
  });

  opts.append(rx, cs, ww, label);
  row.append(pat, rm, opts, err);
  refresh();
  return row;
}

function renderRules(): void {
  const box = byId("rules");
  box.replaceChildren();
  if (draft.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.style.margin = "8px 0 0";
    p.textContent = "No custom rules yet.";
    box.append(p);
  } else {
    draft.forEach((rule, i) => box.append(ruleRow(rule, i)));
  }
  // Keep the library's "Added" labels honest while it is open — removing a rule here has to make
  // its template offerable again. This MUST run on the empty branch too: deleting the last rule
  // is precisely the case that leaves a stale "Added" next to "No custom rules yet.", and an
  // early return above is what caused exactly that. Safe from recursion: renderTemplates never
  // calls back into here.
  const templates = byId("templates");
  if (!templates.hidden) renderTemplates();
}

async function loadRules(): Promise<void> {
  draft = (await getSettings()).custom.map((r) => ({ ...r }));
  renderRules();
}

byId("add-rule").addEventListener("click", () => {
  if (draft.length >= MAX_RULES) return;
  draft.push({ pattern: "", isRegex: false, wholeWord: true });
  renderRules();
  byId("rules").querySelector<HTMLInputElement>(".rule:last-child input[type=text]")?.focus();
});

// --- ready-made rules -----------------------------------------------------
// The blocklist was regex-or-nothing for anything beyond a literal word, which made the most
// powerful setting here the least reachable one. A template lands as an ordinary CustomRule in
// the same draft — editable, deletable, and indistinguishable once added — so nothing new has to
// be stored, matched or migrated. See templates.ts for what may go in the library.

function templateRow(template: RuleTemplate): HTMLElement {
  const row = document.createElement("div");
  row.className = "tpl";

  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = template.name;
  const desc = document.createElement("div");
  desc.className = "desc";
  desc.textContent = template.description;
  meta.append(name, desc);

  const added = templateAlreadyAdded(template, draft);
  const action = document.createElement(added ? "span" : "button");
  if (added) {
    action.className = "added";
    action.textContent = "Added";
  } else {
    action.className = "btn";
    (action as HTMLButtonElement).type = "button";
    action.textContent = "Add";
    action.addEventListener("click", () => {
      if (draft.length >= MAX_RULES) return;
      draft.push(instantiateTemplate(template));
      renderRules(); // re-renders the library too, so this row becomes "Added"
      void persistRules();
    });
  }

  row.append(meta, action);
  return row;
}

function renderTemplates(): void {
  const box = byId("templates");
  box.replaceChildren();
  RULE_TEMPLATES.forEach((t) => box.append(templateRow(t)));
}

byId("add-template").addEventListener("click", () => {
  const box = byId("templates");
  const open = !box.hidden;
  if (open) {
    box.hidden = true;
    return;
  }
  // Rendered on open, not once at load: "Added" has to reflect rules the user may have deleted
  // or hand-typed since the page was opened.
  renderTemplates();
  box.hidden = false;
});

enabledEl.addEventListener("change", () => {
  chrome.storage.local.set({ [KEYS.enabled]: enabledEl.checked }).catch(() => undefined);
});

smokescreenEl.addEventListener("change", () => {
  chrome.storage.local.set({ [KEYS.smokescreen]: smokescreenEl.checked }).catch(() => undefined);
});

function fmtTime(t: number): string {
  return new Date(t).toLocaleString();
}

async function renderLog(): Promise<void> {
  const log = await readLog();
  const summary = byId("summary");
  const list = byId("log");

  summary.replaceChildren();
  if (log.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nothing kept local yet.";
    summary.append(p);
    list.replaceChildren();
    return;
  }

  const total = document.createElement("p");
  total.style.margin = "0 0 6px";
  const count = document.createElement("b");
  count.textContent = String(log.length);
  total.append(
    count,
    document.createTextNode(
      ` identifier${log.length === 1 ? "" : "s"} kept local${
        log.length >= LOG_CAP ? ` (last ${LOG_CAP})` : ""
      }.`,
    ),
  );
  summary.append(total);

  const counts = new Map<string, number>();
  for (const e of log) counts.set(e.c, (counts.get(e.c) ?? 0) + 1);
  const chips = document.createElement("div");
  chips.className = "chips";
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${CATEGORY_LABEL[k] ?? k}: ${n}`;
    chips.append(chip);
  }
  summary.append(chips);

  list.replaceChildren();
  for (const e of [...log].reverse()) {
    const row = document.createElement("div");
    row.className = "logrow";
    const type = document.createElement("span");
    type.className = "type";
    type.textContent = CATEGORY_LABEL[e.c] ?? e.c;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${e.h} · ${fmtTime(e.t)}`;
    row.append(type, meta);
    list.append(row);
  }
}

// --- stats ("Protected so far") ---------------------------------------------
// Read-only view over the background-owned aggregate. The one thing this page writes is
// STATS_SEEN_KEY (the milestone-dismiss cursor) — its own key with its own single writer,
// so it can never contend with the background's read-modify-write on STATS_KEY.

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Milestone line: a quiet, dismissible callout while a freshly crossed boundary is unseen;
 *  otherwise the static "next" line. Dismissing advances the cursor, never the stats. */
function renderMilestone(total: number, seen: number): void {
  const milestone = byId("milestone");
  const passed = lastMilestone(total);
  const next = nextMilestone(total);
  if (passed !== null && passed > seen) {
    byId("milestone-text").textContent =
      `🎉 Passed ${passed.toLocaleString()} identifiers kept off cloud servers.`;
    milestone.hidden = false;
  } else {
    milestone.hidden = true;
  }
  byId("stat-next").textContent = next !== null ? `Next milestone: ${next.toLocaleString()}.` : "";
}

/** 7-day chart: plain flex divs, tallest day = full height. Zero weeks show the empty line
 *  instead of seven bare tracks pretending to be data. The chart itself is aria-hidden
 *  (decoration over the counts); #stat-week is the screen-reader equivalent. */
function renderStatChart(series: ReadonlyArray<{ key: string; count: number }>): void {
  const chart = byId("stat-chart");
  const weekTotal = series.reduce((sum, d) => sum + d.count, 0);
  chart.replaceChildren();
  chart.hidden = weekTotal === 0;
  byId("stat-chart-empty").hidden = weekTotal > 0;
  const spoken: string[] = [];
  if (weekTotal === 0) {
    byId("stat-week").textContent = "";
    return;
  }
  const max = Math.max(...series.map((d) => d.count));
  // Pixels, not a percentage: the bar's flex column has no definite height (it stretches),
  // and 84px chart − label − gap leaves ~58px of drawable track. A percentage of the
  // stretched column made the tallest bar overlap the copy above (review catch).
  const BAR_MAX_PX = 58;
  for (const d of series) {
    // Split rather than Date.parse — same explicit local-date construction as lastNDays.
    const [y, m, day] = d.key.split("-").map(Number);
    const weekday = WEEKDAY[new Date(y, m - 1, day).getDay()];
    const col = document.createElement("div");
    col.className = "stat-day";
    col.title = `${d.key}: ${d.count}`;
    const bar = document.createElement("div");
    bar.className = d.count > 0 ? "stat-bar filled" : "stat-bar";
    bar.style.height = `${Math.max(3, Math.round((d.count / max) * BAR_MAX_PX))}px`;
    const label = document.createElement("div");
    label.className = "stat-daylabel";
    label.textContent = weekday;
    col.append(bar, label);
    chart.append(col);
    spoken.push(`${weekday} ${d.count}`);
  }
  byId("stat-week").textContent = `Last 7 days: ${spoken.join(", ")}.`;
}

/** Per-category chips (top 6 + "+N more") and per-site rows. */
function renderStatBreakdown(cats: Record<string, number>, sites: Record<string, number>): void {
  const chips = byId("stat-cats");
  chips.replaceChildren();
  const byCount = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  for (const [key, n] of byCount.slice(0, 6)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${CATEGORY_LABEL[key] ?? key}: ${n.toLocaleString()}`;
    chips.append(chip);
  }
  if (byCount.length > 6) {
    const more = document.createElement("span");
    more.className = "chip";
    more.textContent = `+${byCount.length - 6} more`;
    chips.append(more);
  }

  const box = byId("stat-sites");
  box.replaceChildren();
  for (const [host, n] of Object.entries(sites).sort((a, b) => b[1] - a[1])) {
    const row = document.createElement("div");
    row.className = "stat-siterow";
    const name = document.createElement("span");
    name.textContent = host;
    const count = document.createElement("span");
    count.className = "n";
    count.textContent = n.toLocaleString();
    row.append(name, count);
    box.append(row);
  }
}

async function renderStats(): Promise<void> {
  const stats = await readStats();
  const seenRaw = (await chrome.storage.local.get(STATS_SEEN_KEY))[STATS_SEEN_KEY];
  const seen = typeof seenRaw === "number" ? seenRaw : 0;
  const total = stats?.total ?? 0;

  byId("stat-total").textContent = total.toLocaleString();
  byId("stat-sub").textContent =
    stats && total > 0
      ? `identifiers kept off cloud servers since ${new Date(stats.since).toLocaleDateString()}`
      : "identifiers kept off cloud servers";

  renderMilestone(total, seen);
  renderStatChart(stats ? lastNDays(stats, 7) : []);
  renderStatBreakdown(stats?.cats ?? {}, stats?.sites ?? {});
}

// Two-step confirm: this wipes a lifetime number, so a single misclick must not do it.
// Inline state rather than window.confirm — same quiet register as the rest of the page.
const statsResetBtn = byId("stats-reset") as HTMLButtonElement;
let resetArmed = false;
let resetTimer: ReturnType<typeof setTimeout> | undefined;
function disarmReset(): void {
  resetArmed = false;
  statsResetBtn.textContent = "Reset stats";
}
statsResetBtn.addEventListener("click", () => {
  if (!resetArmed) {
    resetArmed = true;
    statsResetBtn.textContent = "Click again to confirm";
    resetTimer = setTimeout(disarmReset, 3000);
    return;
  }
  clearTimeout(resetTimer);
  disarmReset();
  // Routed through the background (the single stats writer) so a reset can't race a
  // buffered flush — same reasoning as "Clear log" below.
  notifyWorker({ type: "ss-stats-reset" });
});

byId("milestone-dismiss").addEventListener("click", () => {
  void (async () => {
    const stats = await readStats();
    const passed = lastMilestone(stats?.total ?? 0);
    if (passed !== null) await chrome.storage.local.set({ [STATS_SEEN_KEY]: passed });
  })();
});

byId("clear").addEventListener("click", () => {
  // Route through the background (the single log writer) so a clear can't race a
  // buffered batch flush; the storage.onChanged listener re-renders on success.
  // notifyWorker guards the invalidated-context throw — narrow here (this is the extension's
  // own page), but the failure mode is identical if a click races an extension update.
  notifyWorker({ type: "ss-clear" });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (KEYS.log in changes) void renderLog();
  if (STATS_KEY in changes || STATS_SEEN_KEY in changes) void renderStats();
  if (KEYS.enabled in changes || KEYS.categories in changes || KEYS.smokescreen in changes) {
    void renderSettings();
  }
});

void renderSettings();
void renderLog();
void renderStats();
void loadRules();
