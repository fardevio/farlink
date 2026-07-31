/**
 * The ghost trail left behind when the panel changes corner.
 *
 * An artifact rather than an animation: the panel does not tween, it is simply
 * in the other corner on the next frame, and what is left behind is a row of
 * copies of its outline. They carry a header strip so they read as windows.
 *
 * The copies do not animate. The layer holding them fades as one, on `steps()`
 * timing, so the whole smear drops through a few discrete levels rather than
 * easing out — an eased fade looks like modern UI, a stepped one looks like a
 * screen that has not caught up. The smear still appears to empty from its old
 * end because `ghostOpacity` deals the older copies a fainter start, and those
 * cross out of sight first.
 *
 * Animating the layer rather than each copy is also the whole performance story;
 * see the `.fl-trail` rule in hud-css.ts. Each copy is one element placed with
 * `translate3d` and given its header by a pseudo-element, so drawing the smear
 * costs no layout and half the nodes it reads as.
 */

/** The four fields a copy needs. A `DOMRect` satisfies it, which is what the
 *  only caller passes. Deliberately not `~/lib/occlusion`'s `Box`: nothing here
 *  wants the edges, and no copy is ever handed to that module. */
export interface GhostBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * How long the smear takes to clear, in ms.
 *
 * Written into the layer's own `animation-duration`, so this module owns the
 * number outright. The stylesheet names the keyframes and the step timing and
 * carries no duration, which is why there is nothing there to drift from this.
 */
export const TRAIL_MS = 300

/** Roughly how far apart copies sit along the path, in px. */
const SPACING_PX = 44

const MIN_GHOSTS = 6
const MAX_GHOSTS = 20

/**
 * How many copies a move of this length deserves.
 *
 * Spacing is constant through the middle of the range, so a hop to the
 * neighbouring corner and a full diagonal smear at the same density. Both ends
 * are clamped rather than spaced: two copies do not read as a smear at all, and
 * past the cap each additional copy is almost entirely hidden behind the next:
 * at this spacing a copy shows about 7% of itself. Copies are cheap now that
 * only the layer animates, so the cap is about diminishing looks, not cost.
 */
export function ghostCount(from: GhostBox, to: GhostBox): number {
  const distance = Math.hypot(to.left - from.left, to.top - from.top)
  const wanted = Math.round(distance / SPACING_PX)
  return Math.min(MAX_GHOSTS, Math.max(MIN_GHOSTS, wanted))
}

/** How visible the oldest copy is, against 1 for the newest. */
const FAINTEST = 0.25

/**
 * How opaque copy `index` of `count` is, oldest faintest.
 *
 * Density is why this exists. The copies are wider than they are far apart, so
 * every point on the path is covered by most of them at once; at a flat opacity
 * they accumulate into a solid slab and the reading of separate windows is lost.
 * Ramping along the path keeps the smear pointing at where the panel went, and
 * keeps raising the count from filling it in.
 *
 * It also carries the clearing order, now that nothing is staggered. The whole
 * layer fades as one, and the copies already near the floor cross out of sight
 * first, so the smear still empties from its old end.
 */
export function ghostOpacity(index: number, count: number): number {
  if (count < 2) return 1
  return FAINTEST + (1 - FAINTEST) * (index / (count - 1))
}

/**
 * Positions for the copies, from `from` toward `to`, excluding `to` itself —
 * the real panel is already there and a copy on top of it would just look like
 * a double border.
 */
export function trailBoxes(
  from: GhostBox,
  to: GhostBox,
  count: number
): GhostBox[] {
  const boxes: GhostBox[] = []
  for (let i = 0; i < count; i++) {
    const t = i / count
    boxes.push({
      left: from.left + (to.left - from.left) * t,
      top: from.top + (to.top - from.top) * t,
      width: from.width + (to.width - from.width) * t,
      height: from.height + (to.height - from.height) * t
    })
  }
  return boxes
}

/** True when the move is too small to be worth drawing. */
export function isNegligible(from: GhostBox, to: GhostBox): boolean {
  return Math.abs(to.left - from.left) < 8 && Math.abs(to.top - from.top) < 8
}

/**
 * Draws the trail into `parent` and cleans up after itself. The copies are
 * plain bordered boxes rather than clones: cloning would put several hundred
 * rows of page-controlled text in the DOM for a fifth of a second, and at this
 * speed an outline reads the same.
 */
export function leaveTrail(
  parent: ParentNode,
  from: GhostBox,
  to: GhostBox
): void {
  if (isNegligible(from, to)) return

  const doc = parent.ownerDocument ?? document

  // One trail at a time. Nothing guards key auto-repeat, and a held size or
  // corner key repeats far faster than a trail clears, so each repeat used to
  // leave another twenty animating copies over the page. Dropping the previous
  // layer is enough on its own: its pending timer then fires against a detached
  // node and removes nothing.
  parent.querySelectorAll(".fl-trail").forEach((stale) => stale.remove())

  const layer = doc.createElement("div")
  layer.className = "fl-layer fl-trail"

  const count = ghostCount(from, to)

  // Oldest first, so the faintest copy is furthest from where the panel ended
  // up and the smear reads as chasing it.
  for (const [index, box] of trailBoxes(from, to, count).entries()) {
    const x = Math.round(box.left)
    const y = Math.round(box.top)
    const ghost = doc.createElement("div")
    ghost.className = "fl-ghost"
    // One string, parsed once, instead of a property set per declaration; and
    // `translate3d` rather than `left`/`top`, so placing a copy is a compositor
    // job and costs no layout. Nothing here animates: a copy is a static fill
    // at its place on the ramp, and the layer above does the clearing.
    ghost.style.cssText = [
      `transform:translate3d(${x}px,${y}px,0)`,
      `width:${Math.round(box.width)}px`,
      `height:${Math.round(box.height)}px`,
      `opacity:${ghostOpacity(index, count).toFixed(3)}`
    ].join(";")
    layer.appendChild(ghost)
  }

  // The fade goes on the layer, not on each copy. An animated `opacity` is
  // composited, so animating every copy asked for one panel-sized layer each:
  // twenty of them, ~200 MB of texture at full size on a 2x display, to show a
  // 44px sliver of each. One animated layer costs one texture whatever the copy
  // count, and the copies paint into it once and never repaint.
  layer.style.animationDuration = `${TRAIL_MS}ms`

  parent.appendChild(layer)
  doc.defaultView?.setTimeout(() => layer.remove(), TRAIL_MS + 40)
}
