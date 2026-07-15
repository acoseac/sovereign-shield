// Bundle the TypeScript sources into plain JS the manifest can load, and copy the
// static files (manifest, HTML pages, icons) alongside them. Output goes to dist/ —
// that folder is what you "Load unpacked" in chrome://extensions.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, cpSync, rmSync } from "node:fs";

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
