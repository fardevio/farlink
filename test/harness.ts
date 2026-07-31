import type { VisibilityOptions } from "~/lib/dom/visibility"
import type { SessionHost } from "~/lib/nav/session"

/**
 * happy-dom does not lay out, so every `getBoundingClientRect()` returns
 * zeroes and every geometric heuristic would see an empty page. Tests declare
 * geometry explicitly with `data-rect="x,y,w,h"` and the extractor reads it
 * through the injected `rectOf`, which is the same seam production uses.
 */

export function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({})
  } as DOMRect
}

const DEFAULT_RECT = rect(0, 0, 800, 40)

export function rectOf(el: Element): DOMRect {
  const declared = el.getAttribute?.("data-rect")
  if (!declared) return DEFAULT_RECT
  const [x, y, w, h] = declared.split(",").map(Number)
  return rect(x ?? 0, y ?? 0, w ?? 0, h ?? 0)
}

/**
 * A minimal computed-style stand-in. happy-dom's own getComputedStyle does not
 * resolve much, and the extractor only reads a handful of properties.
 */
export function styleOf(el: Element): CSSStyleDeclaration {
  const inline = (el as HTMLElement).style
  const hiddenAttr = el.getAttribute?.("data-style") ?? ""
  const read = (prop: string, fallback: string) => {
    const match = hiddenAttr.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`))
    if (match) return match[1]!.trim()
    const value = inline?.getPropertyValue?.(prop)
    return value || fallback
  }
  return {
    display: read("display", "block"),
    visibility: read("visibility", "visible"),
    opacity: read("opacity", "1"),
    position: read("position", "static"),
    overflow: read("overflow", "visible"),
    clip: read("clip", "auto"),
    clipPath: read("clip-path", "none")
  } as unknown as CSSStyleDeclaration
}

export const testOptions: VisibilityOptions = { rectOf, styleOf }

/** Parses an HTML string into a detached container element. */
export function html(markup: string): HTMLElement {
  const container = document.createElement("div")
  container.innerHTML = markup.trim()
  document.body.replaceChildren(container)
  return container
}

/**
 * A recording `SessionHost`.
 *
 * `opened` records what the session *asked* for, and the reply says everything
 * succeeded — so a test that wants a refusal builds its own `openUrls`. Shared
 * because session.test.ts and keymap.test.ts had byte-identical copies of this,
 * and the day `openUrls` gained a return value both had to change together.
 */
export function recordingHost(): {
  host: SessionHost
  opened: { url: string; background: boolean }[]
  revealed: Element[]
  scroll: { at: number; restored: boolean }
} {
  const opened: { url: string; background: boolean }[] = []
  const revealed: Element[] = []
  const scroll = { at: 0, restored: false }
  const host: SessionHost = {
    openUrls: (urls, background) => {
      urls.forEach((url) => opened.push({ url, background }))
      return Promise.resolve({
        results: urls.map((url) => ({ url, opened: true as const }))
      })
    },
    reveal: (el) => revealed.push(el),
    scrollTop: () => scroll.at,
    restoreScroll: (top) => {
      scroll.at = top
      scroll.restored = true
    },
    extractOptions: testOptions
  }
  return { host, opened, revealed, scroll }
}

/**
 * Builds a vertical list of `count` items sharing a left edge and pitch —
 * the single-column-list class the research validated against.
 */
export function verticalList(count: number, itemHtml: (i: number) => string) {
  const rows = Array.from(
    { length: count },
    (_, i) =>
      `<div class="row" data-rect="0,${i * 60},700,50">${itemHtml(i)}</div>`
  ).join("")
  return `<div class="list" data-rect="0,0,700,${count * 60}">${rows}</div>`
}
