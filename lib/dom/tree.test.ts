import { extractTree, nameOf, pathTo } from "~/lib/dom/tree"
import type { SemanticNode } from "~/lib/dom/types"
import { html, testOptions } from "~/test/harness"

function find(nodes: SemanticNode[], role: string): SemanticNode | null {
  for (const node of nodes) {
    if (node.role === role) return node
    const nested = find(node.children, role)
    if (nested) return nested
  }
  return null
}

function flatten(nodes: SemanticNode[]): SemanticNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

function extract(root: Element) {
  return extractTree(root, testOptions)
}

describe("chain collapsing", () => {
  it("never unwraps through an actionable ancestor", () => {
    // The research spike replaced a child with its grandchildren, which
    // deleted wrapping <a> elements outright — 17 real links on one GitHub
    // page. The link must survive as a node with the heading beneath it.
    const root = html(`
      <div data-rect="0,0,700,600">
        <a href="/one" data-rect="0,0,700,60"><h2 data-rect="0,0,700,60">One</h2></a>
        <a href="/two" data-rect="0,70,700,60"><h2 data-rect="0,70,700,60">Two</h2></a>
      </div>
    `)

    const { roots } = extract(root)
    const links = flatten(roots).filter((n) => n.role === "link")

    expect(links).toHaveLength(2)
    expect(
      links.map((l) => (l.el as HTMLAnchorElement).getAttribute("href"))
    ).toEqual(["/one", "/two"])
  })

  it("records collapsed roles on the surviving edge", () => {
    const root = html(`
      <div data-rect="0,0,700,300">
        <ul data-rect="0,0,700,100">
          <li data-rect="0,0,700,100">
            <p data-rect="0,0,700,100">Only child prose</p>
          </li>
        </ul>
        <ul data-rect="0,110,700,100">
          <li data-rect="0,110,700,100">
            <p data-rect="0,110,700,100">Second list</p>
          </li>
        </ul>
      </div>
    `)

    const { roots } = extract(root)
    const paragraph = find(roots, "paragraph")

    expect(paragraph).not.toBeNull()
    // list -> listitem were both single-child links in the chain.
    expect(paragraph!.collapsed).toContain("list")
    expect(paragraph!.collapsed).toContain("listitem")
  })
})

describe("reversibility", () => {
  it("gives every node a parent that leads back to a root", () => {
    const root = html(`
      <main data-rect="0,0,700,600">
        <article data-rect="0,0,700,280">
          <h2 data-rect="0,0,700,40">First</h2>
          <p data-rect="0,50,700,60">Body one</p>
          <a href="/a" data-rect="0,120,700,30">Link one</a>
        </article>
        <article data-rect="0,300,700,280">
          <h2 data-rect="0,300,700,40">Second</h2>
          <p data-rect="0,350,700,60">Body two</p>
          <a href="/b" data-rect="0,420,700,30">Link two</a>
        </article>
      </main>
    `)

    const { roots } = extract(root)

    for (const node of flatten(roots)) {
      const path = pathTo(node)
      expect(path[path.length - 1]).toBe(node)
      // Walking parents from any node must terminate at a root, which is
      // what makes `h` an exact inverse of `l`.
      expect(roots).toContain(path[0])
    }
  })
})

describe("visibility", () => {
  it("does not promote screen-reader-only text to a node", () => {
    const root = html(`
      <div data-rect="0,0,700,120">
        <span class="sr-only" data-rect="0,0,0,0"
              data-style="position:absolute;overflow:hidden;clip:rect(0,0,0,0)">
          Skip to content
        </span>
        <a href="/real" data-rect="0,0,700,40">Visible link</a>
      </div>
    `)

    const { roots } = extract(root)
    const names = flatten(roots).map((n) => nameOf(n))

    expect(names).toContain("Visible link")
    expect(names).not.toContain("Skip to content")
  })

  it("passes through display:contents rather than dropping the subtree", () => {
    const root = html(`
      <div data-rect="0,0,700,120">
        <div data-style="display:contents">
          <a href="/inside" data-rect="0,0,700,40">Inside contents</a>
        </div>
      </div>
    `)

    const { roots } = extract(root)
    expect(flatten(roots).some((n) => n.role === "link")).toBe(true)
  })
})

describe("shadow DOM", () => {
  it("walks an open shadow root", () => {
    const root = html(
      `<div data-rect="0,0,700,200"><div id="host"></div></div>`
    )
    const host = root.querySelector("#host")!
    const shadow = host.attachShadow({ mode: "open" })
    const link = document.createElement("a")
    link.href = "/shadow"
    link.textContent = "Shadow link"
    link.setAttribute("data-rect", "0,0,700,40")
    shadow.appendChild(link)

    const { roots } = extract(root)
    const found = flatten(roots).find((n) => n.role === "link")

    expect(found).toBeDefined()
    expect(nameOf(found!)).toBe("Shadow link")
  })

  it("treats a closed shadow root as an opaque leaf", () => {
    const root = html(
      `<div data-rect="0,0,700,200"><div id="host"></div></div>`
    )
    const host = root.querySelector("#host")!
    const shadow = host.attachShadow({ mode: "closed" })
    const link = document.createElement("a")
    link.href = "/hidden"
    link.textContent = "Unreachable"
    shadow.appendChild(link)

    const { roots } = extract(root)
    expect(flatten(roots).some((n) => nameOf(n) === "Unreachable")).toBe(false)
  })
})

describe("record promotion", () => {
  it("gives role-less repeated divs the record role", () => {
    const rows = Array.from(
      { length: 6 },
      (_, i) =>
        `<div data-rect="0,${i * 70},700,60">` +
        `<a href="/r/${i}">Repeated row number ${i} with a title</a>` +
        `<span>metadata line</span></div>`
    ).join("")
    const root = html(`<div data-rect="0,0,700,420">${rows}</div>`)

    const { roots } = extract(root)
    const records = flatten(roots).filter((n) => n.role === "record")

    expect(records).toHaveLength(6)
    for (const record of records) {
      expect(record.confidence).toBeGreaterThanOrEqual(0.65)
    }
  })

  it("keeps an existing semantic role instead of overwriting it", () => {
    const rows = Array.from(
      { length: 5 },
      (_, i) =>
        `<li data-rect="0,${i * 70},700,60">` +
        `<a href="/l/${i}">List item ${i} with a descriptive title</a></li>`
    ).join("")
    const root = html(`<ul data-rect="0,0,700,350">${rows}</ul>`)

    const { roots } = extract(root)
    const nodes = flatten(roots)

    expect(nodes.some((n) => n.role === "record")).toBe(false)
    // Detected as a record set, but they are already listitems.
    const items = nodes.filter((n) => n.confidence !== undefined)
    expect(items.length).toBeGreaterThan(0)
  })
})

describe("large pages", () => {
  const bigList = (count: number) =>
    html(
      `<div data-rect="0,0,700,${count * 30}"><ul data-rect="0,0,700,${
        count * 30
      }">` +
        Array.from(
          { length: count },
          (_, i) =>
            `<li data-rect="0,${i * 30},700,28">` +
            `<a href="/item-${i}" data-rect="0,${i * 30},700,28">Item ${i}` +
            `</a></li>`
        ).join("") +
        `</ul></div>`
    )

  it("still finds every link once the page is big enough to skip records", () => {
    // The whole point. This used to return zero links: a `budget` of 1 stopped
    // the walk after one level, and `expandNode()` — the documented repair —
    // had no callers, so the deferred subtrees were never materialized. A page
    // over the threshold produced an empty panel with nothing saying why.
    const root = bigList(60)
    const result = extractTree(root, { ...testOptions, lazyThreshold: 10 })

    expect(result.stats.lazy, "should have taken the large-page path").toBe(
      true
    )
    const links = flatten(result.roots).filter((n) => n.role === "link")
    expect(links).toHaveLength(60)
  })

  it("skips record detection rather than the tree", () => {
    // Record detection is the expensive half, so it is what gets dropped. No
    // node carries a confidence when it is skipped.
    const root = bigList(30)
    const lazyRun = extractTree(root, { ...testOptions, lazyThreshold: 10 })
    const eagerRun = extractTree(root, {
      ...testOptions,
      lazyThreshold: 10_000
    })

    expect(lazyRun.stats.lazy).toBe(true)
    expect(eagerRun.stats.lazy).toBe(false)
    const marked = (r: typeof lazyRun) =>
      flatten(r.roots).filter((n) => n.confidence !== undefined).length
    expect(marked(lazyRun), "records skipped on the large-page path").toBe(0)
    expect(marked(eagerRun), "records detected otherwise").toBeGreaterThan(0)
  })

  it("reports what the level cap discarded instead of truncating silently", () => {
    // The cap is a backstop, not a design limit, and it must never take links
    // away without saying so. It sat at 500 while the index cap was 5000, so a
    // flat <ul> of 2000 links yielded exactly 500 and reported that as the
    // page's total.
    const root = bigList(40)
    const capped = extractTree(root, { ...testOptions, maxLevelSize: 25 })

    expect(capped.stats.dropped, "the loss is recorded").toBe(15)
    expect(flatten(capped.roots).filter((n) => n.role === "link")).toHaveLength(
      25
    )

    const whole = extractTree(root, testOptions)
    expect(whole.stats.dropped, "nothing dropped at the real default").toBe(0)
    expect(flatten(whole.roots).filter((n) => n.role === "link")).toHaveLength(
      40
    )
  })
})

describe("level composition", () => {
  it("hoists a role-less container's children into the level", () => {
    // Wrappers with no role add a level and no information, so their children
    // are spliced. Grouping them into anonymous directories was tried and
    // removed: the default view is a flat link index, and the extra level cost
    // a keystroke on every descent for structure most pages do not have.
    const root = html(`
      <main data-rect="0,0,900,900">
        <div class="toolbar" data-rect="0,0,900,30">
          <a href="/a" data-rect="0,0,100,30">Tab one</a>
        </div>
        <div class="body" data-rect="0,40,900,800">
          <h2 data-rect="0,40,900,40">Article heading</h2>
          <p data-rect="0,90,900,120">Body prose that runs on for a while.</p>
        </div>
      </main>
    `)

    const { roots } = extract(root)
    expect(roots.map((n) => n.role)).toEqual(["link", "heading", "paragraph"])
  })
})
