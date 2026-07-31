/**
 * What the user can actually see, given that our own panel is covering part of
 * it.
 *
 * The panel is a fixed overlay taking up to 62vw × 62vh, and every "is this on
 * screen?" test used to ignore it. Four separate symptoms turned out to be that
 * one omission, so the idea lives in one place: the visible region is the
 * viewport minus the panel.
 *
 * Pure geometry, no DOM: shared by the UI layer and the state machine, and
 * testable without layout.
 */

export interface Box {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

/**
 * A band narrower than this is not worth scrolling into — the element would
 * arrive somewhere too cramped to read, having moved the page for nothing. The
 * Miller view, which covers the page deliberately, always lands here and so is
 * treated as no obstruction at all.
 */
const MIN_BAND = 140

/**
 * The vertical band, in viewport coordinates, where `rect` can be seen.
 *
 * Deliberately an intersection test rather than a flat bottom inset. The panel
 * is at most 62vw wide, so on a wide screen the right third of the page is
 * never covered; treating the panel as a uniform inset would scroll the entire
 * right-hand column of a two-column layout for no reason at all.
 */
export function visibleBand(
  rect: Box,
  viewportHeight: number,
  obstruction: Box | null
): [number, number] {
  const full: [number, number] = [0, viewportHeight]
  if (!obstruction) return full
  if (obstruction.width === 0 || obstruction.height === 0) return full

  // Beside the panel rather than behind it: nothing to correct for.
  if (rect.right <= obstruction.left || rect.left >= obstruction.right) {
    return full
  }

  const above = Math.max(0, Math.min(obstruction.top, viewportHeight))
  const below = Math.max(0, viewportHeight - Math.max(0, obstruction.bottom))
  if (above < MIN_BAND && below < MIN_BAND) return full

  return above >= below ? [0, above] : [viewportHeight - below, viewportHeight]
}

/** Whether any part of `rect` is on screen and not hidden behind the panel. */
export function isVisible(
  rect: Box,
  viewport: { width: number; height: number },
  obstruction: Box | null
): boolean {
  if (rect.width === 0 && rect.height === 0) return false
  if (rect.right <= 0 || rect.left >= viewport.width) return false

  const [top, bottom] = visibleBand(rect, viewport.height, obstruction)
  return rect.bottom > top && rect.top < bottom
}
