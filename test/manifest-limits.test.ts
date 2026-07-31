import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { DEFAULT_FLAVOR, findFlavor } from "~/lib/ui/themes"
import {
  assertStoreLimits,
  ICON_SIZES,
  MANIFEST,
  STORE_LIMITS
} from "~/manifest"

/**
 * The Chrome Web Store enforces length limits on three manifest fields, and it
 * enforces them at upload — long after `pnpm check` and `pnpm zip` have both
 * reported success. `name` shipped at 49 characters against a limit of 45 for
 * a full day without anything noticing, because nothing in the build looked at
 * these. The listing file even documented the right limit next to a wrong
 * count of the string it was describing.
 *
 * Counting is the sort of thing a machine should do. The build hook calls
 * `assertStoreLimits` on the generated manifest so `pnpm zip` cannot produce a
 * package that will be rejected; this file is the fast, precisely-labelled
 * version of the same check for the dev loop.
 */
describe("manifest store limits", () => {
  for (const [field, limit] of Object.entries(STORE_LIMITS)) {
    it(`${field} is at most ${limit} characters`, () => {
      const value = MANIFEST[field as keyof typeof STORE_LIMITS]
      expect(value, `${field} is missing from the manifest`).toBeTruthy()
      expect(
        value.length,
        `${field} is ${value.length} characters: ${JSON.stringify(value)}`
      ).toBeLessThanOrEqual(limit)
    })
  }
})

describe("assertStoreLimits", () => {
  it("passes the manifest as authored", () => {
    expect(() => assertStoreLimits(MANIFEST)).not.toThrow()
  })

  it("throws with the field, the count and the limit", () => {
    // The build hook's failure has to be self-explanatory: it fires during
    // `pnpm zip`, where there is no test name to read.
    expect(() =>
      assertStoreLimits({ ...MANIFEST, name: "x".repeat(46) })
    ).toThrow(
      /manifest\.name is 46 characters; the Chrome Web Store limit is 45/
    )
  })
})

describe("permission posture", () => {
  /**
   * The install prompt is the promise this project is built around, and these
   * three fields decide it. There is exactly one way into a page, the command
   * or the toolbar button, and both are `activeTab`. Any site access at all,
   * required or optional, changes the prompt and breaks the promise.
   */
  const manifest = MANIFEST as Record<string, unknown>

  it("asks for nothing beyond storage, scripting and activeTab", () => {
    expect(manifest.permissions).toEqual(["storage", "scripting", "activeTab"])
  })

  it("declares no required host permissions, so the prompt stays empty", () => {
    expect(manifest.host_permissions).toBeUndefined()
  })

  it("declares no optional host permissions either", () => {
    expect(manifest.optional_host_permissions).toBeUndefined()
  })
})

/**
 * One command, and it is Chrome's own.
 *
 * Declaring an `action` makes Chrome list `_execute_action` in the shortcuts
 * editor whether we declare it or not, and with no popup it fires
 * `action.onClicked`. A named toggle command alongside it was a second row and
 * a second code path for the same behaviour.
 */
describe("the command surface", () => {
  it("binds the key to Chrome's action command and declares no other", () => {
    expect(Object.keys(MANIFEST.commands)).toEqual(["_execute_action"])
  })

  it("suggests a key off macOS as well as on it", () => {
    // A command with only a `mac` binding shows up with no key attached
    // everywhere else, which reads as broken rather than unbound.
    const keys = MANIFEST.commands._execute_action.suggested_key
    expect(keys.default).toBeTruthy()
    expect(keys.mac).toBeTruthy()
  })

  it("has no popup, so the key reaches action.onClicked", () => {
    // With a default_popup the chord would open a menu instead of running the
    // click handler, and the panel would never toggle.
    expect(MANIFEST.action).not.toHaveProperty("default_popup")
  })
})

/**
 * The icon is pixel art rendered once per size. Chrome resamples whenever it
 * wants a size that is not there, and resampling is exactly what the per-size
 * rendering exists to avoid — a 48px file feeding a smaller slot is what made it
 * look broken. So the manifest, the generator and the files on disk all have to
 * name the same set.
 */
describe("icon sizes", () => {
  const declared = Object.keys(ICON_SIZES)
    .map(Number)
    .sort((a, b) => a - b)

  it("covers the sizes Chrome asks for", () => {
    // 16/48/128 are the documented `icons` slots and 16/24/32 the recommended
    // action ones. 96 is the management page's 48px slot on a 2x display, which
    // Chrome would otherwise scale down from 128.
    for (const size of [16, 24, 32, 48, 96, 128]) {
      expect(declared, `no ${size}px icon`).toContain(size)
    }
  })

  it("matches what the generator emits", () => {
    const script = readFileSync("scripts/make-icons.mjs", "utf8")
    const listed = /const SIZES = \[([^\]]+)\]/.exec(script)
    expect(listed, "SIZES not found in make-icons.mjs").toBeTruthy()
    const generated = listed![1]!
      .split(",")
      .map((n) => Number(n.trim()))
      .sort((a, b) => a - b)
    expect(generated).toEqual(declared)
  })

  it("paints the background in the default theme's panel colour", () => {
    // The icon restates a colour that lives in the palette. It cannot read it:
    // the generator is plain Node and the palette is TypeScript. So the copy is
    // held here instead, the same arrangement ROW_HEIGHT uses against the
    // stylesheet. Retuning the far palette without this would leave the toolbar
    // a shade off the panel it opens, which nothing else would catch.
    const script = readFileSync("scripts/make-icons.mjs", "utf8")
    const blue = /const BLUE = "(#[0-9a-fA-F]{6})"/.exec(script)
    expect(blue, "BLUE not found in make-icons.mjs").toBeTruthy()
    expect(blue![1]!.toLowerCase()).toBe(
      findFlavor(DEFAULT_FLAVOR).palette.bg.toLowerCase()
    )
  })

  it("has a file for every size it declares", () => {
    for (const [size, path] of Object.entries(ICON_SIZES)) {
      const file = join("public", path)
      expect(existsSync(file), `${file} missing`).toBe(true)
      // A wrong-sized file is worse than a missing one: Chrome scales it and
      // the pixel grid dies, which is the whole defect being guarded.
      const png = readFileSync(file)
      // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
      expect(png.readUInt32BE(16), `${file} width`).toBe(Number(size))
      expect(png.readUInt32BE(20), `${file} height`).toBe(Number(size))
    }
  })
})
