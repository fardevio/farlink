/**
 * Renders public/icon/*.png. Every size is drawn pixel by pixel from one rule.
 *
 * The mark is a north-east arrow on the far flavor's panel blue, and nothing
 * scales a master image: reducing a raster of pixel art cannot stay crisp.
 * Measured, downscaling a 1024px export kept half its pixels clean at 16px and
 * 91% at 128px, smearing the rest into a washed lavender that lost contrast
 * against the panel. Everything below is 100%.
 *
 * An earlier version set 96 and 128 in Geist Pixel and drew only 16 to 48. A
 * typeface is rasterized for text rather than designed as an icon, and the two
 * techniques did not agree: measured against the canvas, the drawn sizes filled
 * 0.604 to 0.625 of it while the font landed on 0.667 at 96 and 0.594 at 128.
 * Nothing chose those numbers; they fell out of a point-size search. One rule
 * for all six sizes replaces both the font and the search.
 *
 * Requires ImageMagick 7, which does not ship with the extension: the PNGs are
 * committed, so this runs when the icon changes and never as part of a build.
 */

import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BLUE = "#0000aa"
const OUT = "public/icon"

/**
 * The size the promo tiles use, and where their copy of it lives.
 *
 * 96 rather than 128: the tiles draw it at 48 CSS px and capture at
 * deviceScaleFactor 2, so 96 lands exactly 1:1 on device pixels. Any other
 * source size reintroduces the fractional ratio that made the arrow uneven.
 */
const TILE_ICON = 96
const TILE_ICON_PATH = "scripts/shots/icon.png"

/**
 * The sizes Chrome asks for, and one more with a reason.
 *
 * Documented: `icons` names 16 (favicon on the extension's own pages), 48 (the
 * management page) and 128 (install and the Web Store); `action.default_icon`
 * recommends 16, 24 and 32 for the toolbar.
 *
 * 96 is the addition. Chrome "selects the closest available and scales it" when
 * a size is missing, and the management page's 48px slot on a 2x display asks
 * for 96 — which without this would be scaled down from 128, and scaling down is
 * precisely what wrecks pixel art. Every Retina Mac takes that path.
 */
const SIZES = [16, 24, 32, 48, 96, 128]

/**
 * The one rule, from the canvas alone.
 *
 * `bar` is the arm thickness and also the margin, so the mark sits in a box of
 * three quarters the canvas with an eighth of clear space each side, and the
 * three add back to the canvas exactly with nothing left to round. Every size
 * Chrome asks for divides by 8, which is what makes that exact.
 *
 * `band` is the diagonal, counted in columns rather than measured across. A 45
 * degree band of n anti-diagonals is only n / sqrt(2) thick perpendicular to
 * itself, so a shaft drawn at the bar's own count reads visibly thinner than
 * the bars it joins. Hence the ceiling rather than a round: at 24 the nearest
 * integer is 4, which measures 2.83 against a 3px bar, and 5 measures 3.54.
 * Compared side by side at 208px, 4 read thin and 5 read deliberate. Erring
 * heavy is the safe direction, because a shaft slightly lighter than its bars
 * reads as a mistake rather than as a choice.
 */
function geometry(canvas) {
  if (canvas % 8 !== 0) {
    throw new Error(
      `icon size ${canvas} is not divisible by 8, so the bar and the margin ` +
        `would not be whole pixels. Sizes must divide by 8.`
    )
  }
  const bar = canvas / 8
  return { bar, box: (canvas * 3) / 4, band: Math.ceil(bar * Math.SQRT2) }
}

/**
 * Corner radius as a fraction of the side.
 *
 * Matched to the panel, which is what the icon depicts. `.fl-frame` uses a 6px
 * radius on a frame about 640px wide, so it reads as a nearly square terminal
 * window rather than a rounded app tile — and the icon was at 17.5%, which is
 * the app-tile look.
 *
 * A fraction rather than the panel's absolute 6px, because 6px cannot span this
 * range: it is a circle at 16px and barely visible at 128. This fraction gives
 * exactly 6px at 128, the panel's own value, and degrades to 1px at 16 instead
 * of disappearing. The panel's *ratio* would be 0.93%, which at every icon size
 * rounds to square.
 */
const RADIUS = 0.05

const magick = (args) =>
  // stderr is inherited rather than discarded. It used to be dropped because
  // the point-size search rendered sizes that produced no ink and -trim warned
  // on each one, dozens of times per run. That search is gone, so a warning
  // here now means something is actually wrong and should be seen.
  execFileSync("magick", args, {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "inherit"]
  })

const scratch = join(tmpdir(), `farlink-icons-${process.pid}`)
mkdirSync(scratch, { recursive: true })
const tmp = (name) => join(scratch, name)

/**
 * The arrow as a grid of booleans: a bar along the top, a bar down the right,
 * and a diagonal shaft between them.
 *
 * The shaft is the band of anti-diagonals through the box's bottom-left corner,
 * which is the sum x + y == box - 1. An even band cannot sit symmetrically on a
 * single line, so it is biased one column down-right rather than rounded up to
 * an odd width; 32 wants exactly 6 and reads thin at 5.
 */
function drawArrow({ box, bar, band }) {
  const corner = box - 1
  const half = Math.floor(band / 2)
  const grid = []
  for (let y = 0; y < box; y++) {
    const row = []
    for (let x = 0; x < box; x++) {
      const sum = x + y
      row.push(
        y < bar ||
          x >= box - bar ||
          (sum >= corner - half && sum <= corner + band - 1 - half)
      )
    }
    grid.push(row)
  }
  return grid
}

/**
 * Writes a grid as a PNG, centered on a transparent canvas.
 *
 * Via ImageMagick's pixel enumeration, where the parenthesized tuple is the
 * value read and the trailing hex is only a comment. Setting the hex without the
 * tuple produced a fully transparent image.
 */
function gridToPng(grid, canvas, file) {
  const box = grid.length
  const pad = Math.round((canvas - box) / 2)
  const rows = [
    `# ImageMagick pixel enumeration: ${canvas},${canvas},255,srgba`
  ]
  for (let y = 0; y < canvas; y++) {
    for (let x = 0; x < canvas; x++) {
      const gx = x - pad
      const gy = y - pad
      const on = gx >= 0 && gy >= 0 && gx < box && gy < box && grid[gy][gx]
      rows.push(
        on
          ? `${x},${y}: (255,255,255,255)  #FFFFFFFF`
          : `${x},${y}: (0,0,0,0)  #00000000`
      )
    }
  }
  const txt = tmp(`grid-${canvas}.txt`)
  writeFileSync(txt, rows.join("\n") + "\n")
  magick([txt, file])
  return file
}

function compose(canvas, art) {
  // At least 1: a zero radius makes roundrectangle draw nothing at all.
  const radius = Math.max(1, Math.round(canvas * RADIUS))
  const bg = tmp(`bg-${canvas}.png`)
  magick([
    "-size",
    `${canvas}x${canvas}`,
    "xc:none",
    "-fill",
    BLUE,
    "-draw",
    `roundrectangle 0,0,${canvas - 1},${canvas - 1},${radius},${radius}`,
    bg
  ])
  const file = join(OUT, `${canvas}.png`)
  magick([bg, art, "-gravity", "center", "-composite", "-strip", file])
  return file
}

/** Share of lit pixels that are pure white rather than a blend. */
function crispness(file) {
  const text = magick([file, "-alpha", "off", "-depth", "8", "txt:"])
  let pure = 0
  let partial = 0
  for (const [, hex] of text.matchAll(/#([0-9A-F]{6})/g)) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (Math.min(r, g, b) > 240) pure++
    else if (lum > 90) partial++
  }
  return pure + partial === 0 ? 0 : pure / (pure + partial)
}

mkdirSync(OUT, { recursive: true })
console.log("make-icons: every size drawn, box 3/4 of canvas, bar canvas/8")

let failed = false
for (const canvas of SIZES) {
  const { bar, box, band } = geometry(canvas)
  const art = gridToPng(
    drawArrow({ bar, box, band }),
    canvas,
    tmp(`drawn-${canvas}.png`)
  )
  const how = `box ${box} bar ${bar} band ${band}`

  const file = compose(canvas, art)
  const crisp = crispness(file)
  if (crisp !== 1) failed = true
  const flag = crisp === 1 ? "" : `  <- ${(crisp * 100).toFixed(1)}% crisp`
  console.log(`  ${String(canvas).padStart(3)}  ${how}${flag}`)

  // The promo tiles need the icon beside their own HTML: the headless browser
  // that captures them sandboxes file:// reads to the staging directory, so the
  // tiles cannot reach up into public/. Written here rather than copied by
  // make-shots.sh so the two can never disagree -- this copy was a committed
  // hand-made duplicate once, and it silently went stale the first time the
  // icon changed, which would have baked the old mark into both tiles.
  if (canvas === TILE_ICON) copyFileSync(file, TILE_ICON_PATH)
}

rmSync(scratch, { recursive: true, force: true })
if (failed) process.exitCode = 1
