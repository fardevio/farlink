import {
  beginPass,
  cached,
  cachedGlobal,
  endPass,
  newGlobalSlot,
  newStore
} from "~/lib/dom/cache"

/**
 * The generation counter is the whole mechanism, and nothing exercised it.
 *
 * Every other test in the suite builds a fresh container per case, so the
 * WeakMap is keyed by elements that have never been seen before and a stale hit
 * is structurally impossible. Deleting the `hit.generation === generation` check
 * left all 369 tests green — while the live path is exactly where it matters:
 * the MutationObserver drives a re-extraction, and an element hidden since the
 * last pass would keep its cached "visible" verdict, so the panel lists a row
 * the user cannot see and Enter activates an invisible element.
 */

const el = () => document.createElement("div")

afterEach(() => endPass())

describe("cached", () => {
  it("recomputes when a new pass begins", () => {
    const store = newStore<string>()
    const node = el()
    let answer = "visible"
    let calls = 0
    const read = () => cached(store, node, () => (calls++, answer))

    beginPass()
    expect(read()).toBe("visible")
    expect(read(), "second read in the same pass is cached").toBe("visible")
    expect(calls).toBe(1)
    endPass()

    // The page changed between passes. This is the reconcile.
    answer = "hidden"
    beginPass()
    expect(read(), "a new pass must not answer from the old one").toBe("hidden")
    expect(calls).toBe(2)
  })

  it("computes fresh outside a pass, every time", () => {
    // Documented behavior: callers outside beginPass/endPass get no caching.
    const store = newStore<number>()
    const node = el()
    let calls = 0
    const read = () => cached(store, node, () => ++calls)

    expect(read()).toBe(1)
    expect(read()).toBe(2)
  })

  it("keeps separate elements apart within one pass", () => {
    const store = newStore<string>()
    const a = el()
    const b = el()
    beginPass()
    expect(cached(store, a, () => "a")).toBe("a")
    expect(cached(store, b, () => "b")).toBe("b")
    expect(cached(store, a, () => "changed")).toBe("a")
  })
})

describe("cachedGlobal", () => {
  it("recomputes when a new pass begins", () => {
    const slot = newGlobalSlot<boolean>()
    let answer = false
    let calls = 0
    const read = () => cachedGlobal(slot, () => (calls++, answer))

    beginPass()
    expect(read()).toBe(false)
    endPass()

    // `anyInert` is the real caller: a modal opened between passes, so the
    // document now has an [inert] subtree where it had none.
    answer = true
    beginPass()
    expect(read()).toBe(true)
    expect(calls).toBe(2)
  })

  it("caches a false value within a pass", () => {
    // The slot tests `value !== undefined`, so a legitimately false answer has
    // to be a hit rather than looking like "never computed".
    const slot = newGlobalSlot<boolean>()
    let calls = 0
    beginPass()
    cachedGlobal(slot, () => (calls++, false))
    cachedGlobal(slot, () => (calls++, false))
    expect(calls, "false was recomputed as if it were absent").toBe(1)
  })
})
