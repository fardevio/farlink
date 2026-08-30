import { readFileSync } from "node:fs"

import { PANEL_CHROME } from "~/lib/ui/hud"
import { HUD_CSS } from "~/lib/ui/hud-css"

/**
 * The stylesheet is a template literal, so a backtick anywhere inside it ends
 * the string and produces a syntax error a hundred lines from its cause. It has
 * happened four times, always in a comment quoting a CSS variable or a key, and
 * a warning comment in the file did not prevent the fourth. This is the version
 * that cannot be ignored.
 */
describe("the HUD stylesheet source", () => {
  const source = readFileSync("lib/ui/hud-css.ts", "utf8")

  it("contains no backtick inside the literal", () => {
    const open = source.indexOf("HUD_CSS = `")
    const body = source.slice(open + "HUD_CSS = `".length)
    const end = body.indexOf("`")
    // The next backtick after the opening one must be the closing delimiter,
    // which is the last character of the file's final line.
    expect(body.slice(end).trim()).toBe("`")
  })
})

describe("the HUD stylesheet", () => {
  it("declares every color through a variable", () => {
    // A literal color cannot be themed, and six flavors are contrast-tested
    // on the variables rather than on whatever the sheet happens to hard-code.
    const literals = HUD_CSS.match(/#[0-9a-f]{3,8}\b/gi) ?? []
    const allowed = literals.filter((hex) =>
      // The panel's shadow and inset highlight are deliberately neutral.
      ["#fff", "#ffffff", "#000", "#000000"].includes(hex.toLowerCase())
    )
    expect(literals.filter((h) => !allowed.includes(h))).toEqual([])
  })
})

/**
 * The panel is sized to what a row holds, not to the viewport, so these numbers
 * are the whole layout. They cannot be checked in happy-dom, which has no font
 * metrics: every figure below was measured in Chromium against the real
 * stylesheet, and the point of the test is that narrowing a size past its floor
 * fails here instead of quietly clipping a key.
 */
describe("panel widths", () => {
  /** What the six-key bar needs to fit. It is held to one line, so under this
   *  the frame clips its last key rather than growing a second row. */
  const KEY_BAR_PX = 571
  /** Compact's cut-down three-key bar. */
  const COMPACT_KEY_BAR_PX = 282

  const declaration = (selector: string, property: string): string => {
    const rule = new RegExp(
      `${selector}\\s*\\{[^}]*?[\\s;{]${property}:\\s*([^;]+);`
    )
    const found = rule.exec(HUD_CSS)
    expect(found, `no ${property} found for ${selector}`).toBeTruthy()
    return found![1]!.trim()
  }

  const COMPACT = '\\.fl-frame\\[data-size="compact"\\]'
  const NORMAL = "\\.fl-frame"
  const FULL = '\\.fl-frame\\[data-size="full"\\]'

  it("declares a floor no narrower than the key bar needs", () => {
    // A vw preference alone does not do this: 52vw is 520px at a 1000px
    // viewport, under what the bar needs, and a key was clipped there.
    const floor = /--fl-floor:\s*(\d+)px/.exec(HUD_CSS)
    expect(floor, "no --fl-floor declared").toBeTruthy()
    expect(Number(floor![1])).toBeGreaterThanOrEqual(KEY_BAR_PX)
  })

  it("keeps compact wide enough for the three keys it does show", () => {
    const width = Number(/(\d+)px/.exec(declaration(COMPACT, "width"))![1])
    expect(width).toBeGreaterThanOrEqual(COMPACT_KEY_BAR_PX)
  })

  it("bounds every size by the viewport from one declaration", () => {
    // The media query that used to do this set the width outright rather than
    // bounding it, which made the panel widest on the narrowest screens: 862px
    // at a 900px viewport against 642px at 1736px. A max-width on the base rule
    // cannot invert like that, and no size has to remember it.
    expect(declaration(NORMAL, "max-width")).toBe(
      "calc(100% - var(--fl-gap) * 2)"
    )
    expect(HUD_CSS).not.toContain("@media (max-width: 900px)")
    for (const selector of [COMPACT, NORMAL, FULL]) {
      expect(declaration(selector, "width"), selector).not.toContain("100%")
    }
  })

  it("never lets the key bar grow to a second line", () => {
    // This is what makes SIZES.chrome in hud.ts true rather than hopeful: it is
    // a constant assuming one line, and a second line costs 28px of height the
    // row budget cannot see, so the panel draws a row too many and clips it.
    // Both declarations are load-bearing. With only flex-wrap the groups shrink
    // below their text, which wraps inside them, and the bar measured 32px at a
    // 600px viewport regardless.
    expect(declaration("\\.fl-footer", "flex-wrap")).toBe("nowrap")
    expect(declaration("\\.fl-footer", "white-space")).toBe("nowrap")
  })
})

describe("the panel's chrome height", () => {
  /**
   * The body of the top-level rule for `selector`.
   *
   * Anchored to the start of a line, because several selectors here also appear
   * as the tail of a descendant rule — `.fl-frame[data-mode="settings"]
   * .fl-status { display: none }` comes first in the sheet and carries none of
   * the box metrics.
   */
  const rule = (selector: string): string => {
    const found = new RegExp(`^\\${selector}\\s*\\{([^}]*)\\}`, "m").exec(
      HUD_CSS
    )
    expect(found, `${selector} rule not found in HUD_CSS`).toBeTruthy()
    return found![1]!
  }

  const px = (body: string, prop: string): number => {
    const found = new RegExp(`(?:^|;|\\s)${prop}:\\s*([0-9]+)px`).exec(body)
    expect(found, `${prop} not found`).toBeTruthy()
    return Number(found![1])
  }

  /**
   * The vertical total of a `padding` shorthand.
   *
   * Only the first value is read, which is the vertical one in every shorthand
   * form used here. Deliberately not requiring a unit on the second value:
   * `.fl-list` is `padding: 4px 0`, and demanding `0px` made this fail on a
   * rule that was perfectly correct.
   */
  const paddingY = (body: string): number => {
    const found = /(?:^|;|\s)padding:\s*([0-9]+)px/.exec(body)
    expect(found, "padding not found").toBeTruthy()
    return Number(found![1]) * 2
  }

  it("matches what the stylesheet actually lays out", () => {
    // PANEL_CHROME stands in for a measurement the panel cannot take of itself
    // — it is sized by its content, so measuring the list to decide how many
    // rows fit would be circular. Standing in for a measurement means it has to
    // track the stylesheet, and three hand-maintained versions of this number
    // had all drifted: 57 for compact and 81 for the other two, against a
    // measured 100. The panel drew rows past its own max-height.
    const header = rule(".fl-header")
    const status = rule(".fl-status")
    const footer = rule(".fl-footer")
    const list = rule(".fl-list")
    const frame = rule(".fl-frame")

    const total =
      px(header, "min-height") +
      paddingY(header) +
      1 + // + border-bottom
      px(status, "min-height") +
      paddingY(status) +
      1 + // + border-top
      px(footer, "line-height") +
      paddingY(footer) +
      1 + // + border-top
      paddingY(list) +
      2 // the frame's own top and bottom border

    expect(total, "HUD_CSS and PANEL_CHROME have drifted").toBe(PANEL_CHROME)
    // Guard on the guard: if a selector silently stopped matching, the sum
    // would collapse and still "pass" against a wrong constant.
    expect(frame).toContain("border")
  })
})
