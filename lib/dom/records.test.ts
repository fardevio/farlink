import { detectRecords } from "~/lib/dom/records"
import type { RecordGroup } from "~/lib/dom/records"
import { html, testOptions } from "~/test/harness"

/**
 * This file is the regression harness in miniature. It lists
 * the site classes the extractor has to survive: single-column list, wrapped
 * card grid, masonry, virtualized feed, data table, nested discussion and
 * article. Research validated only the first of those against real pages, so
 * everything below the first block is testing genuinely unproven ground.
 *
 * The fixtures are synthetic because happy-dom does not lay out; geometry is
 * declared with `data-rect`. That makes these tests about the *scoring*, not
 * about real-world DOM shapes, and they do not substitute for the annotated
 * corpus the plan calls for.
 */

function groupFor(groups: RecordGroup[], container: Element): RecordGroup {
  const found = groups.find((g) => g.container === container)
  if (!found) throw new Error("no record group detected for container")
  return found
}

function detect(root: Element) {
  return detectRecords(root, testOptions)
}

describe("single-column list", () => {
  it("detects every row of a story list", () => {
    const rows = Array.from(
      { length: 10 },
      (_, i) =>
        `<div class="row" data-rect="0,${i * 60},700,50">` +
        `<a href="/s/${i}">A reasonably long story headline number ${i}</a>` +
        `<span class="meta">120 points by someone</span>` +
        `</div>`
    ).join("")
    const root = html(`<div class="list" data-rect="0,0,700,600">${rows}</div>`)

    const list = root.querySelector(".list")!
    const group = groupFor(detect(root), list)

    expect(group.items).toHaveLength(10)
    expect(group.confidence).toBeGreaterThanOrEqual(0.65)
  })

  it("does not let geometry alone clear the threshold", () => {
    // Ten identically-shaped but structurally unrelated boxes: perfect G,
    // nothing else. This has to fail.
    const boxes = Array.from(
      { length: 10 },
      (_, i) => `<div data-rect="0,${i * 60},700,50"></div>`
    ).join("")
    const root = html(
      `<div class="list" data-rect="0,0,700,600">${boxes}</div>`
    )

    // Assert the outcome, not the arithmetic. This used to read
    // `expect(group.signals.G * 0.35).toBeLessThan(0.65)`, which cannot fail:
    // `geometry()` returns clamp01, so G <= 1 and G * 0.35 <= 0.35 for every
    // possible input. The test passed while the behaviour it demanded did not
    // happen — these ten boxes were detected as a record set at 0.82.
    expect(detect(root)).toHaveLength(0)
  })
})

describe("wrapped card grid", () => {
  it("detects a 3x3 grid as one record set", () => {
    const cells: string[] = []
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        cells.push(
          `<div class="card" data-rect="${col * 220},${row * 170},200,150">` +
            `<img src="/i/${row}${col}.png" alt="thumb">` +
            `<h3>Card title ${row}${col}</h3>` +
            `<a href="/c/${row}${col}">Open this card</a>` +
            `</div>`
        )
      }
    }
    const root = html(
      `<div class="grid" data-rect="0,0,660,510">${cells.join("")}</div>`
    )

    const group = groupFor(detect(root), root.querySelector(".grid")!)
    expect(group.items).toHaveLength(9)
  })
})

describe("masonry", () => {
  it("detects variable-height columns despite irregular pitch", () => {
    // Three columns, staggered tops, heights 120-220. Vertical pitch is
    // deliberately irregular — this is the class the research spike's
    // pitch-gated detector could not have found at all.
    const layout: [number, number, number][] = [
      [0, 0, 180],
      [0, 200, 120],
      [0, 340, 220],
      [220, 0, 140],
      [220, 160, 220],
      [220, 400, 160],
      [440, 0, 220],
      [440, 240, 120],
      [440, 380, 200]
    ]
    const cells = layout
      .map(
        ([x, y, h], i) =>
          `<div class="card" data-rect="${x},${y},200,${h}">` +
          `<h3>Masonry card ${i}</h3><a href="/m/${i}">Open</a>` +
          `</div>`
      )
      .join("")
    const root = html(
      `<div class="masonry" data-rect="0,0,640,580">${cells}</div>`
    )

    const group = groupFor(detect(root), root.querySelector(".masonry")!)
    expect(group.items).toHaveLength(9)
    // Pitch regularity is genuinely poor here; the group survives on width
    // similarity, lattice alignment and subtree similarity instead.
    expect(group.signals.G).toBeLessThan(1)
    expect(group.confidence).toBeGreaterThanOrEqual(0.65)
  })
})

describe("virtualized feed", () => {
  it("detects rows whose DOM order does not match visual order", () => {
    // A recycling virtualizer reorders nodes and positions them with
    // transforms; getBoundingClientRect still reports true coordinates.
    const visualOrder = [3, 7, 1, 5, 0, 6, 2, 4]
    const rows = visualOrder
      .map(
        (slot, i) =>
          `<div class="row" data-key="${i}" data-rect="0,${slot * 80},700,70">` +
          `<a href="/v/${i}">Virtualized item number ${i} with a title</a>` +
          `</div>`
      )
      .join("")
    const root = html(`<div class="feed" data-rect="0,0,700,640">${rows}</div>`)

    const group = groupFor(detect(root), root.querySelector(".feed")!)
    expect(group.items).toHaveLength(8)
  })
})

describe("data table", () => {
  it("detects table rows as records", () => {
    const rows = Array.from(
      { length: 5 },
      (_, i) =>
        `<tr data-rect="0,${i * 30},600,28">` +
        `<td>Row ${i}</td><td>Value ${i}</td><td>2026-07-${10 + i}</td>` +
        `</tr>`
    ).join("")
    const root = html(
      `<table data-rect="0,0,600,150"><tbody data-rect="0,0,600,150">` +
        `${rows}</tbody></table>`
    )

    const group = groupFor(detect(root), root.querySelector("tbody")!)
    expect(group.items).toHaveLength(5)
  })
})

describe("nested discussion", () => {
  it("detects replies inside comments, not just top-level comments", () => {
    // The reason subtree-claiming was removed: <div>-based reply threads are
    // records inside records, and suppressing them flattens the thread.
    const comment = (i: number) => {
      const replies = Array.from(
        { length: 3 },
        (_, r) =>
          `<div class="reply" data-rect="40,${i * 400 + 100 + r * 90},660,80">` +
          `<a href="/u/r${i}${r}">replier${r}</a>` +
          `<p>A reply body that is long enough to look like prose.</p>` +
          `</div>`
      ).join("")
      return (
        `<div class="comment" data-rect="0,${i * 400},700,380">` +
        `<a href="/u/${i}">commenter${i}</a>` +
        `<p>A top level comment body with a reasonable amount of text.</p>` +
        `<div class="replies" data-rect="40,${i * 400 + 100},660,270">` +
        `${replies}</div></div>`
      )
    }
    const root = html(
      `<div class="thread" data-rect="0,0,700,1200">` +
        `${[0, 1, 2].map(comment).join("")}</div>`
    )

    const groups = detect(root)
    const top = groupFor(groups, root.querySelector(".thread")!)
    expect(top.items).toHaveLength(3)

    const nested = groups.filter((g) => g.container.className === "replies")
    expect(nested).toHaveLength(3)
    for (const group of nested) expect(group.items).toHaveLength(3)
  })

  it("suppresses a record's own columns", () => {
    // Three columns inside each row is the failure the research spike hit:
    // it returned cells instead of rows.
    const rows = Array.from({ length: 4 }, (_, i) => {
      const cols = [0, 1, 2]
        .map(
          (c) =>
            `<div class="col" data-rect="${c * 230},${i * 100},220,90">` +
            `<span>cell ${i}${c}</span></div>`
        )
        .join("")
      return `<div class="row" data-rect="0,${i * 100},700,90">${cols}</div>`
    }).join("")
    const root = html(`<div class="list" data-rect="0,0,700,400">${rows}</div>`)

    const groups = detect(root)
    expect(groupFor(groups, root.querySelector(".list")!).items).toHaveLength(4)
    expect(groups.some((g) => g.container.className === "row")).toBe(false)
  })
})

describe("article", () => {
  it("does not fragment prose into spurious record sets", () => {
    const paragraphs = Array.from(
      { length: 6 },
      (_, i) =>
        `<p data-rect="0,${i * 90},680,80">Paragraph ${i} of an article, ` +
        `with enough words to read like real prose rather than a row.</p>`
    ).join("")
    const root = html(
      `<article data-rect="0,0,680,540"><h1 data-rect="0,0,680,40">Title</h1>` +
        `${paragraphs}</article>`
    )

    // Paragraphs may well score as a repeated set, and that is harmless — the
    // tree keeps their `paragraph` role either way. What must not happen is a
    // group forming *inside* a paragraph.
    const groups = detect(root)
    expect(groups.every((g) => g.container.tagName !== "P")).toBe(true)
  })
})

describe("chrome rejection", () => {
  it("rejects a horizontal strip of short links", () => {
    const links = ["Home", "Docs", "Blog", "Pricing", "About"]
      .map(
        (label, i) =>
          `<a href="/${label.toLowerCase()}" data-rect="${i * 110},0,100,30">` +
          `${label}</a>`
      )
      .join("")
    const root = html(`<div class="tabs" data-rect="0,0,550,30">${links}</div>`)

    const groups = detect(root)
    expect(groups).toHaveLength(0)
  })

  it("never looks inside a nav landmark", () => {
    const items = Array.from(
      { length: 6 },
      (_, i) =>
        `<div data-rect="0,${i * 40},220,36">` +
        `<a href="/n/${i}">Navigation entry number ${i}</a></div>`
    ).join("")
    const root = html(`<nav data-rect="0,0,220,240">${items}</nav>`)

    expect(detect(root)).toHaveLength(0)
  })
})

describe("confidence", () => {
  it("reports the contributing signals", () => {
    const root = html(
      `<ul class="list" data-rect="0,0,700,300">` +
        Array.from(
          { length: 5 },
          (_, i) =>
            `<li data-rect="0,${i * 60},700,50">` +
            `<a href="/i/${i}">Item ${i} with a descriptive title</a></li>`
        ).join("") +
        `</ul>`
    )

    const group = groupFor(detect(root), root.querySelector(".list")!)
    // <ul>/<li> is unambiguous semantic evidence and must register.
    expect(group.signals.R).toBeGreaterThan(0.5)
    expect(group.signals.X).toBe(0)
    expect(group.confidence).toBeGreaterThan(0.7)
  })
})

describe("layout tables", () => {
  it("does not promote a layout table's own rows to records", () => {
    // Found on the live Hacker News page: the whole site is one outer layout
    // table, and its header/spacer/content rows are geometrically regular and
    // structurally alike, so they scored as a record set. The cursor opened on
    // the site header with the story list two levels beneath it.
    const stories = Array.from(
      { length: 6 },
      (_, i) =>
        `<tr class="athing" data-rect="0,${140 + i * 60},700,50">` +
        `<td><a href="/s/${i}">Story headline number ${i} goes here</a></td>` +
        `<td>meta</td><td>more meta</td></tr>`
    ).join("")

    const root = html(`
      <table id="outer" data-rect="0,0,700,600">
        <tbody data-rect="0,0,700,600">
          <tr data-rect="0,0,700,40"><td>Site header with several nav links</td></tr>
          <tr data-rect="0,50,700,40"><td>A spacer row of roughly equal size</td></tr>
          <tr data-rect="0,100,700,460"><td>
            <table class="itemlist" data-rect="0,100,700,460">
              <tbody data-rect="0,100,700,460">${stories}</tbody>
            </table>
          </td></tr>
        </tbody>
      </table>
    `)

    const groups = detect(root)

    // The outer table is layout: none of its scaffolding may form a group.
    const outerBody = root.querySelector("#outer > tbody")!
    expect(groups.some((g) => g.container === outerBody)).toBe(false)

    // The real story list still is one.
    const inner = root.querySelector(".itemlist > tbody")!
    expect(groupFor(groups, inner).items).toHaveLength(6)
  })
})
