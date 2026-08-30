import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { HUD_CSS } from "~/lib/ui/hud-css"
import { findFlavor, FLAVORS, flavorVariables } from "~/lib/ui/themes"

/**
 * Renders every flavor as a static level strip, for the Web Store theme
 * screenshot. Built from the real palettes and the real HUD stylesheet, so the
 * marketing asset cannot drift from the product.
 */

const CURRENT = [
  { name: "Every link on the page", url: "/item?id=49054010" },
  { name: "What replaced your mouse?", url: "/item?id=49054107" },
  { name: "Far Manager turns thirty", url: "farmanager.com" },
  { name: "Read the discussion", url: "/item?id=49054224" }
]

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!
  )
}

/** The name with its first "a" marked, so the search highlight is visible. */
function marked(name: string): string {
  const at = name.toLowerCase().indexOf("a")
  if (at === -1) return escapeHtml(name)
  return (
    escapeHtml(name.slice(0, at)) +
    `<span class="fl-hit">${escapeHtml(name[at]!)}</span>` +
    escapeHtml(name.slice(at + 1))
  )
}

function strip(flavorId: string): string {
  const flavor = findFlavor(flavorId)
  // The font stack contains double quotes, so the whole declaration block has
  // to be escaped before it goes into a double-quoted style attribute.
  const vars = escapeHtml(
    Object.entries(flavorVariables(flavor))
      .map(([name, value]) => `${name}:${value}`)
      .join(";")
  )

  const column = (items: { name: string; url: string }[], active: number) =>
    items
      .map((item, index) => {
        const cursor = index === active ? " fl-row-cursor" : ""
        return `
        <div class="fl-row${cursor}">
          <span class="fl-name">${marked(item.name)}</span>
          <span class="fl-url">${escapeHtml(item.url)}</span>
        </div>`
      })
      .join("")

  const keys = [
    ["\u2191\u2193", "move"],
    ["type", "filter"],
    ["Enter", "open"],
    ["Alt+Enter", "new tab"],
    ["Alt+,", "settings"],
    ["Alt+\u2190\u2192", "dock"]
  ]
    .map(
      ([key, label]) =>
        `<span class="fl-key-group"><span class="fl-key">${key}</span>` +
        `<span class="fl-key-label">${label}</span></span>`
    )
    .join("")

  return `
  <figure class="tile">
    <figcaption>${flavor.name}</figcaption>
    <div class="host" style="${vars}">
      <div class="fl-frame" data-mode="filter">
        <div class="fl-header">
          <div class="fl-crumbs">
            <span class="fl-crumb fl-crumb-active">4 of 199 links</span>
          </div>
        </div>
        <div class="fl-list">${column(CURRENT, 1)}</div>
        <div class="fl-status">
          <span class="fl-filter">far</span><span class="fl-caret">█</span>
        </div>
        <div class="fl-footer">${keys}</div>
      </div>
    </div>
  </figure>`
}

// The HUD stylesheet is written for a shadow root and positions .fl-frame
// fixed. Rehost it: scope :host to .host and neutralize the fixed placement.
const scoped = HUD_CSS.replace(/:host/g, ".host").replace(
  /\.fl-frame \{[^}]*\}/,
  `.fl-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  font-family: var(--fl-font);
  font-size: 12px;
  line-height: 19px;
  color: var(--fl-fg);
  background: var(--fl-bg);
  border: 1px solid var(--fl-border);
  border-radius: 5px;
  overflow: hidden;
}`
)

/**
 * The store requires screenshots at exactly 1280x800, and all thirteen strips
 * do not fit: the grid runs to five rows and the capture severs the fourth,
 * which reads as a rendering fault rather than as a list that continues.
 * `--store` shows a complete two-row grid and lets the heading carry the
 * count. Without the flag the page shows every flavor, which is what makes
 * it useful for checking a palette you just added.
 */
const storeMode = process.argv.includes("--store")
/** How many strips fit a 1280x800 capture with a complete bottom row. */
const STORE_SHOWN = 6
const shown = storeMode ? FLAVORS.slice(0, STORE_SHOWN) : FLAVORS
/** In store mode the grid ends well above the fold; name what is missing
 *  rather than leaving 190px of empty backdrop. */
const rest = storeMode
  ? `<p class="rest">Also included: ${FLAVORS.slice(STORE_SHOWN)
      .map((f) => f.name)
      .join(" · ")}</p>`
  : ""
const PANEL_LINE =
  "One panel, docked to any corner of any page. It never touches the " +
  "page's own styles, and it never lets the page show through its own."
const subtitle = storeMode
  ? `${spelled(STORE_SHOWN)} of the ${spelled(
      FLAVORS.length
    ).toLowerCase()}. ${PANEL_LINE}`
  : PANEL_LINE

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FarLink themes</title>
<style>
  body {
    margin: 0; padding: 28px 32px; background: #14151a;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { color: #f5f6f8; font-size: 22px; margin: 0 0 4px; }
  p.sub { color: #9aa0ac; font-size: 14px; margin: 0 0 26px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  figcaption {
    color: #9aa0ac; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.08em; margin-bottom: 7px;
  }
  figure { margin: 0; }
  p.rest {
    color: #9aa0ac; font-size: 13px; margin: 30px 0 0;
    padding-top: 18px; border-top: 1px solid #262932;
  }
  ${scoped}
  /* all:initial from the rehosted :host rule makes the div inline. */
  .host { display: block; }
</style></head>
<body>
  <h1>${spelled(FLAVORS.length)} themes, defaulting to a Far Manager blue panel</h1>
  <p class="sub">${subtitle}</p>
  <div class="grid">
    ${shown.map((f) => strip(f.id)).join("")}
  </div>
  ${rest}
</body></html>`

const out = process.argv[2] ?? ".scratch/gallery.html"
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
console.log(`wrote ${out}`)

/**
 * The heading reads as prose, so the count is spelled. It is derived from
 * FLAVORS rather than typed: the previous heading said "Fourteen" for two
 * flavors after the list stopped having fourteen.
 */
function spelled(n: number): string {
  const words = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
    "Twenty"
  ]
  return words[n] ?? String(n)
}

// ---- promo tile -----------------------------------------------------------

if (process.argv[3] === "--promo") {
  const far = FLAVORS[0]!
  const vars = escapeHtml(
    Object.entries(flavorVariables(far))
      .map(([name, value]) => `${name}:${value}`)
      .join(";")
  )
  const promo = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FarLink</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; width: 440px; height: 280px; overflow: hidden;
    background: linear-gradient(160deg, #0a0d1f 0%, #141a3a 100%);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    padding: 26px 28px; gap: 14px;
  }
  h1 {
    margin: 0; font-size: 30px; letter-spacing: -0.5px;
    color: #ffff55; font-family: var(--fl-font);
  }
  p { margin: 0; font-size: 13px; line-height: 1.45; color: #b9c0d4; }
  ${scoped}
  .host { display: block; }
  .fl-frame { box-shadow: 0 10px 26px -10px rgba(0,0,0,0.8); }
  .fl-row { height: 18px; }
</style></head>
<body>
  <div style="${vars}">
    <h1>FarLink</h1>
    <p style="margin-top:5px">Every link on the page, filtered by title or
    address — without a mouse.</p>
  </div>
  <div class="host" style="${vars}">
    <div class="fl-frame">
      <div class="fl-header">
        <div class="fl-crumbs">
          <span class="fl-crumb">news.ycombinator.com</span><span class="fl-sep">›</span>
          <span class="fl-crumb fl-crumb-active">3 of 199 links</span>
        </div>
      </div>
      <div class="fl-list">
        <div class="fl-row"><span class="fl-name">Show HN: Every link, from the keyboard</span><span class="fl-url">/item?id=49054010</span></div>
        <div class="fl-row fl-row-cursor"><span class="fl-name">Ask HN: What replaced your mouse?</span><span class="fl-url">/item?id=49054107</span></div>
        <div class="fl-row"><span class="fl-name">Far Manager turns thirty</span><span class="fl-url">farmanager.com</span></div>
      </div>
      <div class="fl-footer">
        <span class="fl-key-group"><span class="fl-key">\u2191\u2193</span><span class="fl-key-label">move</span></span>
        <span class="fl-key-group"><span class="fl-key">type</span><span class="fl-key-label">filter</span></span>
        <span class="fl-key-group"><span class="fl-key">Enter</span><span class="fl-key-label">open</span></span>
        <span class="fl-key-group"><span class="fl-key">Alt+Enter</span><span class="fl-key-label">new tab</span></span>
      </div>
    </div>
  </div>
</body></html>`
  const promoOut = process.argv[2] ?? ".scratch/promo.html"
  mkdirSync(dirname(promoOut), { recursive: true })
  writeFileSync(promoOut, promo)
  console.log("wrote promo tile html")
}
