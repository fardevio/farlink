/**
 * Per-extraction memoization.
 *
 * Caching is opt-in and scoped to a single pass, because the DOM these
 * functions read is mutating underneath us — a cache that outlived the pass
 * would answer questions about a page that no longer exists. `extractTree`
 * brackets its work with `beginPass()` / `endPass()`; anything calling the DOM
 * helpers outside that bracket computes fresh.
 *
 * This exists because of one measurement: on Hacker News, which is table-based
 * markup, `roleOf` called `classifyTable` for every <tr> and <td>, and each of
 * those ran several querySelectorAll scans over the whole table. Extraction
 * cost 34 ms on an 818-element page. Memoizing the verdict per table is the
 * bulk of the fix.
 */

interface Entry<T> {
  generation: number
  value: T
}

let generation = 0
let caching = false

export function beginPass(): void {
  generation++
  caching = true
}

export function endPass(): void {
  caching = false
}

export function cached<T>(
  store: WeakMap<Element, Entry<T>>,
  el: Element,
  compute: () => T
): T {
  if (!caching) return compute()
  const hit = store.get(el)
  if (hit !== undefined && hit.generation === generation) return hit.value
  const value = compute()
  store.set(el, { generation, value })
  return value
}

/** Cache for a single value that applies to the whole document this pass. */
export function cachedGlobal<T>(
  slot: { generation: number; value: T | undefined },
  compute: () => T
): T {
  if (!caching) return compute()
  if (slot.value !== undefined && slot.generation === generation) {
    return slot.value
  }
  slot.value = compute()
  slot.generation = generation
  return slot.value
}

export function newStore<T>(): WeakMap<Element, Entry<T>> {
  return new WeakMap<Element, Entry<T>>()
}

export function newGlobalSlot<T>(): {
  generation: number
  value: T | undefined
} {
  return { generation: -1, value: undefined }
}
