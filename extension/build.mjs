// Bundle the TypeScript sources into plain JS the manifest can load, and copy the
// static files (manifest, HTML pages, icons) alongside them. Output goes to dist/ —
// that folder is what you "Load unpacked" in chrome://extensions.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, cpSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: {
    interceptor: "src/interceptor.ts", // MAIN world
    bridge: "src/bridge.ts", // ISOLATED world
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
cpSync("icons", "dist/icons", { recursive: true });

console.log("Built extension -> extension/dist (Load unpacked points here).");
