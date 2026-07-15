// Rasterise icons/shield.svg into the PNG sizes Chrome needs, plus a greyed
// "paused" variant (fill swapped) shown when the guard is off. Run: npm run icons.
// The PNGs are committed so the extension loads without sharp; rerun this only
// when the SVG changes.
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, "icons");
const svg = readFileSync(join(iconsDir, "shield.svg"), "utf8");

const sizes = [16, 32, 48, 128];
const variants = {
  "": svg, // active
  "paused-": svg.replace(/#b42318/i, "#9AA0A6"), // greyed (swap the red shield fill)
};

for (const [prefix, src] of Object.entries(variants)) {
  for (const size of sizes) {
    await sharp(Buffer.from(src), { density: 384 })
      .resize(size, size)
      .png()
      .toFile(join(iconsDir, `icon-${prefix}${size}.png`));
  }
}

console.log("Icons generated -> extension/icons/icon-*.png");
