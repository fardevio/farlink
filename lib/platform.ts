/**
 * The platform differences that change behavior, not just wording.
 *
 * Both traps here have bitten: matching chords on `event.key` killed every
 * Option chord on macOS, and reading AltGr as a chord swallowed characters
 * European layouts need it to type.
 */

export function isMac(): boolean {
  const data = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData
  if (data?.platform) return data.platform === "macOS"
  // Deprecated, but the only signal Chrome leaves when userAgentData is absent.
  return /^mac/i.test(navigator.platform)
}

/** macOS calls the key Option. Spelled, not drawn: ⌥ in a monospace key chip
 *  reads as a stray mark rather than a modifier. */
export function altLabel(): string {
  return isMac() ? "Opt+" : "Alt+"
}

/**
 * Whether AltGr is producing a character rather than a chord being pressed.
 *
 * Windows and Linux report AltGr as Ctrl+Alt, indistinguishable from a real
 * Ctrl+Alt chord. It matters here because `\` is an AltGr combination on
 * German, Spanish, French, Italian and Hungarian layouts.
 *
 * Always false on macOS: Chrome there reports `AltGraph` for Option whenever
 * Option produces an alternate character, and believing it would make every
 * Option chord bail out.
 */
export function isAltGraph(event: KeyboardEvent): boolean {
  if (isMac()) return false
  if (event.getModifierState?.("AltGraph") === true) return true
  // Explicit, because `ctrlKey && altKey` returns the second operand and can
  // hand back a non-boolean from a declared boolean.
  return event.ctrlKey === true && event.altKey === true
}

/**
 * Whether Alt was held to type a character rather than to press a chord.
 *
 * On macOS that is Option's job (Option+Shift+7 is `\` on a German layout); on
 * Windows and Linux it is AltGr's.
 */
export function isCharacterProduction(event: KeyboardEvent): boolean {
  if (isAltGraph(event)) return true
  if (!isMac() || !event.altKey) return false
  // Option+T is "†", so a character that is not the plain letter on the key
  // means Option produced it.
  return event.key.length === 1 && event.key !== plainLetter(event)
}

/** The unmodified letter of a physical key, or "" for anything else. */
function plainLetter(event: KeyboardEvent): string {
  const match = /^Key([A-Z])$/.exec(event.code)
  return match ? match[1]!.toLowerCase() : ""
}

/**
 * Whether `event` is `letter` pressed with a modifier.
 *
 * Matches the physical key via `code`, not `key`: on macOS Option rewrites `key`
 * into the character it produces, so Option+T arrives as "†" and a chord matched
 * on `key` alone silently never fires. Matching the position is also what makes
 * the chords reachable on a non-Latin layout at all.
 *
 * `code` *instead of* `key`, not as well as. It used to be `code || key`, which
 * double-bound every chord on any non-QWERTY Latin layout: on Dvorak the key at
 * QWERTY's T position produces "y", so a single press matched both the `t` chord
 * by code and the `y` chord by key. Pressing the key labelled Y silently cycled
 * the theme, and the documented rule — README and docs/architecture.md both say
 * chords match on `code`, "which is also why they work on a non-Latin layout" —
 * was quietly false.
 */
export function isLetterChord(event: KeyboardEvent, letter: string): boolean {
  const lower = letter.toLowerCase()
  // Some virtual and remapped keyboards report no usable code. There `key` is
  // all there is, and a layout that reaches this branch has no position to
  // disagree with.
  if (!/^Key[A-Z]$/.test(event.code)) {
    return event.key.toLowerCase() === lower
  }
  return event.code === `Key${lower.toUpperCase()}`
}
