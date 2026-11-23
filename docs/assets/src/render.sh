#!/bin/sh
# ABOUTME: Renders every documentation figure in this folder to light and dark PNGs in docs/assets/.
# ABOUTME: Needs headless Chrome or Chromium (set CHROME to its path) and ImageMagick's magick.
#
# Usage:
#   docs/assets/src/render.sh                 render every figure
#   docs/assets/src/render.sh session         render only the figures named
#   docs/assets/src/render.sh social-preview  render only the social preview card
#   CHROME=/usr/bin/chromium docs/assets/src/render.sh
#
# Each figure is one HTML file here. Its height is declared once, in the file's
# <meta name="figure-height" content="<px>">: figure.js gives the page that
# height and this script uses it for the window, so the capture is exact.

set -eu

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
OUT_DIR=$(dirname -- "$SRC_DIR")

# The README column on github.com is 838 CSS px wide; the PNGs are drawn at 2x.
WIDTH=838
SCALE=2
ALL_FIGURES="pipeline traceability architecture session"

fail() {
  printf 'render.sh: %s\n' "$1" >&2
  exit 1
}

[ -x "$CHROME" ] || fail "no browser at '$CHROME'; set CHROME to a Chrome or Chromium binary"
command -v magick >/dev/null 2>&1 || fail "ImageMagick's magick is not on PATH"

# Prints the height a figure declares in its <meta name="figure-height">.
declared_height() {
  sed -n 's/.*<meta name="figure-height" content="\([0-9][0-9]*\)".*/\1/p' "$1"
}

# Renders one figure in one theme and checks the result.
render() {
  name=$1
  theme=$2
  html="$SRC_DIR/$name.html"
  png="$OUT_DIR/$name-$theme.png"

  [ -f "$html" ] || fail "no source for '$name' at $html"
  height=$(declared_height "$html")
  [ -n "$height" ] || fail "$name.html declares no figure-height"

  # A throwaway profile keeps headless Chrome from handing off to a running Chrome.
  profile=$(mktemp -d)
  rm -f "$png"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --no-first-run \
    --no-default-browser-check \
    --user-data-dir="$profile" \
    --force-device-scale-factor="$SCALE" \
    --window-size="$WIDTH,$height" \
    --virtual-time-budget=3000 \
    --screenshot="$png" \
    "file://$html?theme=$theme" >/dev/null 2>&1 || true
  rm -rf "$profile"
  [ -f "$png" ] || fail "Chrome wrote no screenshot for $name ($theme)"

  # The capture has to be exactly the declared size, at the device scale factor.
  expected="$((WIDTH * SCALE)) $((height * SCALE))"
  actual=$(magick identify -format '%w %h' "$png")
  [ "$actual" = "$expected" ] || fail "$name-$theme.png is $actual px, expected $expected"

  # figure.js outlines the page in pure red when the content overflows its height.
  corner=$(magick "$png" -format '%[hex:p{3,3}]' info:)
  case "$corner" in
    FF0000*) fail "$name ($theme) overflows its figure-height of $height px; raise it" ;;
  esac

  # Lossless: drop metadata and recompress at the highest level.
  magick "$png" -strip -define png:compression-level=9 "$png"

  printf '%s  %s\n' "$(du -k "$png" | cut -f1)K" "${png#"$OUT_DIR"/}"
}

# Renders the social preview card: one fixed 1280 x 640 image at 1x, dark only.
render_social() {
  html="$SRC_DIR/social-preview.html"
  png="$OUT_DIR/social-preview.png"

  profile=$(mktemp -d)
  rm -f "$png"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --no-first-run \
    --no-default-browser-check \
    --user-data-dir="$profile" \
    --force-device-scale-factor=1 \
    --window-size=1280,640 \
    --virtual-time-budget=3000 \
    --screenshot="$png" \
    "file://$html" >/dev/null 2>&1 || true
  rm -rf "$profile"
  [ -f "$png" ] || fail "Chrome wrote no screenshot for the social preview"

  actual=$(magick identify -format '%w %h' "$png")
  [ "$actual" = "1280 640" ] || fail "social-preview.png is $actual px, expected 1280 640"

  magick "$png" -strip -define png:compression-level=9 "$png"
  printf '%s  %s\n' "$(du -k "$png" | cut -f1)K" "${png#"$OUT_DIR"/}"
}

targets=${*:-$ALL_FIGURES social-preview}
for name in $targets; do
  if [ "$name" = "social-preview" ]; then
    render_social
    continue
  fi
  for theme in light dark; do
    render "$name" "$theme"
  done
done
