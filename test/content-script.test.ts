/**
 * The first execution harness for the content script.
 *
 * 635 lines that no test imported, holding every cross-boundary contract in the
 * extension: the key gate, the shadow host, the MutationObserver, settings
 * persistence and the message channel. Nine separate single-line mutations to
 * this file left the suite green.
 *
 * It is harnessable without touching the source: `defineContentScript` is a WXT
 * global, so stubbing it makes the module's default export a plain object whose
 * `main()` can be called directly.
 */

import type { Settings } from "~/lib/settings"

interface ContentScriptModule {
  default: { main: () => Promise<void> }
}

/** Messages the fake worker was sent, so a test can assert on them. */
let sent: { type: string; [k: string]: unknown }[] = []
/** Listeners the script registered with chrome.runtime.onMessage. */
let workerListeners: ((m: { type: string }) => void)[] = []
/** What `chrome.storage.sync` currently holds. */
let stored: Record<string, unknown> = {}

function installChrome(): void {
  sent = []
  workerListeners = []
  stored = {}
  // The injection guard is a flag on `window`, and happy-dom shares one window
  // across a file. Without clearing it the second boot early-returns, registers
  // nothing, and every later test passes because no panel was ever built.
  delete (window as unknown as Record<string, unknown>).__farlinkInstalled
  ;(globalThis as Record<string, unknown>).defineContentScript = (
    config: unknown
  ) => config
  ;(globalThis as Record<string, unknown>).chrome = {
    runtime: {
      id: "farlink-test",
      lastError: undefined,
      getManifest: () => ({ version: "0.1.0" }),
      getURL: (p: string) => p,
      sendMessage: (
        message: { type: string },
        cb?: (r: unknown) => void
      ): void => {
        sent.push(message)
        if (!cb) return
        // `restore` must answer or prime() never resolves and the panel never
        // opens — which would make every test here pass for the wrong reason.
        if (message.type === "restore") cb({ anchor: null })
        else if (message.type === "shortcut") cb({ chord: "Ctrl+Shift+Period" })
        else if (message.type === "open-tabs") cb({ results: [] })
        else cb({ ok: true })
      },
      onMessage: {
        addListener: (fn: (m: { type: string }) => void) =>
          workerListeners.push(fn)
      }
    },
    storage: {
      sync: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (o: Record<string, unknown>) => void Object.assign(stored, o)
      },
      session: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} }
    }
  }
}

/** Load the module fresh and run its main(). */
async function boot(): Promise<void> {
  installChrome()
  vi.resetModules()
  const mod =
    (await import("~/entrypoints/farlink.content/index")) as unknown as ContentScriptModule
  await mod.default.main()
}

/** Open the panel the only way the product can: a `toggle` from the worker. */
async function openPanel(): Promise<void> {
  workerListeners.forEach((fn) => fn({ type: "toggle" }))
  // prime() awaits storage and a worker round-trip, and the settle path uses a
  // real timer — draining microtasks alone leaves the host unbuilt.
  await new Promise((resolve) => setTimeout(resolve, 30))
}

function key(name: string, init: Partial<KeyboardEventInit> = {}) {
  return new KeyboardEvent("keydown", {
    key: name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    bubbles: true,
    cancelable: true,
    ...init
  })
}

const hostTag = () =>
  [...document.documentElement.children]
    .map((el) => el.tagName.toLowerCase())
    .find((tag) => tag.startsWith("farlink-")) ?? null

afterEach(() => {
  for (const el of [...document.documentElement.children]) {
    if (el.tagName.toLowerCase().startsWith("farlink-")) el.remove()
  }
  document.body.replaceChildren()
})

describe("the content script boots", () => {
  it("installs its listeners and builds nothing until asked", async () => {
    document.body.innerHTML = '<a href="/one">One</a><a href="/two">Two</a>'
    await boot()

    expect(workerListeners, "registered a worker listener").toHaveLength(1)
    expect(hostTag(), "no UI before the user activates").toBeNull()
    expect(sent, "nothing woke the worker at boot").toEqual([])
  })

  it("builds the panel host on toggle, in a closed shadow root", async () => {
    document.body.innerHTML = '<a href="/one">One</a><a href="/two">Two</a>'
    await boot()
    await openPanel()

    const tag = hostTag()
    expect(tag, "the host is created on demand").not.toBeNull()
    // Randomized suffix, so a page cannot ship a static CSS rule targeting it.
    expect(tag).toMatch(/^farlink-[a-z0-9]{4,8}$/)
    const host = document.documentElement.querySelector(tag!)!
    expect(
      host.shadowRoot,
      "the root must be closed to page scripts"
    ).toBeNull()
  })
})

describe("the key gate", () => {
  it("ignores a key the user did not physically press", async () => {
    // The security boundary. A content script's window listeners also fire for
    // events the *page* dispatches, so without this a hostile page could drive
    // the extension with synthetic keydowns — mark rows and press O to make the
    // privileged worker open tabs. Deleting the check left all 369 tests green.
    //
    // `defaultPrevented` is the observable, because a key the panel claims is
    // always preventDefault'd and the panel's own state is behind a closed
    // shadow root.
    document.body.innerHTML = '<a href="/one">One</a><a href="/two">Two</a>'
    await boot()
    await openPanel()
    expect(
      hostTag(),
      "panel must be open or this proves nothing"
    ).not.toBeNull()

    const synthetic = key("ArrowDown")
    window.dispatchEvent(synthetic)
    // happy-dom leaves isTrusted undefined rather than false; either way the
    // event is not user-generated, which is the precondition being tested.
    expect(synthetic.isTrusted, "the event must be untrusted").toBeFalsy()
    expect(
      synthetic.defaultPrevented,
      "an untrusted key was claimed by the panel"
    ).toBe(false)
  })

  it("claims nothing at all while the panel is closed", async () => {
    // Closed means closed: there is one way in, and it is the command or the
    // toolbar button.
    document.body.innerHTML = '<a href="/one">One</a>'
    await boot()

    for (const name of ["ArrowDown", "Enter", "Escape", "j"]) {
      const event = key(name)
      window.dispatchEvent(event)
      expect(event.defaultPrevented, name).toBe(false)
    }
  })
})

describe("settings persistence", () => {
  it("does not write the closed-panel defaults over saved settings", async () => {
    // A shipped bug, documented in the source: project() returns
    // EMPTY_PROJECTION when the mode is "off", and that carries the *defaults* —
    // so the subscriber wrote "normal, bottom-left" over whatever was saved,
    // once at construction and again on every close. "The size was being
    // destroyed rather than not stored." Removing the `mode !== "off"` guard
    // left the suite green.
    const saved: Settings = {
      flavorId: "nord",
      dockX: "right",
      dockY: "top",
      size: "full"
    }
    installChrome()
    stored.farlink_settings = { ...saved }
    vi.resetModules()
    const mod =
      (await import("~/entrypoints/farlink.content/index")) as unknown as ContentScriptModule
    await mod.default.main()
    document.body.innerHTML = '<a href="/one">One</a><a href="/two">Two</a>'

    // Opening constructs the Agent, and `subscribe` fires immediately with the
    // closed-panel projection before `open()` has applied the saved layout.
    await openPanel()
    expect(hostTag(), "the panel has to actually open").not.toBeNull()

    // Closing puts the mode back to "off", which is the second and worse half:
    // it happens on every close, for the life of the tab.
    workerListeners.forEach((fn) => fn({ type: "toggle" }))
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(
      stored.farlink_settings,
      "the closed-panel defaults were written over the saved layout"
    ).toEqual(saved)
  })
})
