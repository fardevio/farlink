import {
  isAltGraph,
  isCharacterProduction,
  isLetterChord
} from "~/lib/platform"

const event = (init: Partial<KeyboardEvent>) =>
  ({
    code: "",
    key: "",
    getModifierState: () => false,
    ...init
  }) as KeyboardEvent

describe("isLetterChord", () => {
  it("matches the physical key, which is what a chord means", () => {
    // The bug this exists for: on macOS Option+T arrives as "†", so a chord
    // matched on `key` alone silently never fires. Both chords were dead.
    expect(isLetterChord(event({ code: "KeyT", key: "†" }), "t")).toBe(true)
    expect(isLetterChord(event({ code: "KeyZ", key: "Ω" }), "z")).toBe(true)
  })

  it("still matches the character where the platform leaves it alone", () => {
    expect(isLetterChord(event({ code: "", key: "t" }), "t")).toBe(true)
    expect(isLetterChord(event({ code: "", key: "T" }), "t")).toBe(true)
  })

  it("does not match a different key", () => {
    expect(isLetterChord(event({ code: "KeyY", key: "y" }), "t")).toBe(false)
    expect(isLetterChord(event({ code: "Enter", key: "Enter" }), "t")).toBe(
      false
    )
  })

  it("binds one physical key to one chord on a remapped layout", () => {
    // On Dvorak the key at QWERTY's T position produces "y". This used to be
    // `code || key`, so that single press matched the `t` chord by code *and*
    // the `y` chord by key: the key labelled Y silently cycled the theme, and
    // every letter chord was double-bound. The position wins, which is the rule
    // the README and docs/architecture.md both state.
    const dvorakT = event({ code: "KeyT", key: "y" })
    expect(isLetterChord(dvorakT, "t"), "position matches").toBe(true)
    expect(isLetterChord(dvorakT, "y"), "character must not also match").toBe(
      false
    )

    // And the converse: the key that actually produces "t" on Dvorak sits at
    // QWERTY's Y position, so it must not claim the `t` chord.
    const dvorakY = event({ code: "KeyY", key: "t" })
    expect(isLetterChord(dvorakY, "t")).toBe(false)
    expect(isLetterChord(dvorakY, "y")).toBe(true)
  })
})

describe("isAltGraph and isCharacterProduction", () => {
  // These branch on the platform, which the suite cannot change, so each case
  // asserts whichever behavior is correct for the platform it runs on.
  const mac = /^mac/i.test(navigator.platform)

  it("reads Ctrl+Alt as AltGr off macOS, and as nothing on it", () => {
    const altGr = event({ ctrlKey: true, altKey: true, key: "\\" })
    expect(isAltGraph(altGr)).toBe(!mac)
  })

  it("is not fooled by Ctrl or Alt alone", () => {
    expect(isAltGraph(event({ ctrlKey: true }))).toBe(false)
    expect(isAltGraph(event({ altKey: true }))).toBe(false)
    expect(isAltGraph(event({}))).toBe(false)
  })

  it("treats an Alt-produced character as typing on macOS", () => {
    // Option+Shift+7 is `\` on a Mac German layout: Option is typing here.
    const typed = event({ altKey: true, code: "Digit7", key: "\\" })
    expect(isCharacterProduction(typed)).toBe(mac)
  })

  it("does not treat a bare Alt+letter chord as typing", () => {
    const chord = event({ altKey: true, code: "KeyT", key: "t" })
    expect(isCharacterProduction(chord)).toBe(false)
  })
})
