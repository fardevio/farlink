import { visibleBand } from "~/lib/occlusion"
import type { Box } from "~/lib/occlusion"

/**
 * The cursor rectangle on the page, and the scrolling that keeps it visible.
 *
 * Vanilla DOM on purpose: these update on every keypress and on scroll, and
 * routing them through React would put reconciliation on the critical path for
 * the 16.7 ms key-to-highlight budget.
 *
 * The target element is never touched: no class, no inline style, no
 * `focus()`. Decorating it fires the page's own hover and focus handlers, and
 * on a well-built site that means analytics events, prefetches and dropdowns
 * opening under a cursor that only moved.
 */

const RECT_BASE = [
  "position:fixed",
  "pointer-events:none",
  "box-sizing:border-box",
  "border-radius:2px",
  "will-change:transform,width,height"
].join(";")

export class Highlighter {
  private layer: HTMLElement
  private cursorBox: HTMLElement
  private frame = 0
  private lastCursor: Element | null = null
  private disposed = false

  constructor(parent: ParentNode) {
    const doc = parent.ownerDocument ?? document

    this.layer = doc.createElement("div")
    // The overlay contract — fixed, full-viewport, no pointer events, one level
    // below the panel — is a class in HUD_CSS, which the ghost trail wears too.
    // Stating it inline here kept the stacking level in two places.
    this.layer.className = "fl-layer"

    this.cursorBox = doc.createElement("div")
    this.cursorBox.setAttribute(
      "style",
      `${RECT_BASE};border:2px solid var(--fl-cursor);` +
        "background:color-mix(in srgb, var(--fl-cursor) 12%, transparent);" +
        "box-shadow:0 0 0 1px var(--fl-bg), 0 0 12px -2px var(--fl-cursor)"
    )
    this.cursorBox.style.display = "none"
    this.layer.appendChild(this.cursorBox)

    parent.appendChild(this.layer)

    this.onViewportChange = this.onViewportChange.bind(this)
    window.addEventListener("scroll", this.onViewportChange, {
      passive: true,
      capture: true
    })
    window.addEventListener("resize", this.onViewportChange, { passive: true })
  }

  update(cursor: Element | null): void {
    this.lastCursor = cursor
    this.schedule()
  }

  private onViewportChange(): void {
    this.schedule()
  }

  private schedule(): void {
    if (this.disposed || this.frame !== 0) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.paint()
    })
  }

  private paint(): void {
    if (this.disposed) return

    if (this.lastCursor && this.lastCursor.isConnected) {
      place(this.cursorBox, this.lastCursor.getBoundingClientRect())
    } else {
      this.cursorBox.style.display = "none"
    }
  }

  destroy(): void {
    this.disposed = true
    if (this.frame !== 0) cancelAnimationFrame(this.frame)
    window.removeEventListener("scroll", this.onViewportChange, true)
    window.removeEventListener("resize", this.onViewportChange)
    this.layer.remove()
  }
}

function place(box: HTMLElement, rect: DOMRect): void {
  if (rect.width === 0 && rect.height === 0) {
    box.style.display = "none"
    return
  }
  box.style.display = "block"
  box.style.left = `${rect.left}px`
  box.style.top = `${rect.top}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}

export type RevealPlan = "none" | "start" | "center"

const REVEAL_MARGIN = 80

/**
 * Whether and how to scroll to bring `rect` into view. Pure, so it can be
 * tested; `reveal` just applies the result.
 *
 * The tall case is the one that matters. A container taller than the viewport
 * can never be fully visible, so "is all of it on screen?" always answers no
 * and centering it scrolls to its *middle*. On Wikipedia the cursor once landed
 * on the article container, about 5,000 px tall, and revealing it jumped a
 * third of the way down the page. For anything that large the only sensible
 * question is whether its start is visible.
 *
 * `obstruction` is our own panel. Without it the answer is confidently wrong
 * for anything sitting behind it: "comfortably in view" and "covered by the
 * panel" were the same answer.
 *
 * Fully inside the band means no scroll, even when the element sits near the
 * band's edge. A previous REVEAL_MARGIN "scrolloff" treated a header link near
 * the top as needing `scrollIntoView`, which drove the page *down* — including
 * when the user pressed Up on the first row and the cursor did not move. Sticky
 * headers make that jump worse, because `scrollIntoView` aims at the in-flow
 * position rather than the pinned one.
 */
export function revealPlan(
  rect: Box,
  viewport: number,
  obstruction: Box | null = null
): RevealPlan {
  if (rect.width === 0 && rect.height === 0) return "none"

  const [top, bottom] = visibleBand(rect, viewport, obstruction)
  const band = bottom - top

  if (rect.height > band - REVEAL_MARGIN) {
    const startVisible = rect.top >= top && rect.top < bottom - REVEAL_MARGIN
    return startVisible ? "none" : "start"
  }

  // Fully visible in the band: leave the page alone.
  if (rect.top >= top && rect.bottom <= bottom) return "none"

  // `scrollIntoView` centers in the scrollport, not in the band, and with the
  // panel docked those are different places, because centering a covered
  // element puts it straight back behind the panel. "start" is the top of the
  // scrollport, which is inside the band whenever the band is the upper one,
  // and the panel is bottom-anchored.
  return band < viewport && top === 0 ? "start" : "center"
}

/**
 * Scrolls an element into view without stealing focus from the page.
 *
 * Instant, never smooth. Holding an arrow key queues one animation per row and
 * the list turns into a slow drift that never catches up with the cursor.
 */
export function reveal(el: Element, obstruction: Box | null = null): void {
  const plan = revealPlan(
    el.getBoundingClientRect(),
    window.innerHeight,
    obstruction
  )
  if (plan === "none") return

  // A fixed element does not move when the page scrolls, so scrolling to
  // uncover one changes nothing, and since the cursor keeps landing on it,
  // every keypress would jolt the page for no gain. Checked only once a scroll
  // is actually on the table, to keep the common path free.
  if (isViewportFixed(el)) return

  el.scrollIntoView({ block: plan, inline: "nearest", behavior: "auto" })
}

/** True when scrolling the page cannot move `el`. */
function isViewportFixed(el: Element): boolean {
  const view = el.ownerDocument.defaultView
  if (!view?.getComputedStyle) return false
  for (let node: Element | null = el; node; node = node.parentElement) {
    const position = view.getComputedStyle(node).position
    // Sticky pins the same way fixed does once it is stuck: scrollIntoView
    // aims at the in-flow position and jolts the page without uncovering it.
    if (position === "fixed" || position === "sticky") return true
  }
  return false
}
