import {
  ACTIONABLE,
  classifyTable,
  isSkipped,
  isTransparentTag,
  roleOf,
  SIGNIFICANT,
  tagOf
} from "~/lib/dom/roles"
import { html } from "~/test/harness"

const SVG_NS = "http://www.w3.org/2000/svg"

/** The single top-level element of a markup fragment. */
function one(markup: string): Element {
  return html(markup).firstElementChild!
}

describe("tagOf", () => {
  it("uppercases HTML tag names", () => {
    expect(tagOf(one("<div>x</div>"))).toBe("DIV")
  })

  it("uppercases the lowercase tag names SVG elements really have", () => {
    const g = document.createElementNS(SVG_NS, "g")
    // The DOM reports SVG tag names verbatim, i.e. lowercase.
    expect(g.tagName).toBe("g")
    expect(tagOf(g)).toBe("G")
  })
})

describe("isSkipped", () => {
  it("skips SVG internals created in the SVG namespace", () => {
    for (const tag of ["g", "path", "rect"]) {
      const el = document.createElementNS(SVG_NS, tag)
      expect(el.tagName).toBe(tag)
      expect(isSkipped(el)).toBe(true)
    }
  })

  it("skips <svg> itself and non-rendered HTML tags", () => {
    expect(isSkipped(document.createElementNS(SVG_NS, "svg"))).toBe(true)
    expect(isSkipped(one("<script>1</script>"))).toBe(true)
    expect(isSkipped(one("<br>"))).toBe(true)
  })

  it("does not skip real content", () => {
    expect(isSkipped(one("<div>x</div>"))).toBe(false)
    expect(isSkipped(one("<table><tr><td>x</td></tr></table>"))).toBe(false)
  })

  it("never skips TBODY, which would prune every row beneath it", () => {
    const table = one("<table><tbody><tr><td>x</td></tr></tbody></table>")
    const tbody = table.querySelector("tbody")!
    expect(isSkipped(tbody)).toBe(false)
    expect(isTransparentTag(tbody)).toBe(true)
  })
})

describe("isTransparentTag", () => {
  it("treats table grouping wrappers as pass-through", () => {
    // The <thead> has to be parsed inside a <table>. A bare one is dropped
    // outright by the HTML parser, which older happy-dom versions did not
    // enforce, so this fixture used to yield null and `one()` handed it
    // straight to tagOf.
    const table = one("<table><thead><tr><td>x</td></tr></thead></table>")
    expect(isTransparentTag(table.querySelector("thead")!)).toBe(true)
    expect(isTransparentTag(table)).toBe(false)
  })
})

describe("roleOf", () => {
  it("prefers an explicit role over the tag mapping", () => {
    expect(roleOf(one('<div role="button">Go</div>'))).toBe("button")
    expect(roleOf(one('<ul role="tablist"><li>a</li></ul>'))).toBe("tablist")
  })

  it("takes the first token of a role fallback list", () => {
    expect(roleOf(one('<div role="doc-subtitle heading">t</div>'))).toBe(
      "doc-subtitle"
    )
  })

  it("returns null for presentation and none", () => {
    expect(roleOf(one('<div role="presentation">x</div>'))).toBeNull()
    expect(roleOf(one('<div role="none">x</div>'))).toBeNull()
    // Even on a tag that would otherwise map to a role.
    expect(roleOf(one('<img role="presentation" alt="x">'))).toBeNull()
    expect(roleOf(one('<a href="/x" role="none">x</a>'))).toBeNull()
  })

  it("maps plain tags through HTML-AAM", () => {
    expect(roleOf(one("<h2>Title</h2>"))).toBe("heading")
    expect(roleOf(one("<nav>x</nav>"))).toBe("navigation")
    expect(roleOf(one("<ul><li>a</li></ul>"))).toBe("list")
    expect(roleOf(one("<button>Go</button>"))).toBe("button")
    expect(roleOf(one("<span>x</span>"))).toBeNull()
  })

  it("treats an anchor without href as a named location, not a link", () => {
    expect(roleOf(one('<a href="/x">Docs</a>'))).toBe("link")
    expect(roleOf(one("<a>Anchor</a>"))).toBeNull()
    expect(roleOf(one('<a name="top">Anchor</a>'))).toBeNull()
  })

  it("gives an unlabelled <section> no role of its own", () => {
    expect(roleOf(one("<section>x</section>"))).toBeNull()
    expect(roleOf(one('<section aria-label="Prices">x</section>'))).toBe(
      "region"
    )
    const labelled = html(
      '<div><h2 id="sec-h">Prices</h2>' +
        '<section aria-labelledby="sec-h">x</section></div>'
    )
    expect(roleOf(labelled.querySelector("section")!)).toBe("region")
  })

  it("maps input types", () => {
    expect(roleOf(one('<input type="hidden">'))).toBeNull()
    expect(roleOf(one('<input type="checkbox">'))).toBe("checkbox")
    expect(roleOf(one('<input type="radio">'))).toBe("radio")
    expect(roleOf(one('<input type="submit">'))).toBe("button")
    expect(roleOf(one('<input type="button">'))).toBe("button")
    expect(roleOf(one('<input type="reset">'))).toBe("button")
    expect(roleOf(one('<input type="search">'))).toBe("search")
    expect(roleOf(one('<input type="email">'))).toBe("textbox")
    expect(roleOf(one("<input>"))).toBe("textbox")
  })

  it("is case-insensitive about the input type", () => {
    expect(roleOf(one('<input type="HIDDEN">'))).toBeNull()
    expect(roleOf(one('<input type="Checkbox">'))).toBe("checkbox")
  })

  it("drops the role of a layout table and of its rows and cells", () => {
    const table = one(
      '<table role="presentation">' +
        "<tr><td>Logo</td><td>Nav</td></tr>" +
        "</table>"
    )
    expect(roleOf(table)).toBeNull()
    expect(roleOf(table.querySelector("tr")!)).toBeNull()
    expect(roleOf(table.querySelector("td")!)).toBeNull()
  })

  it("keeps the role of a data table and of its rows and cells", () => {
    const table = one(
      "<table><tr><th>Name</th></tr><tr><td>Ada</td></tr></table>"
    )
    expect(roleOf(table)).toBe("table")
    expect(roleOf(table.querySelector("tr")!)).toBe("row")
    expect(roleOf(table.querySelector("th")!)).toBe("columnheader")
    expect(roleOf(table.querySelector("td")!)).toBe("cell")
  })
})

describe("classifyTable", () => {
  it("is a no-op on anything that is not a table", () => {
    const verdict = classifyTable(one("<div>x</div>"))
    expect(verdict).toEqual({ layout: false, score: 0, reason: "not-a-table" })
  })

  it("calls a table with <th> data", () => {
    const verdict = classifyTable(
      one("<table><tr><th>Name</th></tr><tr><td>Ada</td></tr></table>")
    )
    expect(verdict.layout).toBe(false)
    expect(verdict.reason).toBe("has-headers")
    expect(verdict.score).toBe(0)
  })

  it("calls a table with a caption or [scope] data", () => {
    expect(
      classifyTable(
        one("<table><caption>Q1</caption><tr><td>1</td></tr></table>")
      ).reason
    ).toBe("has-headers")
    expect(
      classifyTable(one('<table><tr><td scope="row">1</td></tr></table>'))
        .reason
    ).toBe("has-headers")
  })

  it("calls a summary attribute data", () => {
    const verdict = classifyTable(
      one('<table summary="Sales"><tr><td>1</td></tr></table>')
    )
    expect(verdict.layout).toBe(false)
    expect(verdict.reason).toBe("has-summary")
  })

  it("calls role=presentation and role=none layout, definitively", () => {
    for (const role of ["presentation", "none"]) {
      const verdict = classifyTable(
        one(`<table role="${role}"><tr><th>Name</th></tr></table>`)
      )
      expect(verdict.layout).toBe(true)
      expect(verdict.score).toBe(1)
      // The reason names the attribute the page actually used, so a diagnostic
      // does not report a value that is not in the markup.
      expect(verdict.reason).toBe(`role=${role}`)
    }
  })

  it("calls an explicit grid/table/treegrid role data", () => {
    for (const role of ["grid", "table", "treegrid"]) {
      const verdict = classifyTable(
        one(`<table role="${role}"><tr><td>1</td></tr></table>`)
      )
      expect(verdict.layout).toBe(false)
      expect(verdict.reason).toBe(`role=${role}`)
    }
  })

  it("calls a headerless two-row shim of blocks layout", () => {
    // Two-row tables never reach the ragged-columns branch: `few-rows`
    // already covers them, and the image-only cells add `text-sparse`.
    const verdict = classifyTable(
      one(
        "<table>" +
          '<tr><td><img src="logo.png" alt=""></td>' +
          '<td><img src="hero.png" alt=""></td></tr>' +
          '<tr><td colspan="2"></td></tr>' +
          "</table>"
      )
    )
    expect(verdict.layout).toBe(true)
    expect(verdict.score).toBeGreaterThanOrEqual(0.6)
    expect(verdict.reason).toContain("no-headers")
    expect(verdict.reason).toContain("few-rows")
    expect(verdict.reason).toContain("text-sparse")
  })

  it("calls a ragged grid of blocks layout", () => {
    const verdict = classifyTable(
      one(
        "<table>" +
          '<tr><td><img src="a.png" alt=""></td><td></td><td></td></tr>' +
          "<tr><td></td></tr>" +
          "<tr><td></td><td></td></tr>" +
          "</table>"
      )
    )
    expect(verdict.reason).toContain("ragged-columns")
    expect(verdict.layout).toBe(true)
  })

  it("keeps a headerless but rectangular grid of short cells as DATA", () => {
    // The malformed calendar / financial report: no th anywhere, yet the
    // shape and the text density say data. Flattening it destroys real
    // structure, which is the whole reason the weighted classifier exists.
    const verdict = classifyTable(
      one(
        "<table>" +
          "<tr><td>Mon</td><td>1</td></tr>" +
          "<tr><td>Tue</td><td>2</td></tr>" +
          "<tr><td>Wed</td><td>3</td></tr>" +
          "</table>"
      )
    )
    expect(verdict.layout).toBe(false)
    expect(verdict.score).toBeLessThan(0.6)
    expect(verdict.reason).toContain("rectangular")
    expect(verdict.reason).toContain("text-dense")
  })

  it("keeps an uncertain textual table rather than flattening it", () => {
    // Ragged but text-dense: the evidence conflicts, so it is preserved.
    const verdict = classifyTable(
      one(
        "<table>" +
          "<tr><td>a</td><td>b</td><td>c</td></tr>" +
          "<tr><td>d</td></tr>" +
          "<tr><td>e</td><td>f</td></tr>" +
          "</table>"
      )
    )
    expect(verdict.reason).toContain("ragged-columns")
    expect(verdict.layout).toBe(false)
  })

  it("ignores headers that belong to a nested table", () => {
    const outer = one(
      "<table>" +
        "<tr><td><table><tr><th>Name</th></tr>" +
        "<tr><td>Ada</td></tr></table></td></tr>" +
        "<tr><td></td></tr>" +
        "</table>"
    )
    const inner = outer.querySelector("table")!

    const verdict = classifyTable(outer)
    expect(verdict.reason).not.toContain("has-headers")
    expect(verdict.reason).toContain("nested-table")
    expect(verdict.layout).toBe(true)

    // The nested table owns that <th> and is data in its own right.
    expect(classifyTable(inner).reason).toBe("has-headers")
    expect(classifyTable(inner).layout).toBe(false)
  })

  it("counts only rows and cells owned by the table being judged", () => {
    const outer = one(
      "<table>" +
        "<tr><td><table>" +
        "<tr><td>1</td><td>2</td></tr>" +
        "<tr><td>3</td><td>4</td></tr>" +
        "<tr><td>5</td><td>6</td></tr>" +
        "</table></td></tr>" +
        "</table>"
    )
    // One own row, so `few-rows` — the inner table's three rows are not
    // borrowed by the outer one.
    expect(classifyTable(outer).reason).toContain("few-rows")
    expect(classifyTable(outer.querySelector("table")!).reason).toContain(
      "rectangular"
    )
  })
})

describe("role sets", () => {
  it("lists every actionable role as significant too", () => {
    for (const role of ACTIONABLE) {
      expect(SIGNIFICANT.has(role)).toBe(true)
    }
  })

  it("keeps non-interactive structure out of ACTIONABLE", () => {
    for (const role of ["heading", "paragraph", "list", "table", "region"]) {
      expect(ACTIONABLE.has(role)).toBe(false)
      expect(SIGNIFICANT.has(role)).toBe(true)
    }
  })
})

describe("prototype safety", () => {
  it("does not resolve inherited object members as roles", () => {
    // `tag` is page-controlled. A plain object literal would answer
    // <constructor> or <toString> with an inherited member.
    for (const name of ["constructor", "toString", "__proto__", "valueOf"]) {
      const el = document.createElement("div")
      Object.defineProperty(el, "tagName", { value: name.toUpperCase() })
      expect(roleOf(el)).toBeNull()
    }
  })
})
