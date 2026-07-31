#!/usr/bin/env bash
#
# Regenerates the Chrome Web Store screenshots into store/screenshots/.
#
# The output is deliberately NOT committed: it is a build product of the
# shipping bundle plus whatever the source sites looked like that day, and a
# stale set is worse than none. The previous set was committed and went stale
# silently when the panel narrowed — the store then showed a shape the product
# no longer had. Run this before an upload; upload from the working tree.
#
#   pnpm shots
#
# Needs: a built extension (this runs `pnpm build` first), ImageMagick, and the
# gstack headless browser. It drives the *real* content-script bundle against
# live pages through a small chrome shim, so what is captured is what ships.
#
# Three screenshots plus the promo tile. 4-address (matching a query in the
# address column) and 5-light (a light theme in the opposite corner) were cut
# deliberately — the store shows the first few and the set earns more by being
# short than by being complete.
#
# Why 960x600 at deviceScaleFactor 2, downsampled to the store's fixed 1280x800:
#
# Rendering a 1280-CSS-wide window straight into 1280x800 gives 1x text, which
# is small on the listing page and blurry the moment a retina display scales it
# up. Rendering at 2x and downsampling supersamples every glyph, and because the
# window is 960 CSS wide rather than 1280, the result is also 1.33x larger than
# native — legible at the size these are actually browsed.
#
# 960x600 rather than 640x400, which would be a clean 2x with no resampling at
# all: at 400 CSS px tall `rowBudget` draws 7 rows while the list stretches to
# the panel's max-height, leaving dead space under the last row. That is an
# artifact of a window size nobody uses, and a screenshot should not invent one.
# 960x600 is a plausible browser window and the panel fills it properly.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
B="$HOME/.claude/skills/gstack/browse/dist/browse"
OUT="$ROOT/store/screenshots"
WORK="$ROOT/.scratch/shots"
BUNDLE="$ROOT/build/chrome-mv3/content-scripts/farlink.js"

[ -x "$B" ] || { echo "gstack browse not found at $B" >&2; exit 1; }
command -v magick >/dev/null || { echo "ImageMagick 'magick' not found" >&2; exit 1; }

echo "==> building the extension"
pnpm build >/dev/null
[ -f "$BUNDLE" ] || { echo "no bundle at $BUNDLE" >&2; exit 1; }

mkdir -p "$OUT" "$WORK"

# Loads the shim + the shipping bundle into the current page and opens the panel.
# $1 url  $2 flavorId  $3 dockX  $4 dockY  $5 size
open_panel() {
  printf 'window.__shot={flavorId:"%s",dockX:"%s",dockY:"%s",size:"%s"}\n' \
    "$2" "$3" "$4" "$5" > "$WORK/cfg.js"
  $B goto "$1" >/dev/null
  sleep 3
  $B eval "$WORK/cfg.js" >/dev/null
  $B eval "$ROOT/scripts/shots/shim.js" >/dev/null
  $B eval "$BUNDLE" >/dev/null
  $B js "window.__farlink.toggle()" >/dev/null
  sleep 1
}

# 24-bit, no alpha, 8 bits per channel — what the store wants, and what keeps
# the file off a megabyte. Saving at 16 bits per channel tripled the size for
# no visible gain.
# $3, when given, is the target size to downsample to.
finish() {
  if [ -n "${3:-}" ]; then
    magick "$1" -filter Lanczos -resize "$3" \
      -strip -alpha off -depth 8 -define png:compression-level=9 "$2"
  else
    magick "$1" -strip -alpha off -depth 8 -define png:compression-level=9 "$2"
  fi
  printf '    %-34s %s\n' "$(basename "$2")" \
    "$(magick identify -format '%wx%h' "$2") $(( $(stat -f%z "$2" 2>/dev/null || stat -c%s "$2") / 1024 ))kB"
}

$B viewport 960x600 --scale 2 >/dev/null

echo "==> 1-index: the whole index, unfiltered"
# The hero, and deliberately NOT filtered. The promise is "every link on the
# page in one list"; a filtered panel shows the second beat before the first,
# and an earlier set had all five shots filtered, which never showed the
# product's actual resting state.
open_panel "https://news.ycombinator.com/" far left bottom normal
$B screenshot --viewport "$WORK/1.png" >/dev/null
finish "$WORK/1.png" "$OUT/1-index.png" 1280x800

echo "==> 2-filter: narrowing a large page by title"
# Wikipedia rather than GitHub: at 960 CSS wide GitHub collapses to its tablet
# layout and the docked panel lands on top of its nav, which reads as broken
# rather than as an overlay.
open_panel "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference" far left bottom normal
$B type "grid" >/dev/null; sleep 1
$B screenshot --viewport "$WORK/2.png" >/dev/null
finish "$WORK/2.png" "$OUT/2-filter.png" 1280x800

echo "==> 3-themes: four of the thirteen"
THEMES="far yazi paper macintosh"
for f in $THEMES; do
  open_panel "https://news.ycombinator.com/" "$f" left bottom normal
  $B screenshot --viewport "$WORK/t-$f-full.png" >/dev/null
  # Crop the panel out of the 2x capture at its native device resolution, so
  # the only scaling is the modest one the tiling does below.
  BOX=$($B js "(()=>{const tag=[...document.documentElement.children].find(e=>e.tagName.toLowerCase().startsWith('farlink-')).tagName.toLowerCase();let t=null,b=null,l=null,r=null;for(let y=0;y<600;y++){const h=document.elementFromPoint(40,y);if(h&&h.tagName.toLowerCase()===tag){if(t===null)t=y;b=y}}for(let x=0;x<960;x++){const h=document.elementFromPoint(x,(t+b)/2|0);if(h&&h.tagName.toLowerCase()===tag){if(l===null)l=x;r=x}}return [l*2,t*2,(r-l+1)*2,(b-t+1)*2].join(' ')})()" | tail -1)
  set -- $BOX
  magick "$WORK/t-$f-full.png" -crop "${3}x${4}+${1}+${2}" +repage "$WORK/t-$f.png"
done
# Two columns, three rows: each panel lands near its native CSS size rather
# than being shrunk to a third of the frame, which is what made the old montage
# the blurriest of the five.
#
# Composited by hand rather than with `magick montage`, which insists on
# resolving a font even when nothing is labelled and exits non-zero when it
# cannot — fine when its warning was ignored, fatal under `set -e`.
# 2x2 rather than 2x3: four themes at 620px beat six at 600px, and the four
# chosen are the ones that differ most — DOS blue, a modern dark, a light paper
# and a black-and-white retro. Six included two dark themes that read alike at
# tile size.
CELL_W=640
CELL_H=400
TILE_W=620
magick -size 1280x800 "xc:#f2f2ef" "$WORK/3-canvas.png"
i=0
for f in $THEMES; do
  magick "$WORK/t-$f.png" -resize "${TILE_W}x" "$WORK/t-$f-fit.png"
  th=$(magick identify -format '%h' "$WORK/t-$f-fit.png")
  col=$(( i % 2 ))
  row=$(( i / 2 ))
  x=$(( col * CELL_W + (CELL_W - TILE_W) / 2 ))
  y=$(( row * CELL_H + (CELL_H - th) / 2 ))
  magick "$WORK/3-canvas.png" "$WORK/t-$f-fit.png" \
    -geometry "+${x}+${y}" -composite "$WORK/3-canvas.png"
  i=$(( i + 1 ))
done
finish "$WORK/3-canvas.png" "$OUT/3-themes.png"

echo "==> promo-440x280"
$B viewport 220x140 --scale 2 >/dev/null
$B goto "file://$ROOT/scripts/shots/promo.html" >/dev/null
sleep 1
$B screenshot --viewport "$WORK/promo.png" >/dev/null
finish "$WORK/promo.png" "$OUT/promo-440x280.png"

echo
echo "Done. These are build products and are gitignored — upload from here:"
echo "  $OUT"
