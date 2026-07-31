import type { Projection } from "~/lib/nav/session"
import { altLabel } from "~/lib/platform"

import { Column, truncate } from "./column"
import { HUD_CSS } from "./hud-css"
import { leaveTrail } from "./trail"

/**
 * The panel: one list, docked in a corner.
 *
 * Three columns were tried and reverted: they needed the whole viewport in
 * exchange for context most pages do not have.
 *
 * Vanilla DOM, not React. This repaints on every keypress inside a 16.7 ms
 * budget, and a framework would also ship a UI runtime into a document_start
 * content script on every page.
 *
 * SECURITY: page strings reach the DOM only through `textContent`. There is no
 * `innerHTML` here and there must never be: accessible names are
 * attacker-controlled.
 */

/**
 * Everything in the panel that is not a row.
 *
 * The header, the status line and the key bar, plus the frame's own borders and
 * the list's padding. The row budget has to be computed from the space
 * available rather than measured from the list, because the panel is sized by
 * its content and measuring would be circular — so this number stands in for a
 * measurement, and has to be right.
 *
 * One constant, not one per size: all three sizes draw the same three bands.
 * This replaces three hand-maintained figures (57 for compact, 81 for the other
 * two) that were each wrong. Measured against the real stylesheet:
 *
 *   header  24 min-height + 10 padding + 1 border = 35
 *   status  23 min-height +  6 padding + 1 border = 30
 *   footer  16 line-height +  8 padding + 1 border = 25
 *   list padding 4 + 4                             =  8
 *   frame border 1 + 1                             =  2
 *                                                   ---
 *                                                   100
 *
 * At 81 the panel computed a budget whose rows overflowed its own `max-height`
 * and were clipped a pixel; at 57 compact drew a whole row that did not fit.
 * Compact therefore shows one row fewer than it used to, which is the row it
 * was never able to display. `hud-css.test.ts` derives this sum from HUD_CSS so
 * the two cannot drift apart again.
 */
export const PANEL_CHROME = 100

/** Per size: the panel's height cap as a fraction of the viewport. */
const SIZES: Record<string, { vh: number }> = {
  compact: { vh: 0.3 },
  normal: { vh: 0.62 },
  full: { vh: 0.92 }
}

/** Must match `.fl-row { height }` in hud-css.ts. */
/**
 * Exported so a test can hold it against the `.fl-row` rule in `hud-css.ts`.
 * The row budget is computed from this number while the browser lays rows out
 * from the stylesheet, so a drift between the two is invisible until the panel
 * quietly shows one row too many or too few.
 */
export const ROW_HEIGHT = 21

/**
 * What to warn about when the cursor could not be re-found after the page
 * mutated, or null when it was found.
 *
 * Named for what happened to the page, not the mechanism that noticed: this
 * read "anchor lost", which is a module in this repo and an `<a>` on the web.
 * The two states are distinct because the response differs. On "page changed"
 * the highlighted row may not be the one you picked; on "selection lost" it
 * certainly is not.
 */
export function badgeText(quality: Projection["quality"]): string | null {
  if (quality === "degraded") return "page changed"
  if (quality === "lost") return "selection lost"
  return null
}

/**
 * What the Shortcut row says, for each of the three things we can know.
 *
 * "Not bound" is only ever printed on Chrome's own authority. If the worker did
 * not answer we say so: a shortcut that works while the panel calls it unbound
 * is worse than admitting the panel could not find out.
 */
export function shortcutLabel(
  chord: { value: string } | null,
  pending: boolean
): string {
  if (chord) return chord.value || "not bound — Enter to set"
  return pending ? "checking…" : "unknown — Enter to check"
}

export class Hud {
  private root: ShadowRoot
  private style: HTMLStyleElement
  private frame: HTMLElement
  private breadcrumb: HTMLElement
  private badge: HTMLElement
  private list: Column
  private footer: HTMLElement
  private statusBar: HTMLElement
  private lastDock: string | null = null
  private lastMode: string | null = null
  /** Built once. Constructing a MediaQueryList parses the query string, and
   *  `.matches` stays live, so there is nothing to gain by rebuilding it. */
  private reducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  )

  constructor(shadow: ShadowRoot) {
    this.root = shadow

    this.style = document.createElement("style")
    this.style.textContent = HUD_CSS
    this.root.appendChild(this.style)

    this.frame = div("fl-frame")
    this.frame.hidden = true

    const header = div("fl-header")
    this.breadcrumb = div("fl-crumbs")
    this.badge = div("fl-badge")
    header.append(this.breadcrumb, this.badge)

    this.list = new Column("fl-list", { showUrl: true })

    this.statusBar = div("fl-status")
    this.footer = div("fl-footer")

    this.frame.append(header, this.list.el, this.statusBar, this.footer)
    this.root.appendChild(this.frame)
  }

  /**
   * The panel's own rect, for the visibility tests that must not count a
   * covered element as visible. Null whenever nothing is drawn.
   */
  obstruction(): DOMRect | null {
    if (this.frame.hidden) return null
    return this.frame.getBoundingClientRect()
  }

  render(projection: Projection): void {
    if (projection.mode === "off") {
      this.frame.hidden = true
      return
    }
    this.frame.hidden = false
    // Only on change. render() runs on every keystroke, and `data-mode` is
    // matched by descendant selectors, so rewriting it with the same value can
    // schedule a style recalculation for every row in the list.
    if (this.lastMode !== projection.mode) {
      this.frame.dataset.mode = projection.mode
      this.lastMode = projection.mode
    }
    this.moveTo(`${projection.dockX} ${projection.dockY} ${projection.size}`)

    this.renderBreadcrumb(projection.breadcrumb)
    this.renderBadge(projection)
    this.list.render(
      projection.items,
      projection.cursorIndex,
      this.rowBudget(projection.size),
      { busy: projection.busy }
    )
    this.renderStatus(projection)
    this.renderFooter(projection)
  }

  /**
   * Put the panel in a corner at a size, leaving a trail if either changed.
   *
   * The rect has to be read before the attribute changes and again after, which
   * costs two layout flushes, acceptable because it happens on a deliberate
   * keypress and never on the per-keystroke path.
   */
  private moveTo(layout: string): void {
    // render() runs on every keystroke and calls this every time. Rewriting the
    // three attributes schedules an invalidation for each one even when the
    // value is identical, and `data-size` is matched by a descendant selector,
    // so an unchanged write can recalculate style for every row in the list.
    if (this.lastDock === layout) return

    const moving = this.lastDock !== null
    const before = moving ? this.frame.getBoundingClientRect() : null

    const [x, y, size] = layout.split(" ")
    this.frame.dataset.dockX = x
    this.frame.dataset.dockY = y
    this.frame.dataset.size = size
    this.lastDock = layout

    if (!before || this.motionReduced()) return
    const after = this.frame.getBoundingClientRect()
    leaveTrail(this.root, before, after)
  }

  private motionReduced(): boolean {
    return this.reducedMotion?.matches === true
  }

  /** How many rows fit in the panel at its tallest. */
  private rowBudget(size: string): number {
    const { vh } = SIZES[size] ?? SIZES.normal!
    const available = window.innerHeight * vh - PANEL_CHROME
    return Math.max(1, Math.floor(available / ROW_HEIGHT))
  }

  private renderBreadcrumb(crumbs: string[]): void {
    this.breadcrumb.replaceChildren()
    // Deepest few only. A full path wraps and pushes the list off screen.
    const shown = crumbs.slice(-4)
    if (crumbs.length > shown.length) {
      this.breadcrumb.appendChild(span("fl-crumb fl-crumb-more", "…"))
    }
    shown.forEach((crumb, index) => {
      if (index > 0) this.breadcrumb.appendChild(span("fl-sep", "›"))
      const last = index === shown.length - 1
      this.breadcrumb.appendChild(
        span(`fl-crumb${last ? " fl-crumb-active" : ""}`, truncate(crumb, 28))
      )
    })
  }

  private renderBadge(projection: Projection): void {
    this.badge.replaceChildren()
    const warning = badgeText(projection.quality)
    if (warning) this.badge.appendChild(span("fl-warn", warning))
    if (projection.pending) {
      this.badge.appendChild(span("fl-pending", projection.pending))
    }
    if (projection.notice) {
      this.badge.appendChild(span("fl-notice", projection.notice))
    }
  }

  /**
   * The status line, which is always present.
   *
   * Deliberately not hidden when empty. A row appearing at the foot of the
   * panel pushes everything above it, so pressing Enter made the whole panel
   * jump as "Opening…" arrived. Holding the row open costs one thin strip and
   * buys a panel that never moves under the reader.
   */
  private renderStatus(projection: Projection): void {
    this.statusBar.replaceChildren()

    const filtering = projection.mode === "filter"

    // No "/" prompt. There is no prefix to announce any more, you just type,
    // and the bar going opaque with an accent rule and a block cursor is a
    // better signal than a glyph, because it changes the whole surface you are
    // typing into rather than adding a character in front of your query.
    if (filtering || projection.filter) {
      this.statusBar.appendChild(span("fl-filter", projection.filter))
    }

    if (filtering) {
      this.statusBar.appendChild(span("fl-caret", "█"))
      return
    }

    if (projection.status) {
      const message = span(
        projection.awaitingConfirm ? "fl-warn" : "fl-message",
        projection.status
      )
      if (projection.filter) message.classList.add("fl-status-end")
      this.statusBar.appendChild(message)
    }
  }

  private renderFooter(projection: Projection): void {
    // ⌥ on macOS, "Alt+" everywhere else. macOS keyboards print ⌥ on the key
    // and every Mac application shows it, so "Alt" there is the wrong name; the
    // glyph is only safe on macOS, where the font stack starts with SF Mono,
    // which has it. Adding Shift to the tab chord switches to it, documented
    // rather than shown, because the bar has a budget.
    const alt = altLabel()
    // Compact keeps a key bar, cut down. The full six need 571px on one line
    // and wrap to two below 580px, costing more height than the rows they
    // explain; but dropping the bar altogether left the one size with no way to
    // discover how to leave it. These three need 282px, so they fit compact's
    // 380px, and they are exactly the ways out.
    const keys =
      projection.mode === "settings"
        ? [
            ["↑↓", "choose"],
            ["←→", "change"],
            ["Enter", "open"],
            ["Esc", "back"]
          ]
        : projection.size === "compact"
          ? [
              [`${alt}S`, "size"],
              [`${alt},`, "settings"],
              ["Esc", "exit"]
            ]
          : [
              ["↑↓", "move"],
              ["type", "filter"],
              ["Enter", "open"],
              [`${alt}Enter`, "new tab"],
              [`${alt},`, "settings"],
              ["Esc", "exit"]
            ]

    this.footer.replaceChildren()
    for (const [key, label] of keys) {
      const group = span("fl-key-group", "")
      group.append(span("fl-key", key!), span("fl-key-label", label!))
      this.footer.appendChild(group)
    }
  }

  destroy(): void {
    this.frame.remove()
    this.style.remove()
  }
}

function div(className: string): HTMLElement {
  const el = document.createElement("div")
  el.className = className
  return el
}

function span(className: string, text: string): HTMLElement {
  const el = document.createElement("span")
  el.className = className
  el.textContent = text
  return el
}
