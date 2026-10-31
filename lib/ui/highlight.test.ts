import { Highlighter, revealPlan } from "~/lib/ui/highlight"
import { HUD_CSS } from "~/lib/ui/hud-css"
import { rect } from "~/test/harness"

const VIEWPORT = 800
/** The panel as shipped: bottom-left, 640 × 430 with a 20px margin. */
const PANEL = rect(20, 350, 640, 430)

describe("revealPlan", () => {
  it("does not scroll for something already comfortably in view", () => {
    expect(revealPlan(rect(0, 200, 900, 100), VIEWPORT)).toBe("none")
  })

  it("leaves a header link at the top of the viewport alone", () => {
    // The bug this exists for: REVEAL_MARGIN treated top < 80 as "above" the
    // comfortable band and returned "center"/"start", so revealing the first
    // row (Home in a sticky header) scrolled the page *down* on Up.
    expect(revealPlan(rect(20, 12, 120, 36), VIEWPORT)).toBe("none")
    expect(revealPlan(rect(20, 12, 120, 36), VIEWPORT, PANEL)).toBe("none")
  })

  it("centers a small element that is off screen", () => {
    expect(revealPlan(rect(0, 2000, 900, 100), VIEWPORT)).toBe("center")
    expect(revealPlan(rect(0, -300, 900, 100), VIEWPORT)).toBe("center")
  })

  it("leaves a page-height container alone when its top is visible", () => {
    // Centring a 5,000px article container scrolled a third down the page.
    expect(revealPlan(rect(0, 90, 900, 5000), VIEWPORT)).toBe("none")
  })

  it("scrolls a tall container to its start when the start is off screen", () => {
    expect(revealPlan(rect(0, 1200, 900, 5000), VIEWPORT)).toBe("start")
  })

  it("ignores a zero-size rect", () => {
    expect(revealPlan(rect(0, 0, 0, 0), VIEWPORT)).toBe("none")
  })
})

describe("revealPlan with the panel in the way", () => {
  it("scrolls for something the panel is covering", () => {
    const covered = rect(100, 600, 400, 20)
    // Comfortably in view by the plain test, and completely invisible.
    expect(revealPlan(covered, VIEWPORT)).toBe("none")
    expect(revealPlan(covered, VIEWPORT, PANEL)).toBe("start")
  })

  it("scrolls to the bottom when the panel is docked at the top", () => {
    // Centering in the scrollport put a covered link at y≈400, still behind a
    // top-docked panel reaching y=450, so every arrow press revealed it into
    // the same hiding place.
    const topPanel = rect(20, 20, 640, 430)
    const covered = rect(100, 200, 400, 20)
    expect(revealPlan(covered, VIEWPORT, topPanel)).toBe("end")
  })

  it("leaves an element beside the panel alone", () => {
    expect(revealPlan(rect(900, 600, 400, 20), VIEWPORT, PANEL)).toBe("none")
  })

  it("centers rather than topping out when nothing is in the way", () => {
    expect(revealPlan(rect(900, 2000, 400, 20), VIEWPORT, PANEL)).toBe("center")
  })
})

describe("the cursor layer", () => {
  it("wears a class the stylesheet actually styles", () => {
    // These declarations used to be inline on the element, which duplicated
    // .fl-trail. Sharing one class removes the duplication but adds a way to
    // fail silently: if the class and the rule drift apart the overlay loses
    // position: fixed and pointer-events: none and becomes a static box
    // swallowing every click on the page, with nothing visible to say so.
    const host = document.createElement("div")
    const highlighter = new Highlighter(host)
    try {
      const names = (host.firstElementChild as HTMLElement).className
        .split(/\s+/)
        .filter(Boolean)
      expect(names.length, "the layer carries no class").toBeGreaterThan(0)
      const declared = names
        .map(
          (name) =>
            new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(HUD_CSS)?.[1] ?? ""
        )
        .join(";")
      expect(declared).toContain("position: fixed")
      expect(declared).toContain("pointer-events: none")
      expect(declared).toContain("z-index")
    } finally {
      highlighter.destroy()
    }
  })
})
