#!/usr/bin/env bash
#
# Render the Chrome Web Store visual assets from the self-contained HTML templates
# in this folder — pixel-clean, reproducible, no logged-in browser session needed.
#
# Outputs (into $OUT, default ~/Desktop/sovereign-shield-store-screenshots):
#   1-gemini.png 2-chatgpt.png 3-claude.png   store screenshots, 1280x800
#   small-promo-440x280.png                    small promo tile, 440x280
# (4-options.png and 5-gemini-proof.png are LIVE captures — not generated here.)
#
# macOS only: uses Google Chrome (headless) + `sips`. Override the browser with
# CHROME=/path/to/chrome. See ../RELEASING.md for the full release procedure.
#
# Usage:
#   ./render.sh                     # screenshots + small promo
#   ./render.sh screenshots         # just the 3 screenshots
#   ./render.sh promo               # just the small promo
#   OUT=~/Desktop/shots ./render.sh # pick the output dir
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="${OUT:-$HOME/Desktop/sovereign-shield-store-screenshots}"
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/ss-render.XXXXXX")"
trap 'rm -rf "$PROFILE"' EXIT

[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME  (set CHROME=/path/to/chrome)" >&2; exit 1; }
command -v sips >/dev/null || { echo "sips not found — this script is macOS-only." >&2; exit 1; }
mkdir -p "$OUT"

# render <url> <width> <height> <out.png>
# Renders at 2x device scale for crisp text, then downsamples to exactly WxH.
# Chrome --headless can hang, so run it detached, poll for the file, then kill it.
render() {
  local url="$1" w="$2" h="$3" out="$4"
  local raw="$PROFILE/raw-$(basename "$out")"
  rm -f "$raw"
  "$CHROME" --headless=new --hide-scrollbars --disable-gpu \
    --force-device-scale-factor=2 --window-size="$w,$h" \
    --no-first-run --no-default-browser-check \
    --user-data-dir="$PROFILE/chrome" \
    --screenshot="$raw" "$url" >/dev/null 2>&1 &
  local pid=$! i
  for i in $(seq 1 25); do [ -f "$raw" ] && break; sleep 1; done
  sleep 1; kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  [ -f "$raw" ] || { echo "  ! FAILED to render $(basename "$out")" >&2; return 1; }
  sips -z "$h" "$w" "$raw" --out "$out" >/dev/null 2>&1
  # CWS wants 24-bit PNG (no alpha). An opaque background yields alpha=no; flag a stray channel.
  local info; info="$(sips -g pixelWidth -g pixelHeight -g hasAlpha "$out" 2>/dev/null)"
  printf "  %-26s %sx%s  alpha=%s\n" "$(basename "$out")" \
    "$(awk '/pixelWidth/{print $2}'  <<<"$info")" \
    "$(awk '/pixelHeight/{print $2}' <<<"$info")" \
    "$(awk '/hasAlpha/{print $2}'    <<<"$info")"
}

do_screenshots() {
  echo "Screenshots (1280x800) -> $OUT"
  render "file://$HERE/tile.html?site=gemini"  1280 800 "$OUT/1-gemini.png"
  render "file://$HERE/tile.html?site=chatgpt" 1280 800 "$OUT/2-chatgpt.png"
  render "file://$HERE/tile.html?site=claude"  1280 800 "$OUT/3-claude.png"
}

do_promo() {
  echo "Small promo (440x280) -> $OUT"
  render "file://$HERE/promo-small.html" 440 280 "$OUT/small-promo-440x280.png"
}

case "${1:-all}" in
  screenshots) do_screenshots ;;
  promo)       do_promo ;;
  all)         do_screenshots; do_promo ;;
  *) echo "usage: $0 [screenshots|promo|all]" >&2; exit 2 ;;
esac

echo "Done. Reminder: 4-options.png + 5-gemini-proof.png are live captures — see ../RELEASING.md."
