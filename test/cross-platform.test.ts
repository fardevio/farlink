import { readdirSync, readFileSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"

import { altLabel } from "~/lib/platform"
import { ROW_HEIGHT } from "~/lib/ui/hud"
import { HUD_CSS } from "~/lib/ui/hud-css"
import { MONO_STACK } from "~/lib/ui/themes"
import { MANIFEST } from "~/manifest"

/**
 * The cross-platform invariants, held in one place.
 *
 * `lib/platform.ts` covers the *behaviour* that differs by OS and is tested
 * next to itself. What is left is a set of facts that are only wrong on a
 * machine the author does not have: a font stack that names no face the host
 * ships, a command with no binding outside macOS, a row height that drifted
 * from the stylesheet. Each is silent locally and obvious to the one user on
 * the platform it broke.
 */

describe("the font stack names a real face on each platform", () => {
  // A generic `monospace` alone would work everywhere and look like whatever
  // the browser defaults to, which on Windows is Courier New. The point of the
  // stack is that each platform reaches something modern before the fallback.
  const families = MONO_STACK.split(",").map((f) => f.trim().replace(/"/g, ""))

  const shipped: Record<string, string[]> = {
    // Menlo has been on macOS since 10.6; SF Mono is the newer default.
    macOS: ["SF Mono", "Menlo"],
    // Consolas ships with every Windows since Vista, Cascadia with 11.
    Windows: ["Cascadia Mono", "Consolas"],
    // DejaVu Sans Mono is the near-universal default on desktop Linux.
    Linux: ["DejaVu Sans Mono"]
  }

  for (const [platform, faces] of Object.entries(shipped)) {
    it(`${platform} reaches ${faces.join(" or ")}`, () => {
      expect(faces.some((face) => families.includes(face))).toBe(true)
    })
  }

  it("still ends in the generic family", () => {
    expect(families.at(-1)).toBe("monospace")
  })
})

describe("every command is bindable off macOS", () => {
  const commands = MANIFEST.commands as Record<string, unknown>

  it("declares commands", () => {
    expect(commands).toBeTruthy()
  })

  for (const [name, value] of Object.entries(commands ?? {})) {
    const command = value as { suggested_key?: Record<string, string> }
    const suggested = command.suggested_key

    it(`${name}: a suggested default covers Windows and Linux, or none does`, () => {
      // `mac` alone would leave Windows and Linux users with a command that
      // appears in chrome://extensions/shortcuts with no key attached, which
      // reads as broken rather than as unbound. Either both or neither.
      if (!suggested) return
      expect(Object.keys(suggested)).toContain("default")
    })
  }
})

describe("altLabel", () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis.navigator,
    "userAgentData"
  )

  const setPlatform = (platform: string) => {
    Object.defineProperty(globalThis.navigator, "userAgentData", {
      value: { platform },
      configurable: true
    })
  }

  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis.navigator, "userAgentData", original)
    } else {
      // @ts-expect-error -- removing a property the platform does not define
      delete globalThis.navigator.userAgentData
    }
  })

  it("says Opt on macOS and Alt everywhere else", () => {
    setPlatform("macOS")
    expect(altLabel()).toBe("Opt+")
    for (const platform of ["Windows", "Linux", "Chrome OS"]) {
      setPlatform(platform)
      expect(altLabel(), platform).toBe("Alt+")
    }
  })
})

describe("row height", () => {
  it("matches the .fl-row rule the browser actually lays out", () => {
    // Read from the stylesheet rather than restated, so the test fails when
    // they diverge instead of when someone remembers to update it.
    const rule = /\.fl-row\s*\{[^}]*?height:\s*(\d+)px/.exec(HUD_CSS)
    expect(rule, ".fl-row height rule not found in HUD_CSS").toBeTruthy()
    expect(Number(rule![1])).toBe(ROW_HEIGHT)
  })
})

/**
 * Every shipping source file, found by walking rather than listed.
 *
 * The three tests below each promise something about "no source file", and each
 * used to read a hardcoded list of three or four paths. That is the right idiom
 * pointed at the wrong scope: the list cannot grow with the codebase, so adding
 * `navigator.clipboard.writeText` to lib/ui/column.ts or
 * `permissions.request` to lib/dom/records.ts left the suite fully green while
 * the stated guarantee was false. Both were verified to pass unnoticed.
 *
 * Test files are excluded deliberately — the harness builds its fixtures with
 * `innerHTML` — and so is anything under scripts/, which is build tooling that
 * never ships in the package.
 */
function shippingSources(): { file: string; source: string }[] {
  const out: { file: string; source: string }[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        walk(path)
      } else if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts")
      ) {
        out.push({ file: path, source: readFileSync(path, "utf8") })
      }
    }
  }
  walk("lib")
  walk("entrypoints")
  out.push({ file: "manifest.ts", source: readFileSync("manifest.ts", "utf8") })
  return out
}

describe("the injected bundle name", () => {
  it("matches the entrypoint WXT builds it from", () => {
    // This is the whole product. The manifest declares no content scripts, so
    // `executeScript({ files: [CONTENT_SCRIPT] })` is the only way any FarLink
    // code ever reaches a page — and WXT derives that filename from the
    // entrypoint *directory*, so renaming the directory silently breaks it.
    //
    // Nothing guarded it: pointing CONTENT_SCRIPT at a nonexistent bundle left
    // the suite fully green. The failure is swallowed by ensureInjected's catch
    // into a console.warn, so the panel simply never appears, on every page.
    const source = readFileSync("entrypoints/background.ts", "utf8")
    const declared = /const CONTENT_SCRIPT = "([^"]+)"/.exec(source)
    expect(declared, "CONTENT_SCRIPT not found in background.ts").toBeTruthy()

    const contentDirs = readdirSync("entrypoints", { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith(".content"))
      .map((e) => e.name.replace(/\.content$/, ""))
    expect(contentDirs, "expected exactly one content entrypoint").toHaveLength(
      1
    )
    expect(declared![1]).toBe(`content-scripts/${contentDirs[0]}.js`)
  })
})

describe("shipping source invariants", () => {
  // A guard on the guard: if the walk ever finds nothing, every test below
  // passes vacuously and says so loudly instead.
  it("finds the source tree", () => {
    const files = shippingSources()
    expect(files.length, "walk found no source").toBeGreaterThan(20)
    expect(files.map((f) => f.file)).toContain("lib/ui/column.ts")
    expect(files.map((f) => f.file)).toContain("entrypoints/background.ts")
  })

  it("never requests a permission at runtime", () => {
    // There is no site access to request, and adding a request would be the
    // first step to having some. The manifest test covers the declaration; this
    // covers the code that could ask for one at runtime.
    for (const { file, source } of shippingSources()) {
      expect(source, file).not.toMatch(/permissions\s*\.\s*request/)
    }
  })

  it("never touches the clipboard", () => {
    // Five documents promise this: CONTRIBUTING as a settled decision,
    // SECURITY.md and CHANGELOG.md as a property, store/listing.md as published
    // copy, and store/privacy.md in a section of its own. A fallback path is not
    // worth reversing all five.
    for (const { file, source } of shippingSources()) {
      // The APIs, not the word: several files explain the decision in prose, and
      // a test that trips over its own rationale is noise rather than a guard.
      expect(source, file).not.toMatch(/navigator\s*\.\s*clipboard/)
      expect(source, file).not.toMatch(/ClipboardItem|clipboardWrite/)
      expect(source, file).not.toMatch(/execCommand/)
    }
  })

  it("never writes page-controlled strings as markup", () => {
    // lib/ui/hud.ts and lib/ui/column.ts both carry a comment saying there is no
    // innerHTML here and there must never be, because accessible names are
    // attacker-controlled and this code runs in the isolated world that holds
    // `chrome.runtime`. Nothing asserted it: swapping column.ts's
    // `target.textContent = text` for `innerHTML` left the suite green.
    //
    // Matched as assignments and calls so the two explanatory comments do not
    // trip it.
    for (const { file, source } of shippingSources()) {
      expect(source, file).not.toMatch(/\.\s*(?:inner|outer)HTML\s*=/)
      expect(source, file).not.toMatch(/insertAdjacentHTML|\.\s*setHTML\s*\(/)
      expect(source, file).not.toMatch(/createContextualFragment/)
    }
  })
})
