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
