import { visibilityOf } from "~/lib/dom/visibility"
import { html, testOptions } from "~/test/harness"

/** The single top-level element of a markup fragment. */
function one(markup: string): Element {
  return html(markup).firstElementChild!
}

const seen = (el: Element) => visibilityOf(el, testOptions)

describe("visibilityOf: hidden", () => {
  it("hides display:none", () => {
    expect(seen(one('<div data-style="display: none">x</div>'))).toBe("hidden")
  })

  it("hides visibility:hidden and visibility:collapse", () => {
    expect(seen(one('<div data-style="visibility: hidden">x</div>'))).toBe(
      "hidden"
    )
    expect(seen(one('<div data-style="visibility: collapse">x</div>'))).toBe(
      "hidden"
    )
  })

  it("hides aria-hidden=true", () => {
    expect(seen(one('<div aria-hidden="true">x</div>'))).toBe("hidden")
    // …and only when it is actually true.
    expect(seen(one('<div aria-hidden="false">x</div>'))).toBe("visible")
  })

  it("hides the hidden attribute", () => {
    expect(seen(one("<div hidden>x</div>"))).toBe("hidden")
  })

  it("hides an inert element", () => {
    expect(seen(one("<div inert>x</div>"))).toBe("hidden")
  })

  it("hides everything under an inert ancestor", () => {
    const root = html(
      '<div inert><section><button id="deep">Go</button></section></div>'
    )
    expect(seen(root.querySelector("#deep")!)).toBe("hidden")
    expect(seen(root.querySelector("section")!)).toBe("hidden")
  })

  it("hides opacity:0", () => {
    expect(seen(one('<div data-style="opacity: 0">x</div>'))).toBe("hidden")
  })

  it("hides an empty zero-sized box", () => {
    expect(seen(one('<div data-rect="0,0,0,0"></div>'))).toBe("hidden")
  })
})

describe("visibilityOf: transparent", () => {
  it("calls display:contents transparent, never hidden", () => {
    const el = one('<div data-style="display: contents">x</div>')
    expect(seen(el)).toBe("transparent")
    expect(seen(el)).not.toBe("hidden")
  })

  it("calls display:contents transparent even with a zero rect", () => {
    // `display: contents` boxes have no rect of their own by definition.
    const el = one(
      '<div data-rect="0,0,0,0" data-style="display: contents">x</div>'
    )
    expect(seen(el)).toBe("transparent")
  })
})

describe("visibilityOf: screen-reader-only", () => {
  it("detects the clip: rect(0,0,0,0) recipe", () => {
    const el = one(
      '<span data-rect="0,0,1,1" data-style="position: absolute; ' +
        'clip: rect(0, 0, 0, 0)">Skip to content</span>'
    )
    expect(seen(el)).toBe("screen-reader-only")
  })

  it("detects the absolute + 1px + overflow:hidden recipe", () => {
    const el = one(
      '<span data-rect="0,0,1,1" data-style="position: absolute; ' +
        'overflow: hidden">Skip to content</span>'
    )
    expect(seen(el)).toBe("screen-reader-only")
  })

  it("detects the fixed variant of the 1px recipe", () => {
    const el = one(
      '<span data-rect="0,0,1,1" data-style="position: fixed; ' +
        'overflow: hidden">Menu</span>'
    )
    expect(seen(el)).toBe("screen-reader-only")
  })

  it("detects the clip-path inset recipes", () => {
    for (const clip of ["inset(50%)", "inset(100%)"]) {
      const el = one(
        `<span data-rect="0,0,1,1" data-style="clip-path: ${clip}">Hi</span>`
      )
      expect(seen(el)).toBe("screen-reader-only")
    }
  })

  it("does not mistake a partial clip for the recipe", () => {
    // Both patterns used to read only the first value, so a crop that merely
    // started at the top edge hid a visible region and every link inside it.
    for (const style of [
      "position: absolute; clip: rect(0px, 500px, 300px, 0px)",
      "clip-path: inset(50% 0 0 0)"
    ]) {
      const el = one(
        `<div data-rect="0,0,500,300" data-style="${style}">Gallery</div>`
      )
      expect(seen(el), style).toBe("visible")
    }
  })

  it("treats a zero-rect element carrying text as name material", () => {
    // Not "hidden": an unfingerprinted sr-only variant is far likelier than a
    // real collapsed section, and its text still names an ancestor.
    const el = one('<span data-rect="0,0,0,0">Unread messages</span>')
    expect(seen(el)).toBe("screen-reader-only")
    expect(seen(el)).not.toBe("visible")
  })

  it("does not call a plain 1px box screen-reader-only", () => {
    // Position alone is not the recipe; overflow and clip matter.
    const el = one('<span data-rect="0,0,1,1">Hi</span>')
    expect(seen(el)).toBe("visible")
  })
})

describe("visibilityOf: visible", () => {
  it("calls an ordinary laid-out element visible", () => {
    expect(seen(one('<div data-rect="0,0,800,40">Hello</div>'))).toBe("visible")
  })

  it("keeps legitimately boxless elements", () => {
    const select = one(
      '<select data-rect="0,0,0,0"><option data-rect="0,0,0,0">A</option>' +
        "</select>"
    )
    expect(seen(select.querySelector("option")!)).toBe("visible")
  })
})
