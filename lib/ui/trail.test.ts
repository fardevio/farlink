import { HUD_CSS } from "~/lib/ui/hud-css"
import {
  ghostCount,
  ghostOpacity,
  isNegligible,
  leaveTrail,
  TRAIL_MS,
  trailBoxes
} from "~/lib/ui/trail"

/**
 * The trail is decoration, so this covers what was actually wrong at some point
 * and nothing else. Twenty-two cases here once described a fifth of a second of
 * animation, most of them restating geometry the code makes obvious.
 */

const from = { left: 20, top: 300, width: 800, height: 480 }
const to = { left: 460, top: 300, width: 800, height: 480 }

describe("where the copies go", () => {
  it("spaces them from the start, stopping short of the end", () => {
    // A copy on top of the real panel would just look like a double border.
    expect(trailBoxes(from, to, 4).map((b) => b.left)).toEqual([
      20, 130, 240, 350
    ])
  })

  it("draws a real move and skips one too small to see", () => {
    expect(isNegligible(from, { ...from, left: from.left + 3 })).toBe(true)
    expect(isNegligible(from, to)).toBe(false)
  })

  it("holds the spacing constant, on the diagonal as well", () => {
    // Constant spacing is why the count is derived at all: a hop to the next
    // corner and a full sweep should smear at the same density.
    for (const d of [400, 600, 800]) {
      const count = ghostCount(from, { ...from, left: from.left + d })
      expect(d / count, `${d}px apart`).toBeGreaterThan(30)
      expect(d / count, `${d}px apart`).toBeLessThan(60)
    }
    const across = ghostCount(from, { ...from, left: from.left + 300 })
    const diagonal = ghostCount(from, {
      ...from,
      left: from.left + 300,
      top: from.top + 300
    })
    expect(diagonal, "measured the diagonal").toBeGreaterThan(across)
  })

  it("clamps both ends rather than stacking or flooding", () => {
    expect(ghostCount(from, { ...from, left: from.left + 10 })).toBe(6)
    expect(ghostCount(from, { ...from, left: from.left + 100000 })).toBe(20)
  })
})

describe("the opacity ramp", () => {
  it("keeps the far end faint at any count, so the smear cannot fill in", () => {
    // Without the ramp the copies accumulate into a solid slab. It also carries
    // the clearing order now that nothing is staggered: the faintest cross out
    // of sight first, so the trail still empties from its old end.
    for (const count of [6, 13, 20]) {
      expect(ghostOpacity(0, count), `${count} copies`).toBe(0.25)
      expect(ghostOpacity(count - 1, count), `${count} copies`).toBe(1)
    }
  })
})

describe("leaveTrail", () => {
  const draw = (a = from, b = to) => {
    const parent = document.createElement("div")
    leaveTrail(parent, a, b)
    return parent
  }
  const layerOf = (p: HTMLElement) => p.querySelector(".fl-trail")

  it("draws nothing at all for a negligible move", () => {
    expect(layerOf(draw(from, { ...from, left: from.left + 3 }))).toBeNull()
  })

  it("keeps only one trail on screen at a time", () => {
    // Nothing guards key auto-repeat, and a held size key repeats far faster
    // than a trail clears, so without this each repeat stacked another twenty
    // animating copies over the page.
    const parent = draw()
    leaveTrail(parent, from, { ...to, left: to.left + 200 })
    leaveTrail(parent, from, { ...to, left: to.left + 400 })
    expect(parent.querySelectorAll(".fl-trail")).toHaveLength(1)
  })

  it("animates the layer and nothing else", () => {
    // The performance argument. An animated opacity is composited, so a copy
    // that animates is a panel-sized layer: twenty of them, ~200 MB of texture
    // at full size on a 2x display, to show a 44px sliver of each.
    const parent = draw()
    const style = layerOf(parent)!.getAttribute("style") ?? ""
    expect(style).toMatch(new RegExp(`animation-duration:\\s*${TRAIL_MS}ms`))

    const ghostRule = /\.fl-ghost\s*\{[^}]*\}/.exec(HUD_CSS)
    expect(ghostRule, ".fl-ghost rule not found").toBeTruthy()
    expect(ghostRule![0]).not.toMatch(/animation/)
    for (const ghost of parent.querySelectorAll(".fl-ghost")) {
      expect(ghost.getAttribute("style")).not.toMatch(/animation/)
    }
  })

  it("clears the layer after the trail has run", () => {
    vi.useFakeTimers()
    try {
      const parent = draw()
      expect(layerOf(parent)).not.toBeNull()
      vi.advanceTimersByTime(TRAIL_MS + 40)
      expect(layerOf(parent)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
