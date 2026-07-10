// ISOLATED-world content script. It is the only half that can touch chrome.*,
// so it bridges settings and counts between the popup and the MAIN-world guard.
// The two worlds share the DOM but not their globals, so they talk through
// data-* attributes on <html>:
//   data-ss-enabled  bridge -> guard   ("on" | "off")
//   data-ss-kept     guard  -> bridge  (running count, read by the popup)
const KEY = "ssEnabled";

function applyEnabled(enabled: boolean): void {
  document.documentElement.setAttribute("data-ss-enabled", enabled ? "on" : "off");
}

// Default ON when unset.
chrome.storage.local.get(KEY).then((v) => applyEnabled(v[KEY] !== false));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && KEY in changes) applyEnabled(changes[KEY].newValue !== false);
});

// The popup asks for live status; answer from the shared DOM attributes.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ss-status") {
    const root = document.documentElement;
    sendResponse({
      enabled: root.getAttribute("data-ss-enabled") !== "off",
      kept: Number(root.getAttribute("data-ss-kept") ?? "0"),
    });
  }
  return true;
});
