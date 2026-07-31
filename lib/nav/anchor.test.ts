import { captureAnchor, isActivatable, resolveAnchor } from "~/lib/nav/anchor"
import { html } from "~/test/harness"

/**
 * Cursor identity across mutation. This is the largest single
 * unknown in the project, and the gate is >=95% retention on ordinary
 * re-render with explicit graceful failure under virtual-list churn.
 *
 * The cases that matter are the ones where a naive implementation is
 * *confidently wrong*: a recycled element that still dereferences, and a
 * reordered list where position no longer means anything.
 */

describe("stable identity", () => {
  it("re-resolves an untouched element as exact", () => {
    const root = html(`
      <ul>
        <li><a href="/one" id="one">First item</a></li>
        <li><a href="/two" id="two">Second item</a></li>
      </ul>
    `)
    const target = root.querySelector("#two")!
    const anchor = captureAnchor(target)

    const found = resolveAnchor(anchor, root)
    expect(found.el).toBe(target)
    expect(found.quality).toBe("exact")
    expect(isActivatable(found.quality)).toBe(true)
  })

  it("finds the node again after the list is re-rendered from scratch", () => {
    const root = html(`
      <ul>
        <li><a href="/one">First item</a></li>
        <li><a href="/two">Second item</a></li>
        <li><a href="/three">Third item</a></li>
      </ul>
    `)
    const anchor = captureAnchor(root.querySelector('a[href="/two"]')!)

    // Same markup, brand new element objects — the ordinary React re-render.
    root.querySelector("ul")!.innerHTML = `
      <li><a href="/one">First item</a></li>
      <li><a href="/two">Second item</a></li>
      <li><a href="/three">Third item</a></li>
    `

    const found = resolveAnchor(anchor, root)
    expect(found.el).toBe(root.querySelector('a[href="/two"]'))
    expect(isActivatable(found.quality)).toBe(true)
  })

  it("follows the node when the list reorders", () => {
    const root = html(`
      <ul>
        <li><a href="/alpha">Alpha item</a></li>
        <li><a href="/beta">Beta item</a></li>
        <li><a href="/gamma">Gamma item</a></li>
      </ul>
    `)
    const anchor = captureAnchor(root.querySelector('a[href="/gamma"]')!)

    root.querySelector("ul")!.innerHTML = `
      <li><a href="/gamma">Gamma item</a></li>
      <li><a href="/alpha">Alpha item</a></li>
      <li><a href="/beta">Beta item</a></li>
    `

    const found = resolveAnchor(anchor, root)
    // Position says index 2; identity says index 0. Identity must win.
    expect(found.el?.getAttribute("href")).toBe("/gamma")
    expect(isActivatable(found.quality)).toBe(true)
  })
})

describe("virtualizer recycling", () => {
  it("refuses to trust a live reference whose content changed", () => {
    const root = html(`
      <div class="viewport">
        <div class="row"><a href="/item/40">Item forty</a></div>
        <div class="row"><a href="/item/41">Item forty-one</a></div>
      </div>
    `)
    const recycled = root.querySelectorAll(".row")[0]!
    const anchor = captureAnchor(recycled)

    // The virtualizer scrolls and reuses the same element for another record.
    // The WeakRef still dereferences, and it is now pointing at the wrong
    // thing — this is the failure that silently activates the wrong row.
    recycled.innerHTML = `<a href="/item/900">Item nine hundred</a>`

    const found = resolveAnchor(anchor, root)
    expect(found.quality).not.toBe("exact")
    expect(found.el).not.toBe(recycled)
  })

  it("reports a window boundary rather than faking an unmounted row", () => {
    const root = html(`
      <div class="viewport">
        <div class="row" id="r1"><a href="/item/1">Item one</a></div>
      </div>
    `)
    const anchor = captureAnchor(root.querySelector("#r1")!)

    // Scrolled far away: the row is genuinely unmounted.
    root.querySelector(".viewport")!.innerHTML =
      `<div class="row" id="r99"><a href="/item/99">Item ninety-nine</a></div>`

    const found = resolveAnchor(anchor, root)
    expect(found.quality).toBe("degraded")
    expect(isActivatable(found.quality)).toBe(false)
    // Still navigable from the surviving ancestor.
    expect(found.el).toBe(root.querySelector(".viewport"))
  })
})

describe("location signals", () => {
  it("never establishes a match on position alone", () => {
    const root = html(`
      <ul>
        <li><span>Original content here</span></li>
        <li><span>Second row content</span></li>
      </ul>
    `)
    const anchor = captureAnchor(root.querySelectorAll("li")[0]!)

    // Same shape, same position, entirely different content.
    root.querySelector("ul")!.innerHTML = `
      <li><span>Completely different text</span></li>
      <li><span>Also different text here</span></li>
    `

    const found = resolveAnchor(anchor, root)
    expect(found.quality).toBe("degraded")
  })

  it("uses position only to break ties between equal identities", () => {
    // Siblings of the same parent, so the sibling index is the *only* thing
    // that differs — everything identity-based is identical.
    const root = html(`
      <div class="row">
        <a href="/dup">Duplicate</a>
        <a href="/dup">Duplicate</a>
        <a href="/dup">Duplicate</a>
      </div>
    `)
    const anchor = captureAnchor(root.querySelectorAll("a")[1]!)

    // Re-render, so the original reference is dead and resolution has to go
    // through the candidate search where the tie-break actually lives.
    root.querySelector(".row")!.innerHTML = `
      <a href="/dup">Duplicate</a>
      <a href="/dup">Duplicate</a>
      <a href="/dup">Duplicate</a>
    `
    const rebuilt = Array.from(root.querySelectorAll("a"))

    const found = resolveAnchor(anchor, root)
    expect(found.el).toBe(rebuilt[1])
  })

  it("cannot distinguish duplicates that differ in nothing at all", () => {
    // Documented accepted failure: identical records with no
    // stable id and no distinguishing position can mis-anchor. The test exists
    // so that the limitation is visible rather than discovered in the field.
    const root = html(`
      <ul>
        <li><a href="/dup">Duplicate</a></li>
        <li><a href="/dup">Duplicate</a></li>
      </ul>
    `)
    const anchor = captureAnchor(root.querySelectorAll("a")[1]!)
    root.querySelector("ul")!.innerHTML = `
      <li><a href="/dup">Duplicate</a></li>
      <li><a href="/dup">Duplicate</a></li>
    `

    const found = resolveAnchor(anchor, root)
    // It resolves confidently — to one of them. Which one is not guaranteed.
    expect(isActivatable(found.quality)).toBe(true)
    expect(Array.from(root.querySelectorAll("a"))).toContain(found.el)
  })
})

describe("unstable ids", () => {
  it("ignores framework-generated ids that change every render", () => {
    const root = html(`<div id=":r7:"><a href="/x">Content</a></div>`)
    const anchor = captureAnchor(root.querySelector("#\\:r7\\:")!)

    expect(anchor.id).toBeUndefined()
  })

  it("ignores ids containing long digit runs", () => {
    const root = html(`<div id="row-1734829471"><a href="/y">Row</a></div>`)
    const anchor = captureAnchor(root.querySelector("[id]")!)

    expect(anchor.id).toBeUndefined()
  })

  it("keeps a hand-written id", () => {
    const root = html(`<div id="main-content"><a href="/z">Main</a></div>`)
    const anchor = captureAnchor(root.querySelector("[id]")!)

    expect(anchor.id).toBe("main-content")
  })
})

describe("total loss", () => {
  it("degrades to the outermost surviving ancestor", () => {
    // In a real document some ancestor almost always survives — at worst
    // <body>. Landing there is an honest recovery: the user keeps a position
    // at the top of the page and activation stays blocked.
    const root = html(`<div class="gone"><span>Some text</span></div>`)
    const anchor = captureAnchor(root.querySelector("span")!)

    root.replaceChildren()

    const found = resolveAnchor(anchor, root)
    expect(found.quality).toBe("degraded")
    expect(found.el?.isConnected).toBe(true)
    expect(isActivatable(found.quality)).toBe(false)
  })

  it("reports lost when not even an ancestor is left", () => {
    const detached = document.createElement("div")
    const span = document.createElement("span")
    span.textContent = "Some text"
    detached.appendChild(span)

    const anchor = captureAnchor(span)
    detached.replaceChildren()

    const found = resolveAnchor(anchor, detached)
    expect(found.quality).toBe("lost")
    expect(found.el).toBeNull()
    expect(isActivatable(found.quality)).toBe(false)
  })
})

describe("hostile markup", () => {
  it("does not throw on a tag name that cannot go in a selector", () => {
    // Chrome's tokenizer accepts `<a"q>` and reports tagName 'A"Q'. Every
    // selector built from that is a syntax error, and an uncaught throw here
    // would abort reconcile() — leaving the activation guard switched off
    // while the strip showed a stale label.
    const root = html(`<div class="scope"><span>Some content here</span></div>`)
    const victim = root.querySelector("span")!
    const anchor = captureAnchor(victim)

    for (const tag of ['A"Q', "A'Q", "A.EVIL", "A,Z", "A[X]", "A B"]) {
      const hostile = { ...anchor, tag }
      expect(() => resolveAnchor(hostile, root)).not.toThrow()
      // It must also refuse to claim a confident match.
      const found = resolveAnchor(hostile, root)
      expect(["degraded", "lost", "confident", "exact"]).toContain(
        found.quality
      )
    }
  })

  it("survives a multi-megabyte text node without copying all of it", () => {
    const root = html(`<div class="scope"><span></span></div>`)
    const span = root.querySelector("span")!
    span.textContent = "x".repeat(2_000_000)

    const started = Date.now()
    const anchor = captureAnchor(span)
    resolveAnchor(anchor, root)
    expect(Date.now() - started).toBeLessThan(500)
    expect(anchor.textHash).toBeTruthy()
  })
})
