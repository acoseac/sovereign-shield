// Options page: master on/off, per-category block toggles, and the activity log
// (type + time + site only). Live-updates on storage changes.
import { CATEGORIES, CATEGORY_LABEL } from "./categories";
import { KEYS, LOG_CAP, getSettings, readLog } from "./storage";

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const enabledEl = byId("enabled") as HTMLInputElement;

async function renderSettings(): Promise<void> {
  const s = await getSettings();
  enabledEl.checked = s.enabled;

  const box = byId("categories");
  if (box.childElementCount === 0) {
    // First render: build the checkbox list once.
    for (const c of CATEGORIES) {
      const label = document.createElement("label");
      label.className = "cat";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = `cat-${c.key}`;
      cb.checked = s.categories.includes(c.key);
      cb.addEventListener("change", saveCategories);
      label.append(cb, document.createTextNode(c.label));
      box.append(label);
    }
    return;
  }
  // Live update (a storage change echoes back here): only sync the checked state, so
  // toggling a box mid-keyboard-navigation doesn't blow away the list and lose focus.
  for (const c of CATEGORIES) {
    const cb = document.getElementById(`cat-${c.key}`) as HTMLInputElement | null;
    if (cb) cb.checked = s.categories.includes(c.key);
  }
}

async function saveCategories(): Promise<void> {
  const enabled = CATEGORIES.filter(
    (c) => (document.getElementById(`cat-${c.key}`) as HTMLInputElement | null)?.checked,
  ).map((c) => c.key);
  await chrome.storage.local.set({ [KEYS.categories]: enabled });
}

enabledEl.addEventListener("change", () => {
  chrome.storage.local.set({ [KEYS.enabled]: enabledEl.checked }).catch(() => undefined);
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
  if (KEYS.enabled in changes || KEYS.categories in changes) void renderSettings();
});

void renderSettings();
void renderLog();
