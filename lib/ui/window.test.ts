import { windowStart } from "~/lib/ui/column"
import { badgeText, shortcutLabel } from "~/lib/ui/hud"

const ROWS = 20

describe("windowStart", () => {
  it("shows the whole list when it fits", () => {
    expect(windowStart(0, 8, 5, ROWS)).toBe(0)
    expect(windowStart(4, 8, 5, ROWS)).toBe(0)
  })

  it("holds still while the cursor moves inside the window", () => {
    // The point of not centering: Down moves the cursor, not the list.
    let start = 0
    for (let cursor = 0; cursor <= ROWS - 4; cursor++) {
      start = windowStart(start, 500, cursor, ROWS)
      expect(start).toBe(0)
    }
  })

  it("scrolls once the cursor reaches the bottom margin", () => {
    const start = windowStart(0, 500, ROWS - 3, ROWS)
    expect(start).toBe(1)
  })

  it("scrolls back up at the top margin", () => {
    // Sitting at row 40 with the window at 30; moving to 32 hits the margin.
    expect(windowStart(30, 500, 32, ROWS)).toBe(29)
  })

  it("never scrolls past the end of the list", () => {
    expect(windowStart(0, 25, 24, ROWS)).toBe(5)
    expect(windowStart(500, 25, 24, ROWS)).toBe(5)
  })

  it("clamps a window left behind by a shorter list", () => {
    // Filtering cuts 500 rows to 25 while the window sat at 300.
    expect(windowStart(300, 25, -1, ROWS)).toBe(5)
  })

  it("keeps a margin even in a very short panel", () => {
    // maxRows of 3 cannot honour a margin of 3 without pinning the cursor.
    expect(windowStart(0, 500, 2, 3)).toBe(1)
  })
})

describe("badgeText", () => {
  it("names what happened to the page, not the mechanism", () => {
    expect(badgeText("degraded")).toBe("page changed")
    expect(badgeText("lost")).toBe("selection lost")
  })

  it("never leaks the word anchor, which means <a> on the web", () => {
    for (const quality of ["exact", "confident", "degraded", "lost"] as const) {
      expect(badgeText(quality) ?? "").not.toMatch(/anchor/i)
    }
  })

  it("says nothing when the row was found", () => {
    expect(badgeText("exact")).toBeNull()
    expect(badgeText("confident")).toBeNull()
  })
})

describe("shortcutLabel", () => {
  it("reports the chord Chrome gave us", () => {
    expect(shortcutLabel({ value: "⌘⇧Space" }, false)).toBe("⌘⇧Space")
  })

  it("says not bound only on Chrome's own authority", () => {
    // An empty string is a real answer: the command exists with no key.
    expect(shortcutLabel({ value: "" }, false)).toBe("not bound — Enter to set")
  })

  it("does not call an unanswered question unbound", () => {
    // The bug this replaces: a failed round-trip printed "not bound" while
    // Cmd+Shift+Space was working, and the retry guard then latched it for the
    // rest of the page. Unknown and unbound are different facts.
    expect(shortcutLabel(null, false)).toBe("unknown — Enter to check")
    expect(shortcutLabel(null, false)).not.toContain("not bound")
  })

  it("says so while the question is outstanding", () => {
    expect(shortcutLabel(null, true)).toBe("checking…")
  })
})
