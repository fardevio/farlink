/**
 * Renders public/icon/*.png. Small sizes are drawn pixel by pixel here; large
 * ones come from the Geist Pixel arrow glyph.
 *
 * The mark is a north-east arrow on the far flavour's panel blue, and nothing
 * scales a master image: reducing a raster of pixel art cannot stay crisp.
 * Measured, downscaling a 1024px export kept half its pixels clean at 16px and
 * 91% at 128px, smearing the rest into a washed lavender that lost contrast
 * against the panel. Everything below is 100%.
 *
 * Two sources, because they are good at different scales.
 *
 *   Drawn        16 to 48. The mark was set in Geist Pixel originally, but a
 *                typeface is rasterised for text rather than designed as a 16px
 *                icon: at these sizes its arms came out uneven and its diagonal
 *                stepped irregularly. Laid out here instead, from three parts on
 *                an explicit grid, so the arms are one thickness and the
 *                staircase is even. Side by side this is the clearer mark, and
 *                the one that reads as the same drawing at every size.
 *   Geist Pixel  96 and up, where its blocks-and-gutters form is the real design
 *                and lands on whole pixels. Measured, its outline never divides
 *                12 blocks and 11 gutters evenly on a glyph smaller than 51px at
 *                any point size, which needs a 96px canvas.
 *
 * The blocks reach down to 48 by cutting the gutters into the drawn arrow with a
 * lattice. They stop there: below 48 the only lattice that fits is 1px on 1px,
 * and the diagonal stops being a continuous line, so 32 and under are solid.
 * That is how an icon set normally simplifies as it shrinks.
 *
 * Requires ImageMagick 7. Geist Pixel is needed only for 96 and 128. Neither
 * ships with the extension: the PNGs are committed, so this runs when the icon
 * changes and never as part of a build.
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const BLUE = "#0000aa"
const GLYPH = "↗"
const FONTS = process.env.FONTS ?? join(homedir(), "Library/Fonts")
const OUT = "public/icon"

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
 * The drawn sizes.
 *
 * `box` is the arrow's own grid, centred on the canvas; the original fills about
 * 62% of it. `stroke` is the bar thickness, held near a fifth of the box so the
 * weight reads the same at every size. `pitch` cuts the block gutters back in: 3
 * gives 2px blocks with 1px gutters, which still reads as blocks.
 */
const DRAWN = {
  16: { box: 10, stroke: 2 },
  24: { box: 15, stroke: 3 },
  32: { box: 20, stroke: 4 },
  48: { box: 30, stroke: 6, pitch: 3 }
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

/** How much of the canvas the font glyph should span, for the solved sizes. */
const FILL = { min: 0.5, max: 0.72, ideal: 0.62 }

const magick = (args) =>
  // stderr is discarded on purpose: the point-size search renders sizes that
  // produce no ink, and -trim warns on an empty image dozens of times per run.
  // renderGlyph turns that into a null rather than reading the warning.
  // No -quiet flag: `magick -quiet identify` is not valid, the subcommand has to
  // come first, and prefixing it made every probe look like a failure.
  execFileSync("magick", args, {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "ignore"]
  })

const scratch = join(tmpdir(), `farlink-icons-${process.pid}`)
mkdirSync(scratch, { recursive: true })
const tmp = (name) => join(scratch, name)

/**
 * The arrow as a grid of booleans: a bar along the top, a bar down the right,
 * and a diagonal shaft between them.
 *
 * The shaft is a band of anti-diagonals, widened so its perpendicular width
 * matches the bars. A 45 degree band of n anti-diagonals measures n / sqrt(2)
 * across, so matching a stroke of s takes about s * sqrt(2) of them.
 */
function drawArrow({ box, stroke, pitch }) {
  const half = Math.max(1, Math.round((stroke * Math.SQRT2 - 1) / 2))
  const grid = []
  for (let y = 0; y < box; y++) {
    const row = []
    for (let x = 0; x < box; x++) {
      const inArrow =
        y < stroke || x >= box - stroke || Math.abs(x + y - (box - 1)) <= half
      const kept =
        !pitch || (x % pitch !== pitch - 1 && y % pitch !== pitch - 1)
      row.push(inArrow && kept)
    }
    grid.push(row)
  }
  return grid
}

/**
 * Writes a grid as a PNG, centred on a transparent canvas.
 *
 * Via ImageMagick's pixel enumeration, where the parenthesised tuple is the
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

function fontPath(variant) {
  const path = join(FONTS, `GeistPixel-${variant}.ttf`)
  if (!existsSync(path)) {
    throw new Error(`${path} not found. Install Geist Pixel.`)
  }
  return path
}

/**
 * The glyph alone, antialiasing off, trimmed to its ink. Null when the point
 * size produced no ink, which the small end of the search does: -trim then
 * writes nothing and there is no image to measure. A result, not a failure.
 */
function renderGlyph(pointsize, canvas) {
  const out = tmp(`glyph-${pointsize}.png`)
  try {
    magick([
      "-size",
      `${canvas * 4}x${canvas * 4}`,
      "xc:none",
      "+antialias",
      "-font",
      fontPath("Grid"),
      "-pointsize",
      String(pointsize),
      "-fill",
      "white",
      "-gravity",
      "center",
      "-annotate",
      "+0+0",
      GLYPH,
      "-trim",
      "+repage",
      out
    ])
    const [w, h] = magick(["identify", "-format", "%w %h", out])
      .split(" ")
      .map(Number)
    return w && h ? { out, w, h } : null
  } catch {
    return null
  }
}

/** White and blue run lengths along one row. */
function rowRuns(file, row) {
  const text = magick([
    file,
    "-alpha",
    "off",
    "-crop",
    `100%x1+0+${row}`,
    "+repage",
    "-depth",
    "8",
    "txt:"
  ])
  const lit = [...text.matchAll(/#([0-9A-F]{6})/g)].map(
    (m) => parseInt(m[1].slice(0, 2), 16) > 200
  )
  const out = []
  for (const on of lit) {
    if (out.length && out.at(-1).on === on) out.at(-1).n++
    else out.push({ on, n: 1 })
  }
  return out
}

/** Whether a Grid render landed evenly: one block width, one gutter width. */
function gridResolves(file, height) {
  const rows = [0.08, 0.12].map((f) => Math.max(1, Math.floor(height * f)))
  for (const row of rows) {
    const runs = rowRuns(file, row)
    const blocks = new Set(runs.filter((r) => r.on).map((r) => r.n))
    const gutters = new Set(
      runs
        .filter((r) => !r.on)
        .slice(1, -1)
        .map((r) => r.n)
    )
    if (blocks.size !== 1 || gutters.size > 1) return false
    if (runs.filter((r) => r.on).length < 6) return false
  }
  return true
}

/** The point size whose glyph is square, fills the canvas, and lands evenly. */
function solveGlyph(canvas) {
  const target = canvas * FILL.ideal
  let best = null
  for (let ps = 16; ps <= canvas * 2; ps++) {
    const g = renderGlyph(ps, canvas)
    if (!g || g.w !== g.h) continue
    const fill = g.w / canvas
    if (fill < FILL.min || fill > FILL.max) continue
    if (!gridResolves(g.out, g.h)) continue
    const score = Math.abs(g.w - target)
    if (!best || score < best.score) {
      best = { ps, glyph: g.w, out: g.out, score }
    }
  }
  return best
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
console.log("make-icons: 16 to 48 drawn, 96 and up from Geist Pixel")

let failed = false
for (const canvas of SIZES) {
  let art
  let how
  const drawn = DRAWN[canvas]
  if (drawn) {
    art = gridToPng(drawArrow(drawn), canvas, tmp(`drawn-${canvas}.png`))
    how =
      `drawn, box ${drawn.box} stroke ${drawn.stroke}` +
      (drawn.pitch ? `, blocks at pitch ${drawn.pitch}` : ", solid")
  } else {
    const solved = solveGlyph(canvas)
    if (!solved) {
      console.error(`  ${canvas}: no point size lands the grid on whole pixels`)
      failed = true
      continue
    }
    art = solved.out
    how = `Geist Pixel, pointsize ${solved.ps}, glyph ${solved.glyph}px`
  }

  const file = compose(canvas, art)
  const crisp = crispness(file)
  if (crisp !== 1) failed = true
  const flag = crisp === 1 ? "" : `  <- ${(crisp * 100).toFixed(1)}% crisp`
  console.log(`  ${String(canvas).padStart(3)}  ${how}${flag}`)
}

rmSync(scratch, { recursive: true, force: true })
if (failed) process.exitCode = 1
