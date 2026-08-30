import { readFileSync } from "node:fs"

import {
  applyFlavor,
  contrastRatio,
  DEFAULT_FLAVOR,
  findFlavor,
  FLAVORS,
  flavorVariables,
  MONO_STACK,
  nextFlavorId,
  resolveFlavor
} from "~/lib/ui/themes"
import type { Flavor, Palette } from "~/lib/ui/themes"

/**
 * Derived, not typed out. This list was maintained by hand beside the `Palette`
 * interface and had to be edited in lockstep with it; every flavor's palette
 * is checked against `Palette` at compile time, so the first flavor's keys are
 * already an authoritative list, and the per-flavor test below holds every
 * other flavor to them.
 */
const PALETTE_KEYS = Object.keys(FLAVORS[0]!.palette) as (keyof Palette)[]

const HEX = /^#[0-9a-f]{6}$/

/** Foreground/background pairs that carry text and must stay legible. */
const TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
  ["fg", "bg"],
  ["accentFg", "accent"],
  ["cursorFg", "cursor"]
]

const ratio = (flavor: Flavor, fg: keyof Palette, bg: keyof Palette) =>
  contrastRatio(flavor.palette[fg], flavor.palette[bg])

describe("FLAVORS", () => {
  it("defines no color that nothing reads", () => {
    // `mark`, `hint` and `hintFg` outlived the features that drew them by
    // three weeks, carried by every flavor. The per-flavor test below proves
    // a key exists everywhere; it cannot prove anything wants it. This is the
    // other direction. Consumers are the stylesheet and the one module that
    // sets a variable directly, so both are scanned.
    const consumers = ["lib/ui/hud-css.ts", "lib/ui/highlight.ts"]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")
    const used = new Set(
      [...consumers.matchAll(/--fl-([a-z]+(?:-[a-z]+)*)/g)].map((match) =>
        match[1]!.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
      )
    )
    expect([...PALETTE_KEYS].filter((key) => !used.has(key))).toEqual([])
  })

  it.each(FLAVORS)("$id defines every palette key as a hex color", (flavor) => {
    expect(Object.keys(flavor.palette).sort()).toEqual([...PALETTE_KEYS].sort())
    for (const key of PALETTE_KEYS) {
      expect(flavor.palette[key]).toMatch(HEX)
    }
  })

  it("gives every flavor an id, a name and a scheme", () => {
    for (const flavor of FLAVORS) {
      expect(flavor.id).toMatch(/^[a-z]+$/)
      expect(flavor.name.length).toBeGreaterThan(0)
      expect(["dark", "light"]).toContain(flavor.scheme)
    }
  })

  it("keeps flavor ids unique", () => {
    const ids = FLAVORS.map((flavor) => flavor.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("lists far first, because it is the default", () => {
    expect(FLAVORS[0]!.id).toBe("far")
    expect(DEFAULT_FLAVOR).toBe("far")
    expect(FLAVORS[0]!.id).toBe(DEFAULT_FLAVOR)
  })
})

describe("contrastRatio", () => {
  it("gives 21:1 for white on black, either way round", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 10)
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10)
  })

  it("gives 1:1 for a color against itself", () => {
    expect(contrastRatio("#3a96dd", "#3a96dd")).toBeCloseTo(1, 10)
  })

  it("matches hand-computed mid-gray pairs", () => {
    // #808080: channel = ((128/255 + 0.055) / 1.055) ** 2.4 = 0.2158587,
    // and the three weights sum to 1, so L = 0.2158587.
    //   vs white: 1.05 / 0.2658587      = 3.9495
    //   vs black: 0.2658587 / 0.05      = 5.3172
    expect(contrastRatio("#808080", "#ffffff")).toBeCloseTo(3.9495, 3)
    expect(contrastRatio("#808080", "#000000")).toBeCloseTo(5.3172, 3)
  })

  it("uses the linear ramp below the 0.03928 knee", () => {
    // #0a0a0a: 10/255 = 0.039216 <= 0.03928, so L = 0.039216 / 12.92.
    expect(contrastRatio("#0a0a0a", "#000000")).toBeCloseTo(1.0607, 3)
  })

  it("tolerates uppercase hex", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 10)
  })
})

describe("flavor contrast", () => {
  it.each(FLAVORS)("$id clears AA for body text", (flavor) => {
    expect(ratio(flavor, "fg", "bg")).toBeGreaterThanOrEqual(4.5)
  })

  it.each(FLAVORS)("$id clears AA for every text pair", (flavor) => {
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(ratio(flavor, fg, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("really does clear AAA everywhere the contrast flavor claims", () => {
    const contrast = findFlavor("contrast")
    expect(contrast.id).toBe("contrast")
    // Measured, not taken on faith from the comment in palettes.ts.
    expect(ratio(contrast, "fg", "bg")).toBeCloseTo(21, 4)
    expect(ratio(contrast, "cursorFg", "cursor")).toBeCloseTo(16.748, 2)
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(ratio(contrast, fg, bg)).toBeGreaterThanOrEqual(7)
    }
    expect(ratio(contrast, "dim", "bg")).toBeGreaterThanOrEqual(7)
    expect(ratio(contrast, "warn", "bg")).toBeGreaterThanOrEqual(7)
  })
})

describe("findFlavor", () => {
  it("finds a flavor by id", () => {
    expect(findFlavor("catppuccin").name).toBe("Catppuccin Mocha")
    expect(findFlavor("paper").scheme).toBe("light")
  })

  it("falls back to the default for an unknown id", () => {
    expect(findFlavor("nope")).toBe(FLAVORS[0])
    expect(findFlavor("")).toBe(FLAVORS[0])
  })
})

describe("resolveFlavor", () => {
  it("passes a concrete id straight through", () => {
    expect(resolveFlavor("catppuccin").id).toBe("catppuccin")
  })

  it("resolves auto against the user's color scheme", () => {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches
    expect(resolveFlavor("auto").id).toBe(prefersDark ? "far" : "paper")
  })

  it("honours the auto overrides", () => {
    expect(resolveFlavor("auto", "catppuccin", "paper").id).toBe(
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "catppuccin"
        : "paper"
    )
  })
})

describe("flavorVariables", () => {
  it("kebab-cases camelCase palette keys", () => {
    const vars = flavorVariables(findFlavor("far"))
    expect(vars["--fl-bg-alt"]).toBe("#000088")
    expect(vars["--fl-accent-fg"]).toBe("#000000")
    expect(vars["--fl-cursor-fg"]).toBe("#000000")
    expect(vars["--fl-bg"]).toBe("#0000aa")
    expect(vars["--fl-fg"]).toBe("#55ffff")
  })

  it("emits one variable per palette key plus the font", () => {
    for (const flavor of FLAVORS) {
      const vars = flavorVariables(flavor)
      expect(Object.keys(vars)).toHaveLength(PALETTE_KEYS.length + 1)
      expect(vars["--fl-font"]).toBe(MONO_STACK)
      for (const name of Object.keys(vars)) {
        expect(name).toMatch(/^--fl-[a-z]+(-[a-z]+)?$/)
      }
    }
  })
})

describe("applyFlavor", () => {
  it("writes the custom properties and the scheme onto the host", () => {
    const host = document.createElement("div")
    applyFlavor(host, findFlavor("catppuccin"))
    expect(host.style.getPropertyValue("--fl-bg")).toBe("#1e1e2e")
    expect(host.style.getPropertyValue("--fl-accent-fg")).toBe("#1e1e2e")
    expect(host.dataset.scheme).toBe("dark")

    applyFlavor(host, findFlavor("paper"))
    expect(host.style.getPropertyValue("--fl-bg")).toBe("#fbfaf7")
    expect(host.dataset.scheme).toBe("light")
  })
})

/**
 * One test per property, not one per flavor.
 *
 * These looped over FLAVORS to make 26 separate cases, which reported as 26
 * tests for two facts. The loop is inside now and each assertion names the
 * flavor it is about, so a failure still says which palette broke.
 */
describe("readable text in every flavor", () => {
  it("clears AA for dim and warn on both backgrounds", () => {
    // `dim` carries role labels, child counts and footer hints; `warn` carries
    // the degraded-anchor notice, which a user must not misread. Both are
    // ordinary-size text, so both owe 4.5:1. This is the reason three palettes
    // deviate from their source schemes — see the comments there.
    for (const { id, palette } of FLAVORS) {
      const { bg, bgAlt, dim, warn, fg } = palette
      expect(contrastRatio(fg, bg), `${id} fg on bg`).toBeGreaterThanOrEqual(
        4.5
      )
      expect(contrastRatio(dim, bg), `${id} dim on bg`).toBeGreaterThanOrEqual(
        4.5
      )
      expect(
        contrastRatio(warn, bg),
        `${id} warn on bg`
      ).toBeGreaterThanOrEqual(4.5)
      // The header sits on bgAlt, and both of those appear there too.
      expect(
        contrastRatio(dim, bgAlt),
        `${id} dim on bgAlt`
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(warn, bgAlt),
        `${id} warn on bgAlt`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps the cursor row and the accent chip legible", () => {
    for (const { id, palette } of FLAVORS) {
      const { cursor, cursorFg, accent, accentFg } = palette
      expect(
        contrastRatio(cursorFg, cursor),
        `${id} cursor`
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(accentFg, accent),
        `${id} accent`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe("nextFlavorId", () => {
  it("steps through the list and wraps", () => {
    const ids = FLAVORS.map((f) => f.id)
    let id = ids[0]!
    const seen = [id]
    for (let i = 1; i < ids.length; i++) {
      id = nextFlavorId(id, id)
      seen.push(id)
    }
    expect(seen).toEqual(ids)
    expect(nextFlavorId(ids[ids.length - 1]!, "")).toBe(ids[0])
  })

  it("steps off the resolved flavor when set to auto", () => {
    // Otherwise the first press looks like it skipped one: "auto" is not in the
    // list, so a naive lookup returns -1 and lands on index 0.
    expect(nextFlavorId("auto", "far")).toBe(FLAVORS[1]!.id)
    expect(nextFlavorId("auto", "paper")).toBe(
      FLAVORS[FLAVORS.findIndex((f) => f.id === "paper") + 1]!.id
    )
  })
})

describe("the flavor list stays extensible", () => {
  it("needs nothing but a palette to add one", () => {
    // Every check in this file iterates FLAVORS, so a new entry is contrast-
    // tested, key-checked and hex-validated without touching a test. This
    // asserts that property rather than trusting it.
    expect(FLAVORS.length).toBeGreaterThanOrEqual(12)
    for (const flavor of FLAVORS) {
      expect(Object.keys(flavor)).toEqual(["id", "name", "scheme", "palette"])
    }
  })
})
