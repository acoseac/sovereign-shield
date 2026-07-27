// Bundle the TypeScript sources into plain JS the manifest can load, and copy the
// static files (manifest, HTML pages, icons) alongside them. Output goes to dist/ —
// that folder is what you "Load unpacked" in chrome://extensions.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, cpSync, rmSync, readFileSync } from "node:fs";

import { SUPPORTED_HOSTS } from "./src/sites.ts";

// manifest.json is static JSON, so it cannot import SUPPORTED_HOSTS — assert they agree
// instead. Without this the site list has two independent halves: add a host to sites.ts and
// forget the manifest and the content scripts never run there; add it to the manifest only and
// the transport classifier falls through to "unknown host", which quietly hooks BOTH wrappers.
// Both failures are silent at runtime, so catch them here.
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

// Chrome match patterns are not URLs: the scheme may be `*` and the host may carry a leading
// `*.`, both of which make `new URL()` throw. Normalise those two legal forms, and throw a
// legible error on anything else. Deliberately NOT skipping unparseable patterns — a
// consistency check that quietly ignores the entry it cannot read would pass while the drift
// it exists to catch is still there.
const hostOf = (pattern) => {
  const normalised = pattern.replace(/^\*:\/\//, "https://").replace(/\*$/, "");
  let hostname;
  try {
    ({ hostname } = new URL(normalised));
  } catch {
    throw new Error(`manifest.json: cannot read a hostname out of match pattern "${pattern}"`);
  }
  return hostname.replace(/^\*\./, ""); // *.claude.ai and claude.ai are the same site to us
};
// One comparator for both sides — the two lists are compared by their joined form, so they
// only have to agree with each other, but they have to agree exactly.
const byName = (a, b) => a.localeCompare(b);
const hostsOf = (patterns) => [...new Set(patterns.map(hostOf))].sort(byName);
const expected = [...SUPPORTED_HOSTS].sort(byName);

const mismatches = [["host_permissions", manifest.host_permissions]]
  .concat(manifest.content_scripts.map((cs, i) => [`content_scripts[${i}].matches`, cs.matches]))
  .map(([label, patterns]) => [label, hostsOf(patterns)])
  .filter(([, hosts]) => hosts.join() !== expected.join());

if (mismatches.length > 0) {
  for (const [label, hosts] of mismatches) {
    console.error(`  manifest.json ${label}:\n    has      ${hosts.join(", ")}\n    expected ${expected.join(", ")}`);
  }
  throw new Error("manifest.json hosts disagree with SUPPORTED_HOSTS in src/sites.ts — fix both.");
}

rmSync("dist", { recursive: true, force: true }); // start clean so removed/renamed files never linger
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: {
    interceptor: "src/interceptor.ts", // MAIN world
    bridge: "src/bridge.ts", // ISOLATED world
    indicator: "src/indicator.ts", // ISOLATED world (Gemini pre-send pill)
    background: "src/background.ts", // service worker
    popup: "src/popup.ts",
    options: "src/options.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome111",
  legalComments: "none",
  logLevel: "info",
});

for (const file of ["manifest.json", "popup.html", "options.html"]) {
  copyFileSync(file, `dist/${file}`);
}
// Ship only the rasterised PNGs — the source shield.svg isn't referenced by the
// manifest, so keep it out of the packaged extension.
cpSync("icons", "dist/icons", { recursive: true, filter: (src) => !src.endsWith(".svg") });

console.log("Built extension -> extension/dist (Load unpacked points here).");
