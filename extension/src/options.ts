// Options page: master on/off, per-category block toggles, and the activity log
// (type + time + site only). Live-updates on storage changes.
import { CATEGORIES, type Category, CATEGORY_LABEL } from "./categories";
import { KEYS, LOG_CAP, getSettings, readLog } from "./storage";
import { lintRegex, MAX_LABEL, MAX_PATTERN, MAX_RULES, type CustomRule } from "./custom";

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
    return;
  }
  draft.forEach((rule, i) => box.append(ruleRow(rule, i)));
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

byId("clear").addEventListener("click", () => {
  // Route through the background (the single log writer) so a clear can't race a
  // buffered batch flush; the storage.onChanged listener re-renders on success.
  chrome.runtime.sendMessage({ type: "ss-clear" }).catch(() => undefined);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (KEYS.log in changes) void renderLog();
  if (KEYS.enabled in changes || KEYS.categories in changes || KEYS.smokescreen in changes) {
    void renderSettings();
  }
});

void renderSettings();
void renderLog();
void loadRules();
