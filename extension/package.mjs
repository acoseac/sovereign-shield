// Zip the built extension into a Chrome Web Store upload artifact.
// Run: npm run package  (builds, then zips extension/dist -> sovereign-shield-<version>.zip).
// The zip's root is the dist contents (manifest.json at top level), which is what
// the Web Store expects. The .zip is gitignored.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));
const out = `sovereign-shield-${version}.zip`;

// Resolve `zip` from a fixed set of absolute paths — never a $PATH lookup.
const zipBin = ["/usr/bin/zip", "/bin/zip", "/usr/local/bin/zip", "/opt/homebrew/bin/zip"].find(
  existsSync,
);
if (!zipBin) {
  console.error("`zip` not found — install it, or zip extension/dist manually.");
  process.exit(1);
}

rmSync(out, { force: true });
execFileSync(zipBin, ["-qr", `../${out}`, "."], { cwd: "dist" });
console.log(`Packaged extension/dist -> extension/${out}`);
console.log("Upload that .zip in the Chrome Web Store Developer Dashboard.");
