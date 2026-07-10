// Bundle the TypeScript sources into plain JS the manifest can load, and copy the
// static files alongside them. Output goes to dist/ — that folder is what you
// "Load unpacked" in chrome://extensions.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: {
    interceptor: "src/interceptor.ts",
    bridge: "src/bridge.ts",
    popup: "src/popup.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome111",
  legalComments: "none",
  logLevel: "info",
});

for (const file of ["manifest.json", "popup.html"]) {
  copyFileSync(file, `dist/${file}`);
}

console.log("Built extension -> extension/dist (Load unpacked points here).");
