import { accessibleName, fallbackDescription } from "~/lib/dom/accname"
import { html } from "~/test/harness"

/**
 * happy-dom 15 returns the literal string "undefined" from `innerText` for any
 * element with an SVG child — it concatenates `SVGElement.innerText`, which
 * does not exist. Browsers return "" there, because `<svg><title>` is not
 * rendered text. Tests that depend on falling *through* text content pin the
 * browser-accurate value on the instance.
 */
function pinInnerText(el: Element, value: string): void {
  Object.defineProperty(el, "innerText", { value, configurable: true })
}

/** The single top-level element of a markup fragment. */
function one(markup: string): Element {
  return html(markup).firstElementChild!
}

describe("accessibleName precedence", () => {
  it("puts aria-labelledby ahead of aria-label", () => {
    const root = html(
      '<div><span id="ref">From labelledby</span>' +
        '<button aria-labelledby="ref" aria-label="From label" ' +
        'title="From title">From text</button></div>'
    )
    expect(accessibleName(root.querySelector("button")!)).toBe(
      "From labelledby"
    )
  })

  it("joins several aria-labelledby targets in order", () => {
    const root = html(
      '<div><span id="a">Delete</span><span id="b">Ada Lovelace</span>' +
        '<button aria-labelledby="a b">x</button></div>'
    )
    expect(accessibleName(root.querySelector("button")!)).toBe(
      "Delete Ada Lovelace"
    )
  })

  it("computes a name for the referenced node rather than reading its text", () => {
    // AccName step 2B is a full name computation on the target. This read
    // textContent, so a referenced node whose own name comes from aria-label or
    // a nested <img alt> resolved to "". That did not render as "(unnamed
    // link)": linkTargets drops empty-named links, so the link disappeared from
    // the index altogether — and icon links labelled this way are everywhere.
    const labelled = html(
      '<div><a href="/p" aria-labelledby="t">' +
        '</a><span id="t" aria-label="Product 42"></span></div>'
    )
    expect(accessibleName(labelled.querySelector("a")!)).toBe("Product 42")

    const viaImage = html(
      '<div><a href="/p" aria-labelledby="t2"></a>' +
        '<span id="t2"><img src="x" alt="Basket"></span></div>'
    )
    expect(accessibleName(viaImage.querySelector("a")!)).toBe("Basket")
  })

  it("includes a referenced label that is visually hidden", () => {
    // The commonest shape of all: a .sr-only span naming an icon control. The
    // element's own name prefers innerText so CSS-hidden subtrees are excluded,
    // but a *referenced* label is hidden on purpose and AccName counts it.
    const root = html(
      '<div><a href="/x" aria-labelledby="lbl"></a>' +
        '<span id="lbl" data-style="display: none">Open settings</span></div>'
    )
    expect(accessibleName(root.querySelector("a")!)).toBe("Open settings")
  })

  it("does not follow aria-labelledby recursively", () => {
    // Two elements naming each other must terminate. The spec forbids
    // recursing through references, so the inner one contributes its text.
    const root = html(
      '<div><button id="one" aria-labelledby="two">First</button>' +
        '<span id="two" aria-labelledby="one">Second</span></div>'
    )
    expect(accessibleName(root.querySelector("button")!)).toBe("Second")
  })

  it("falls back to aria-label when the reference is missing", () => {
    const el = one(
      '<button aria-labelledby="nope" aria-label="Save">x</button>'
    )
    expect(accessibleName(el)).toBe("Save")
  })

  it("puts aria-label ahead of the native name", () => {
    const el = one('<img alt="Native alt" aria-label="From label">')
    expect(accessibleName(el)).toBe("From label")
  })

  it("puts the native name ahead of text content", () => {
    const table = one(
      "<table><caption>Quarterly results</caption>" +
        "<tr><td>Q1</td></tr></table>"
    )
    const name = accessibleName(table)
    expect(name).toBe("Quarterly results")
    expect(name).not.toContain("Q1")
  })

  it("reads native names from label, legend and figcaption", () => {
    const labelled = html(
      '<div><label for="email">Email address</label>' +
        '<input id="email" placeholder="you@example.com"></div>'
    )
    expect(accessibleName(labelled.querySelector("input")!)).toBe(
      "Email address"
    )

    const wrapped = one('<label>Remember me<input type="checkbox"></label>')
    expect(accessibleName(wrapped.querySelector("input")!)).toBe("Remember me")

    const placeholder = one('<input placeholder="Search docs">')
    expect(accessibleName(placeholder)).toBe("Search docs")

    const fieldset = one("<fieldset><legend>Shipping</legend></fieldset>")
    expect(accessibleName(fieldset)).toBe("Shipping")

    const figure = one("<figure><figcaption>Fig 1</figcaption></figure>")
    expect(accessibleName(figure)).toBe("Fig 1")
  })

  it("puts text content ahead of title", () => {
    const el = one('<button title="Tooltip text">Save file</button>')
    expect(accessibleName(el)).toBe("Save file")
  })

  it("puts title ahead of <svg><title>", () => {
    const el = one(
      '<button title="Tooltip text"><svg><title>Close</title></svg></button>'
    )
    pinInnerText(el, "")
    expect(accessibleName(el)).toBe("Tooltip text")
  })

  it("names an icon-only button from its <svg><title>", () => {
    const el = one("<button><svg><title>Close</title></svg></button>")
    pinInnerText(el, "")
    expect(accessibleName(el)).toBe("Close")
  })

  it("accepts <svg><desc> as the last SVG resort", () => {
    const el = one("<button><svg><desc>Dismiss</desc></svg></button>")
    pinInnerText(el, "")
    expect(accessibleName(el)).toBe("Dismiss")
  })

  it("falls back to a descendant image's alt text", () => {
    const el = one('<button><img src="p.png" alt="Print"></button>')
    expect(accessibleName(el)).toBe("Print")
  })

  it("falls back to an input's value last of all", () => {
    const el = one('<input type="submit">') as HTMLInputElement
    el.value = "Send"
    expect(accessibleName(el)).toBe("Send")
  })
})

describe("accessibleName edge cases", () => {
  it("does not treat an empty alt as a name, and finds nothing else", () => {
    // A decorative image is deliberately nameless: `alt=""` produces "" and
    // there is nothing left to fall through to.
    expect(accessibleName(one('<img src="spacer.gif" alt="">'))).toBe("")
  })

  it("keeps a decorative image from naming its button", () => {
    const el = one('<button><img src="spacer.gif" alt=""></button>')
    expect(accessibleName(el)).toBe("")
  })

  it("stops at an empty alt rather than falling through to title", () => {
    // Per AccName, `alt=""` marks the image decorative and terminates with an
    // empty name. Falling through to `title` would put "Company logo" rows in
    // the level strip for images the author explicitly hid from assistive
    // tech — the opposite of what the attribute asks for.
    expect(accessibleName(one('<img alt="" title="Company logo">'))).toBe("")
  })

  it("ignores whitespace-only labels", () => {
    expect(accessibleName(one('<button aria-label="   ">Save</button>'))).toBe(
      "Save"
    )
  })

  it("collapses runs of whitespace", () => {
    const el = one("<button>  Save   the\n\n  file\t </button>")
    expect(accessibleName(el)).toBe("Save the file")
  })

  it("truncates long names to 120 characters", () => {
    const long = "word ".repeat(60).trim()
    expect(long.length).toBeGreaterThan(120)
    const name = accessibleName(one(`<button>${long}</button>`))
    expect(name).toHaveLength(120)
    expect(long.startsWith(name)).toBe(true)
  })

  it("returns an empty string when there is no name at all", () => {
    expect(accessibleName(one("<div></div>"))).toBe("")
  })
})

describe("fallbackDescription", () => {
  it("describes an unnamed link by host and path", () => {
    const el = one('<a href="https://example.com/docs/guide?x=1">x</a>')
    expect(fallbackDescription(el, "link")).toBe("example.com/docs/guide")
  })

  it("resolves a relative href against the document", () => {
    const el = one('<a href="/docs/guide">x</a>')
    const expected = new URL("/docs/guide", location.href)
    expect(fallbackDescription(el, "link")).toBe(
      expected.hostname + expected.pathname
    )
  })

  it("never fabricates a name for other roles", () => {
    expect(fallbackDescription(one("<button>x</button>"), "button")).toBe(
      "(unnamed button)"
    )
    expect(fallbackDescription(one("<div>x</div>"), "region")).toBe(
      "(unnamed region)"
    )
  })
})
