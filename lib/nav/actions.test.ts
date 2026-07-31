import {
  activationTarget,
  formatUrl,
  hrefOf,
  isFragmentJump,
  textOf
} from "~/lib/nav/actions"
import { html } from "~/test/harness"

/** The single top-level element of a markup fragment. */
function one(markup: string): Element {
  return html(markup).firstElementChild!
}

const absolute = (path: string) => new URL(path, document.baseURI).href

describe("hrefOf", () => {
  it("resolves a relative href against the document", () => {
    expect(hrefOf(one('<a href="/docs/guide">Docs</a>'))).toBe(
      absolute("/docs/guide")
    )
    expect(hrefOf(one('<a href="guide.html">Docs</a>'))).toBe(
      absolute("guide.html")
    )
  })

  it("leaves an absolute href alone", () => {
    expect(hrefOf(one('<a href="https://example.com/x">Docs</a>'))).toBe(
      "https://example.com/x"
    )
  })

  it("finds the link inside a record", () => {
    const record = one(
      '<article><h3><a href="/posts/1">Title</a></h3>' +
        "<p>Summary</p></article>"
    )
    expect(hrefOf(record)).toBe(absolute("/posts/1"))
  })

  it("returns null when there is no link", () => {
    expect(hrefOf(one("<div>Just text</div>"))).toBeNull()
    expect(hrefOf(one("<a>Named location</a>"))).toBeNull()
  })
})

describe("textOf", () => {
  it("trims and collapses runs of blank lines", () => {
    const el = one("<div>  Alpha\n\n\n\nBeta  </div>")
    expect(textOf(el)).toBe("Alpha\n\nBeta")
  })
})

describe("activationTarget", () => {
  it("finds the inner link of a record", () => {
    const record = one(
      '<article><h3><a href="/posts/1">Title</a></h3>' +
        "<p>Summary</p></article>"
    )
    expect(activationTarget(record)).toBe(record.querySelector("a"))
  })

  it("returns an activatable element as itself", () => {
    const link = one('<a href="/x">x</a>')
    expect(activationTarget(link)).toBe(link)

    const button = one("<button>Go</button>")
    expect(activationTarget(button)).toBe(button)

    const custom = one('<div role="button">Go</div>')
    expect(activationTarget(custom)).toBe(custom)

    const input = one('<input type="text">')
    expect(activationTarget(input)).toBe(input)
  })

  it("returns null when nothing inside can be activated", () => {
    expect(activationTarget(one("<p>Just prose</p>"))).toBeNull()
  })
})

describe("the address a row shows is the one Enter follows", () => {
  it("agrees with activationTarget on a control that wraps a link", () => {
    // One row used to give three different answers. A share button wrapping a
    // twitter.com/intent link is the everyday shape: roleOf calls it a button,
    // hrefOf descended and found the anchor — so the address column and
    // Alt+Enter both advertised twitter.com while activationTarget stopped at
    // the wrapper and Enter clicked the div, running the page's handler.
    const share = one(
      '<div role="button" aria-label="Share">' +
        '<a href="https://twitter.com/intent/tweet?url=x">Tweet</a></div>'
    )
    expect(activationTarget(share), "Enter acts on the control").toBe(share)
    expect(hrefOf(share), "so the row must not advertise the anchor").toBeNull()
  })

  it("still reads the anchor through a plain record wrapper", () => {
    // The case activationTarget exists for. No role on the container, so the
    // link inside is genuinely what the row is, and both must say so.
    const record = one(
      '<article><h3><a href="/posts/1">Title</a></h3><p>Summary</p></article>'
    )
    expect(activationTarget(record)).toBe(record.querySelector("a"))
    expect(hrefOf(record)).toBe(new URL("/posts/1", location.href).href)
  })

  it("keeps an anchor that is itself styled as a button", () => {
    // `<a href role="button">` is still a link: it has a real destination and
    // activationTarget returns the anchor itself, so nothing disagrees.
    const link = one('<a href="/checkout" role="button">Buy</a>')
    expect(activationTarget(link)).toBe(link)
    expect(hrefOf(link)).toBe(new URL("/checkout", location.href).href)
  })
})

describe("hrefOf on things that only look like links", () => {
  it("rejects an element with no link at all", () => {
    expect(hrefOf(one("<button>Search</button>"))).toBeNull()
  })

  it("rejects a javascript: href however it is spelled", () => {
    expect(hrefOf(one('<a href="javascript:void(0)">Go</a>'))).toBeNull()
    expect(hrefOf(one('<a href=" JavaScript:foo()">Go</a>'))).toBeNull()
  })

  it("rejects a bare # on something that behaves as a control", () => {
    expect(hrefOf(one('<a href="#" role="button">Toggle</a>'))).toBeNull()
    expect(hrefOf(one('<a href="#" aria-expanded="false">More</a>'))).toBeNull()
    expect(hrefOf(one('<a href="#" aria-controls="panel">Open</a>'))).toBeNull()
  })

  it("keeps a bare # that means the top of the document", () => {
    // Wikipedia's "(Top)" contents link. In HTML this is a real destination,
    // and excluding every "#" took it out of the index along with the controls.
    expect(hrefOf(one('<a href="#">(Top)</a>'))).not.toBeNull()
  })

  it("keeps a real fragment", () => {
    expect(hrefOf(one('<a href="#Geography">Geography</a>'))).toContain(
      "#Geography"
    )
  })
})

describe("formatUrl on the page you are already on", () => {
  const here = "https://en.wikipedia.org/wiki/Nile"

  it("shows only the fragment for a link into this page", () => {
    // Every contents entry read "/wiki/Nile#Geography" — eleven identical
    // characters on every row, with the part that differs pushed to the end.
    expect(formatUrl(`${here}#Geography`, here)).toBe("#Geography")
    expect(formatUrl("#Sources", here)).toBe("#Sources")
  })

  it("keeps the path for a link to this page with no fragment", () => {
    // A reload, not a jump. "#" would misdescribe it.
    expect(formatUrl(here, here)).toBe("/wiki/Nile")
  })

  it("keeps the path for a fragment on a different page", () => {
    expect(formatUrl("/wiki/Egypt#Geography", here)).toBe(
      "/wiki/Egypt#Geography"
    )
  })

  it("keeps the host for a fragment off-site", () => {
    expect(formatUrl("https://example.com/a#b", here)).toBe("example.com/a#b")
  })
})

describe("isFragmentJump", () => {
  const here = "https://en.wikipedia.org/wiki/Nile"

  it("is true only when nothing unloads", () => {
    expect(isFragmentJump(`${here}#Geography`, here)).toBe(true)
    expect(isFragmentJump("#Geography", here)).toBe(true)
  })

  it("is false for a reload of the same page", () => {
    expect(isFragmentJump(here, here)).toBe(false)
  })

  it("is false for another page, fragment or not", () => {
    expect(isFragmentJump("/wiki/Egypt#Geography", here)).toBe(false)
    expect(isFragmentJump("https://example.com/#x", here)).toBe(false)
  })
})
