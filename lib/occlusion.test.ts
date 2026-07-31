import { isVisible, visibleBand } from "~/lib/occlusion"
import { rect } from "~/test/harness"

const VIEWPORT = { width: 1440, height: 900 }

/** The real panel: bottom-left, 840 wide, 430 tall, 20px margins. */
const PANEL = rect(20, 450, 840, 430)

describe("visibleBand", () => {
  it("is the whole viewport when nothing is in the way", () => {
    expect(visibleBand(rect(0, 100, 400, 20), 900, null)).toEqual([0, 900])
  })

  it("is the whole viewport for an element beside the panel", () => {
    // The panel is 840 of 1440 px wide, so the right-hand column of a
    // two-column page is never covered. Treating the panel as a flat bottom
    // inset would scroll for every one of those links for no reason.
    const beside = rect(900, 700, 400, 20)
    expect(visibleBand(beside, 900, PANEL)).toEqual([0, 900])
  })

  it("stops at the panel's top edge for an element behind it", () => {
    const behind = rect(100, 700, 400, 20)
    expect(visibleBand(behind, 900, PANEL)).toEqual([0, 450])
  })

  it("picks the larger band when the panel is anchored at the top", () => {
    const topPanel = rect(20, 0, 840, 300)
    expect(visibleBand(rect(100, 400, 400, 20), 900, topPanel)).toEqual([
      300, 900
    ])
  })

  it("gives up when the panel leaves no usable band", () => {
    // The Miller view covers the page deliberately. Scrolling cannot uncover
    // anything, so pretending otherwise would only thrash the page.
    const fullscreen = rect(24, 16, 1392, 860)
    expect(visibleBand(rect(100, 400, 400, 20), 900, fullscreen)).toEqual([
      0, 900
    ])
  })
})

describe("isVisible", () => {
  it("rejects an element hidden behind the panel", () => {
    expect(isVisible(rect(100, 700, 400, 20), VIEWPORT, PANEL)).toBe(false)
    // ...which the plain viewport test called visible, because it is.
    expect(isVisible(rect(100, 700, 400, 20), VIEWPORT, null)).toBe(true)
  })

  it("accepts an element beside the panel at the same height", () => {
    expect(isVisible(rect(900, 700, 400, 20), VIEWPORT, PANEL)).toBe(true)
  })

  it("accepts an element above the panel", () => {
    expect(isVisible(rect(100, 200, 400, 20), VIEWPORT, PANEL)).toBe(true)
  })

  it("accepts an element straddling the panel's top edge", () => {
    expect(isVisible(rect(100, 430, 400, 40), VIEWPORT, PANEL)).toBe(true)
  })

  it("rejects anything off screen or with no box", () => {
    expect(isVisible(rect(0, -400, 400, 20), VIEWPORT, PANEL)).toBe(false)
    expect(isVisible(rect(0, 2000, 400, 20), VIEWPORT, PANEL)).toBe(false)
    expect(isVisible(rect(0, 0, 0, 0), VIEWPORT, null)).toBe(false)
  })
})
