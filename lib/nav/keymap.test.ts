import { Keymap } from "~/lib/nav/keymap"
import { NavSession } from "~/lib/nav/session"
import { html, recordingHost } from "~/test/harness"

function setup(count = 5) {
  const rows = Array.from(
    { length: count },
    (_, i) =>
      `<div class="row" data-rect="0,${i * 60},700,50">` +
      `<a href="https://example.com/s/${i}">Story headline number ${i}</a>` +
      `</div>`
  ).join("")
  const root = html(`<div class="list" data-rect="0,0,700,400">${rows}</div>`)

  const { host, opened, revealed, scroll } = recordingHost()

  const session = new NavSession(host, root)
  session.open()

  const exits: number[] = []
  const keymap = new Keymap(session, {
    onExit: () => exits.push(1)
  })

  return { session, keymap, opened, exits, revealed, scroll }
}

function press(
  keymap: Keymap,
  key: string,
  modifiers: Partial<KeyboardEventInit> = {}
): boolean {
  const event = new KeyboardEvent("keydown", { key, ...modifiers })
  // State the modifier map rather than inheriting the environment's default.
  //
  // happy-dom >= 20 answers getModifierState("AltGraph") with whatever altKey
  // is, so a plain Alt chord reports AltGr, isCharacterProduction() calls it a
  // typed character, and every Alt chord in the suite goes dead. A real browser
  // reports AltGraph only when AltGr is actually held. This is what
  // platform.test.ts has always done for the same reason.
  //
  // The AltGr cases below stay honest: they pass {ctrlKey, altKey}, which
  // isAltGraph() reads through its own ctrl+alt fallback, not through here.
  Object.defineProperty(event, "getModifierState", {
    value: () => false,
    configurable: true
  })
  return keymap.handle(event as KeyboardEvent)
}

describe("normal mode", () => {
  it("moves on the arrow keys and consumes them", () => {
    const { session, keymap } = setup()

    expect(press(keymap, "ArrowDown")).toBe(true)
    expect(session.project().cursorIndex).toBe(1)

    expect(press(keymap, "ArrowUp")).toBe(true)
    expect(session.project().cursorIndex).toBe(0)
  })

  it("treats letters as the start of a search, never as movement", () => {
    // j/k/h/l were the vim layer. Letters belong to whatever the user is
    // trying to type, and now every one of them starts filtering with itself.
    for (const key of ["j", "k", "h", "l", "g", "G"]) {
      const { session, keymap } = setup()
      expect(press(keymap, key)).toBe(true)
      expect(session.project().mode).toBe("filter")
      expect(session.project().filter).toBe(key)
    }
  })

  it("jumps to the ends with Home and End", () => {
    const { session, keymap } = setup()
    press(keymap, "End")
    expect(session.project().cursorIndex).toBe(4)
    press(keymap, "Home")
    expect(session.project().cursorIndex).toBe(0)
  })

  it("leaves modifier chords to the page and the browser", () => {
    const { keymap } = setup()
    expect(press(keymap, "ArrowDown", { ctrlKey: true })).toBe(false)
    expect(press(keymap, "l", { metaKey: true })).toBe(false)
    expect(press(keymap, "k", { altKey: true })).toBe(false)
  })

  it("consumes printable keys but leaves unbound named keys to the page", () => {
    const { keymap } = setup()
    // A letter is ours — it starts a search, so it must not also reach the page.
    expect(press(keymap, "q")).toBe(true)
    // A function key is not ours; let it through.
    expect(press(keymap, "F5")).toBe(false)
    expect(press(keymap, "Tab")).toBe(false)
  })
})

describe("mode transitions", () => {
  it("Escape leaves navigation", () => {
    const { keymap, exits } = setup()
    expect(press(keymap, "Escape")).toBe(true)
    expect(exits).toHaveLength(1)
  })

  it("typing enters filter mode and keeps the first character", () => {
    const { session, keymap } = setup()
    expect(session.project().mode).toBe("normal")

    // No `/` first: the character that starts the search is part of it.
    press(keymap, "n")
    expect(session.project().mode).toBe("filter")
    expect(session.project().filter).toBe("n")

    for (const char of "umber 3") press(keymap, char)
    expect(session.project().filter).toBe("number 3")
    expect(session.project().items).toHaveLength(1)

    press(keymap, "Backspace")
    expect(session.project().filter).toBe("number ")

    press(keymap, "Escape")
    expect(session.project().mode).toBe("normal")
    expect(session.project().items).toHaveLength(5)
  })

  it("keeps taking characters once filtering, including a slash", () => {
    const { session, keymap } = setup()
    for (const char of "/wiki") press(keymap, char)
    // `/` is a searchable character now rather than a mode key, which on a
    // page of paths is exactly the one you want first.
    expect(session.project().filter).toBe("/wiki")
  })
})

describe("filtering, from typing to acting", () => {
  it("acts on the highlighted row without a commit step", () => {
    const { session, keymap, opened } = setup(6)

    for (const char of "number 3") press(keymap, char)
    expect(session.project().items).toHaveLength(1)

    // Enter means the same thing here as in normal mode. It used to switch
    // back to normal mode instead, which looked like nothing happening.
    press(keymap, "Enter", { altKey: true })
    expect(opened).toHaveLength(1)
    expect(session.project().mode).toBe("filter")
  })

  it("leaves the filter on Escape, then leaves navigation", () => {
    const { session, keymap, exits } = setup(6)

    for (const char of "number 3") press(keymap, char)

    press(keymap, "Escape")
    expect(exits).toHaveLength(0)
    expect(session.project().items).toHaveLength(6)
    expect(session.project().mode).toBe("normal")

    press(keymap, "Escape")
    expect(exits).toHaveLength(1)
  })
})

describe("filter highlighting", () => {
  it("marks the matched characters for highlighting", () => {
    const { session, keymap } = setup(6)
    for (const char of "head") press(keymap, char)

    const item = session.project().items[0]!
    expect(item.match.length).toBe(4)
    for (const index of item.match) {
      expect(item.name[index]).toBeDefined()
    }
  })
})

describe("where a link opens", () => {
  it("follows in place on a bare Enter", () => {
    const { keymap, opened } = setup()
    expect(press(keymap, "Enter")).toBe(true)
    expect(opened).toHaveLength(0)
  })

  it("opens a background tab on Alt+Enter", () => {
    const { keymap, opened } = setup()
    // The browser's own address-bar chord for "new tab". Alt would be rejected
    // by the general modifier bail-out, so this also pins that Enter is handled
    // ahead of it.
    expect(press(keymap, "Enter", { altKey: true })).toBe(true)
    expect(opened).toHaveLength(1)
    expect(opened[0]!.background).toBe(true)
  })

  it("switches to the tab when Shift is added", () => {
    const { keymap, opened } = setup()
    expect(press(keymap, "Enter", { altKey: true, shiftKey: true })).toBe(true)
    expect(opened[0]!.background).toBe(false)
  })

  it("follows in place on a bare Shift+Enter", () => {
    // Shift alone no longer means "new tab" — Alt does.
    const { keymap, opened } = setup()
    expect(press(keymap, "Enter", { shiftKey: true })).toBe(true)
    expect(opened).toHaveLength(0)
  })

  it("leaves Ctrl+Enter and Cmd+Enter to the browser", () => {
    const { keymap, opened } = setup()
    expect(press(keymap, "Enter", { ctrlKey: true })).toBe(false)
    expect(press(keymap, "Enter", { metaKey: true })).toBe(false)
    expect(opened).toHaveLength(0)
  })
})

describe("AltGr keyboards", () => {
  // Windows and Linux report AltGr as Ctrl+Alt. On German, Spanish, French,
  // Italian and Hungarian layouts that is how you type `\`, `@`, `{` and `€`,
  // so reading it as a chord stopped those layouts from typing at all.
  const altGr = { ctrlKey: true, altKey: true }

  it("types an AltGr character into the filter", () => {
    const { session, keymap } = setup()
    expect(press(keymap, "@", altGr)).toBe(true)
    expect(session.project().filter).toBe("@")
  })

  it("still refuses a real Ctrl or Cmd chord", () => {
    const { session, keymap } = setup()
    expect(press(keymap, "a", { ctrlKey: true })).toBe(false)
    expect(press(keymap, "a", { metaKey: true })).toBe(false)
    expect(session.project().filter).toBe("")
  })

  it("leaves AltGr+Enter to the page rather than opening a tab", () => {
    const { keymap, opened } = setup()
    expect(press(keymap, "Enter", altGr)).toBe(false)
    expect(opened).toHaveLength(0)
  })
})

describe("Option keyboards on macOS", () => {
  // Option does AltGr's job on a Mac, but isAltGraph() is always false there,
  // so every Option-typed character was read as a chord and handed back to the
  // page: on a German Mac, Option+L is `@` and could not begin a search.
  const nav = navigator as Navigator & { userAgentData?: unknown }
  beforeEach(() => {
    Object.defineProperty(nav, "userAgentData", {
      value: { platform: "macOS" },
      configurable: true
    })
  })
  afterEach(() => {
    delete nav.userAgentData
  })

  it("types an Option character into the filter", () => {
    const { session, keymap } = setup()
    expect(press(keymap, "@", { altKey: true, code: "KeyL" })).toBe(true)
    expect(session.project().mode).toBe("filter")
    expect(session.project().filter).toBe("@")
  })

  it("still leaves Cmd+Option to the browser", () => {
    const { session, keymap } = setup()
    const devtools = { altKey: true, metaKey: true, code: "KeyI" }
    expect(press(keymap, "ˆ", devtools)).toBe(false)
    expect(session.project().filter).toBe("")
  })
})

describe("moving the panel and sizing it", () => {
  it("reaches all four corners on Alt+Arrow", () => {
    const { session, keymap } = setup()
    expect(session.project().dockX).toBe("left")
    expect(session.project().dockY).toBe("bottom")

    expect(press(keymap, "ArrowRight", { altKey: true })).toBe(true)
    expect(press(keymap, "ArrowUp", { altKey: true })).toBe(true)
    expect(session.project().dockX).toBe("right")
    expect(session.project().dockY).toBe("top")

    press(keymap, "ArrowLeft", { altKey: true })
    press(keymap, "ArrowDown", { altKey: true })
    expect(session.project().dockX).toBe("left")
    expect(session.project().dockY).toBe("bottom")
  })

  it("takes Shift+Arrow too, so Alt+Left can stay the browser's Back", () => {
    const { session, keymap } = setup()
    press(keymap, "ArrowRight", { shiftKey: true })
    expect(session.project().dockX).toBe("right")
  })

  it("does not dock on a bare arrow, which still moves the cursor", () => {
    const { session, keymap } = setup()
    press(keymap, "ArrowRight")
    expect(session.project().dockX).toBe("left")
  })

  it("is not triggered by AltGr", () => {
    const { session, keymap } = setup()
    // AltGr is Ctrl+Alt; on a layout that needs it for a character, an arrow
    // press with it held is not a request to move the panel.
    expect(press(keymap, "ArrowRight", { altKey: true, ctrlKey: true })).toBe(
      false
    )
    expect(session.project().dockX).toBe("left")
  })

  it("cycles size on Alt+S and wraps", () => {
    const { session, keymap } = setup()
    expect(session.project().size).toBe("normal")
    // Uppercase too: Shift does not change which chord this is.
    press(keymap, "S", { altKey: true })
    expect(session.project().size).toBe("full")
    press(keymap, "s", { altKey: true })
    expect(session.project().size).toBe("compact")
    press(keymap, "s", { altKey: true })
    expect(session.project().size).toBe("normal")
  })

  it("works the same while filtering", () => {
    // These used to live in normal mode only, so Alt+Left moved the panel while
    // browsing and typed nothing while filtering.
    const { session, keymap } = setup()
    press(keymap, "n")
    expect(session.project().mode).toBe("filter")

    press(keymap, "ArrowRight", { altKey: true })
    press(keymap, "s", { altKey: true })
    expect(session.project().dockX).toBe("right")
    expect(session.project().size).toBe("full")
    // And none of it landed in the query.
    expect(session.project().filter).toBe("n")
  })
})

describe("the settings view", () => {
  it("opens and closes on Alt+comma", () => {
    const { session, keymap } = setup()
    expect(press(keymap, ",", { altKey: true })).toBe(true)
    expect(session.project().mode).toBe("settings")

    press(keymap, ",", { altKey: true })
    expect(session.project().mode).toBe("normal")
  })

  it("matches the physical comma key, for macOS Option", () => {
    // Option+comma is "≤" on macOS, so matching the character alone would fail.
    const { session, keymap } = setup()
    expect(press(keymap, "≤", { altKey: true, code: "Comma" } as never)).toBe(
      true
    )
    expect(session.project().mode).toBe("settings")
  })

  it("chooses with up and down, changes with left and right", () => {
    const { session, keymap } = setup()
    press(keymap, ",", { altKey: true })

    // First row is Size, and left/right cycles it.
    expect(session.project().items[0]!.name).toBe("Size")
    press(keymap, "ArrowRight")
    expect(session.project().size).toBe("full")
    press(keymap, "ArrowLeft")
    expect(session.project().size).toBe("normal")

    // Second row is Corner.
    press(keymap, "ArrowDown")
    expect(session.project().cursorIndex).toBe(1)
    press(keymap, "ArrowRight")
    expect(session.project().dockX).toBe("right")
  })

  it("shows each setting's value where an address would go", () => {
    const { session, keymap } = setup()
    press(keymap, ",", { altKey: true })
    const rows = session.project().items
    expect(rows.map((r) => [r.name, r.url])).toEqual([
      ["Size", "normal"],
      ["Corner", "bottom-left"]
    ])
  })

  it("swallows stray letters rather than starting a search", () => {
    const { session, keymap } = setup()
    press(keymap, ",", { altKey: true })
    expect(press(keymap, "q")).toBe(true)
    expect(session.project().mode).toBe("settings")
    expect(session.project().filter).toBe("")
  })

  it("leaves Escape meaning back, not exit", () => {
    const { session, keymap, exits } = setup()
    press(keymap, ",", { altKey: true })
    press(keymap, "Escape")
    expect(session.project().mode).toBe("normal")
    expect(exits).toHaveLength(0)
  })
})

describe("the compact size stays escapable", () => {
  it("keeps the keys that get you out of it", () => {
    // Compact had no key bar at all, which left the one size with no way to
    // discover how to leave it.
    const { session, keymap } = setup()
    press(keymap, "s", { altKey: true })
    press(keymap, "s", { altKey: true })
    expect(session.project().size).toBe("compact")

    // Both ways out still work from inside it.
    press(keymap, ",", { altKey: true })
    expect(session.project().mode).toBe("settings")
    press(keymap, "Escape")
    press(keymap, "s", { altKey: true })
    expect(session.project().size).toBe("normal")
  })
})

describe("list navigation while filtering", () => {
  // Found by challenging the keymap: Home, End, PageUp and PageDown were
  // handled in normal mode and forgotten in filter mode, so they fell through
  // unconsumed and the *page* scrolled behind the panel. That is the one thing
  // the product promises never to do, and it happened precisely where paging is
  // most useful: a long filtered list.
  const paging = ["Home", "End", "PageDown", "PageUp"] as const

  for (const key of paging) {
    it(`consumes ${key} while filtering, as it does in normal mode`, () => {
      const { keymap, session } = setup()
      // Any printable character enters filter mode.
      press(keymap, "a")
      expect(session.project().mode).toBe("filter")
      expect(press(keymap, key)).toBe(true)
    })
  }
})
