import type { LevelItem } from "~/lib/nav/session"

/**
 * The list of rows, rendered through a fixed pool of row elements.
 *
 * Pooled, not rebuilt. It repaints on every keypress and can hold every link on
 * the page: 1,829 on Wikipedia's New York University article. Creating even
 * the visible 200 of those per keystroke put element construction on the
 * 16.7 ms key-to-highlight path; a pool of the rows that actually fit, refilled
 * in place, does not.
 *
 * SECURITY: every string here originates from the page and reaches the DOM
 * through `textContent`. There is no `innerHTML` in this file and there must
 * never be one, because accessible names are attacker-controlled on a hostile
 * page.
 */

interface Row {
  el: HTMLElement
  name: HTMLElement
  url: HTMLElement
}

export interface ColumnOptions {
  /** Show the shortened address after the name. */
  showUrl?: boolean
}

export class Column {
  readonly el: HTMLElement
  private rows: Row[] = []
  private empty: HTMLElement
  private showUrl: boolean
  private busy = false
  /** Index of the first rendered row. Kept across renders; see `windowStart`. */
  private offset = 0

  constructor(className: string, options: ColumnOptions = {}) {
    this.el = document.createElement("div")
    this.el.className = className
    this.showUrl = options.showUrl ?? false

    this.empty = document.createElement("span")
    this.empty.className = "fl-col-empty"
    this.empty.textContent = "—"
    this.el.appendChild(this.empty)
  }

  render(
    items: LevelItem[],
    activeIndex: number,
    maxRows: number,
    state: { busy?: boolean } = {}
  ): void {
    // While a navigation is in flight the other rows stop competing for
    // attention: the one thing happening is happening to the cursor row.
    this.el.toggleAttribute("data-busy", state.busy === true)
    this.busy = state.busy === true
    this.empty.hidden = items.length > 0
    if (items.length === 0) {
      for (const row of this.rows) row.el.hidden = true
      return
    }

    // A window around the cursor, so a list of two thousand does not become two
    // thousand rows. `maxRows` comes from the caller rather than from this
    // element's own height: the panel is sized by its content, so measuring here
    // is circular: no rows means no height means room for one row, which is
    // where it stays.
    const start = this.windowStart(items.length, activeIndex, maxRows)
    const visible = items.slice(start, start + maxRows)

    while (this.rows.length < visible.length) this.rows.push(this.makeRow())

    this.rows.forEach((row, index) => {
      const item = visible[index]
      if (!item) {
        row.el.hidden = true
        return
      }
      row.el.hidden = false
      this.fill(row, item, start + index === activeIndex)
    })
  }

  private windowStart(
    total: number,
    activeIndex: number,
    maxRows: number
  ): number {
    this.offset = windowStart(this.offset, total, activeIndex, maxRows)
    return this.offset
  }

  private makeRow(): Row {
    const el = document.createElement("div")
    el.className = "fl-row"
    const name = span("fl-name")
    const url = span("fl-url")
    el.append(name, url)
    this.el.appendChild(el)
    return { el, name, url }
  }

  private fill(row: Row, item: LevelItem, isCursor: boolean): void {
    row.el.classList.toggle("fl-row-cursor", isCursor)
    row.el.classList.toggle("fl-row-uncertain", item.uncertain)
    row.el.classList.toggle("fl-row-divider", item.divider === true)
    row.el.classList.toggle("fl-row-openable", item.openable === true)

    fillMarked(row.name, truncate(item.name, 90), item.match)

    // The address slot carries the progress word, so it lands on the row the
    // user is looking at instead of at the foot of the panel.
    if (isCursor && this.busy) {
      row.url.textContent = "Opening…"
      row.url.classList.add("fl-url-busy")
      return
    }
    row.url.classList.remove("fl-url-busy")
    if (this.showUrl) fillMarked(row.url, item.url ?? "", item.urlMatch)
  }
}

/**
 * Rows to keep between the cursor and the edge before the list scrolls.
 *
 * The equivalent of vim's `scrolloff`: you want to see what is coming, but not
 * at the cost of the list moving every time you do.
 */
const MARGIN = 3

/**
 * Where the visible window starts, given where it started last time.
 *
 * Deliberately *not* centred on the cursor. Centring keeps the highlight in one
 * place and slides every row past it, so pressing Down makes the whole list jump
 * upward while the thing you are pointing at stays put. The cursor stops
 * feeling like the thing that moves, which inverts what the keypress means. A
 * stable window that the cursor travels inside, scrolling only when it reaches a
 * margin from the edge, is what a file manager does and what an editor does.
 *
 * Pure and exported so this is testable: it is stateful behaviour across
 * renders, which is exactly the kind that goes subtly wrong.
 */
export function windowStart(
  previous: number,
  total: number,
  activeIndex: number,
  maxRows: number
): number {
  const last = Math.max(0, total - maxRows)
  if (total <= maxRows) return 0

  // Nothing selected, or the list changed under the window: show from the top
  // rather than from wherever the old window happened to be.
  if (activeIndex < 0) return Math.min(previous, last)

  const margin = Math.min(MARGIN, Math.floor((maxRows - 1) / 2))
  let start = Math.min(previous, last)

  if (activeIndex < start + margin) start = activeIndex - margin
  else if (activeIndex > start + maxRows - 1 - margin) {
    start = activeIndex - maxRows + 1 + margin
  }

  return Math.max(0, Math.min(start, last))
}

function span(className: string): HTMLElement {
  const el = document.createElement("span")
  el.className = className
  return el
}

/**
 * Text with its matched characters marked.
 *
 * Built out of element nodes and `textContent`, never markup, because both
 * the name
 * and the URL are page-controlled. `fuzzyMatch` already computes these
 * positions and nothing used them, which made a fuzzy match look arbitrary.
 */
export function fillMarked(
  target: HTMLElement,
  text: string,
  match: number[]
): void {
  const hits = new Set(match.filter((index) => index < text.length))

  if (hits.size === 0) {
    target.textContent = text
    return
  }

  target.replaceChildren()
  let run = ""
  let runHit = hits.has(0)
  const flush = () => {
    if (!run) return
    if (runHit) {
      const mark = span("fl-hit")
      mark.textContent = run
      target.appendChild(mark)
    } else {
      target.appendChild(document.createTextNode(run))
    }
    run = ""
  }
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i)
    if (hit !== runHit) {
      flush()
      runHit = hit
    }
    run += text[i]
  }
  flush()
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}
