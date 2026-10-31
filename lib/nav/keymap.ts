import {
  isAltGraph,
  isCharacterProduction,
  isLetterChord
} from "~/lib/platform"

import type { NavSession } from "./session"

/**
 * Key handling for the normal, filter and settings modes.
 *
 * The `isTrusted` and IME guards deliberately live in the content script
 * rather than here: keeping them at the boundary means this stays a pure state
 * machine.
 */

export interface KeymapHooks {
  /** Leave navigation entirely. */
  onExit(): void
}

/** Rows a PageUp/PageDown moves. */
const PAGE = 12

export class Keymap {
  private session: NavSession
  private hooks: KeymapHooks

  constructor(session: NavSession, hooks: KeymapHooks) {
    this.session = session
    this.hooks = hooks
  }

  /** True when the key was consumed and must not reach the page. */
  handle(event: KeyboardEvent): boolean {
    const projection = this.session.project()
    if (projection.mode === "off") return false

    // Mode-independent chords, checked before the mode dispatch.
    if (this.handleGlobal(event)) return true

    switch (projection.mode) {
      case "settings":
        return this.handleSettings(event)
      case "filter":
        return this.handleFilter(event)
      default:
        return this.handleNormal(event)
    }
  }

  /**
   * Moving through the list, identical in normal and filter mode.
   *
   * Shared rather than written twice: the second copy fell behind, and Home,
   * End, PageUp and PageDown reached the page instead, scrolling it behind the
   * panel.
   */
  private handleListNavigation(event: KeyboardEvent): boolean {
    switch (event.key) {
      case "ArrowDown":
        this.session.move(1)
        return true
      case "ArrowUp":
        this.session.move(-1)
        return true
      case "Home":
        this.session.first()
        return true
      case "End":
        this.session.last()
        return true
      case "PageDown":
        this.session.move(PAGE)
        return true
      case "PageUp":
        this.session.move(-PAGE)
        return true
      default:
        return false
    }
  }

  /**
   * The settings view. Arrows only: up and down to choose a setting, left and
   * right to change it. Bare left and right are free here because docking is an
   * Alt chord, so nothing else claims them.
   */
  private handleSettings(event: KeyboardEvent): boolean {
    switch (event.key) {
      case "Escape":
        this.session.closeSettings()
        return true
      case "ArrowUp":
        this.session.moveSetting(-1)
        return true
      case "ArrowDown":
        this.session.moveSetting(1)
        return true
      case "ArrowLeft":
        this.session.adjustSetting(-1)
        return true
      case "ArrowRight":
        this.session.adjustSetting(1)
        return true
      case "Enter":
        // Steps a row that has values, opens one that only reports something.
        this.session.activateSetting()
        return true
      default:
        // Nothing here is typed, so a stray key is swallowed rather than
        // starting a search the user cannot see.
        return event.key.length === 1
    }
  }

  private handleFilter(event: KeyboardEvent): boolean {
    const { filter } = this.session.project()

    if (event.key === "Escape") {
      this.session.cancelFilter()
      return true
    }
    // Enter acts on the highlighted row, exactly as it does in normal mode.
    // It used to "commit" the filter into normal mode, which looked like
    // nothing happening: the list was already narrowed and already navigable
    // with the arrows, so committing bought a mode change and no capability.
    if (event.key === "Enter") return this.activateFrom(event)
    if (event.key === "Backspace") {
      this.session.setFilter(filter.slice(0, -1))
      return true
    }
    if (this.handleListNavigation(event)) return true
    // AltGr produces a character; Ctrl and Cmd do not.
    const chord = (event.ctrlKey || event.metaKey) && !isAltGraph(event)
    if (event.key.length === 1 && !chord) {
      this.session.setFilter(filter + event.key)
      return true
    }
    return false
  }

  /**
   * Chords that apply in every mode: moving the panel, and changing its theme.
   *
   * All of them need a modifier, because a bare key is either movement or a
   * character being typed.
   */
  private handleGlobal(event: KeyboardEvent): boolean {
    // AltGr is Ctrl+Alt and produces characters, so it is never one of these.
    if (isAltGraph(event) || event.ctrlKey || event.metaKey) return false

    // Alt plus an arrow puts the panel in a corner, on both axes, so all four
    // corners are reachable. Shift does the same, because on Windows and Linux
    // Alt+Left/Right is the browser's Back and Forward and the panel would
    // otherwise shadow it while open.
    if (event.altKey || event.shiftKey) {
      switch (event.key) {
        case "ArrowLeft":
          this.session.setDockX("left")
          return true
        case "ArrowRight":
          this.session.setDockX("right")
          return true
        case "ArrowUp":
          this.session.setDockY("top")
          return true
        case "ArrowDown":
          this.session.setDockY("bottom")
          return true
      }
    }

    // Alt+letter, because an unmodified letter would start a search. Matched
    // through `isLetterChord`, which also reads `event.code`: on macOS Option
    // rewrites `key`, so Option+T arrives as "†" and both chords once died.
    if (event.altKey) {
      if (isLetterChord(event, "t")) {
        this.session.cycleTheme()
        return true
      }
      if (isLetterChord(event, "s")) {
        this.session.cycleSize()
        return true
      }
    }

    // Alt+comma for settings, the preferences chord everywhere else. Matched on
    // `code` for the same reason the letters are: on macOS Option+comma is "≤".
    if (event.altKey && (event.code === "Comma" || event.key === ",")) {
      if (this.session.project().mode === "settings") {
        this.session.closeSettings()
      } else {
        this.session.openSettings()
      }
      return true
    }

    return false
  }

  /**
   * Enter, and the chords that change where the link opens. Shared by normal
   * and filter mode so that pressing Enter means the same thing in both.
   */
  private activateFrom(event: KeyboardEvent): boolean {
    // Checked first: AltGr is Ctrl+Alt, and reading it as the Alt chord would
    // open a tab for a keypress the user meant for the page.
    if (isAltGraph(event)) return false

    // Alt+Enter is what the browser's own address bar uses for "open in a new
    // tab", so it is the chord to reach for rather than one FarLink invented.
    // Adding Shift switches to the tab, mirroring click semantics everywhere
    // else: a modifier opens in the background, the modifier plus Shift goes
    // there.
    if (event.altKey) {
      this.session.openTargets(!event.shiftKey)
      return true
    }
    // Ctrl and Cmd stay the browser's: Cmd+Enter is an OS chord in places and
    // nothing here is worth shadowing it for.
    if (event.ctrlKey || event.metaKey) return false
    this.session.activate()
    return true
  }

  private handleNormal(event: KeyboardEvent): boolean {
    const projection = this.session.project()

    // Where the link opens is a modifier on Enter, the way it is everywhere
    // else in a browser: plain to open here, held to open elsewhere. This
    // replaced `o`/`O`, which were letters, and letters belong to typing.
    // Checked before the general modifier bail-out below, which would
    // otherwise hand Alt+Enter to the page.
    if (event.key === "Enter") return this.activateFrom(event)

    // Every other modifier chord belongs to the page and the browser, but
    // AltGr is not one, it is how a character gets typed, and typing a
    // character is now how filtering starts. Without this exception `@` and
    // `{` could not begin a search on the layouts that need AltGr for them.
    //
    // On macOS Option does AltGr's job and `isAltGraph` is always false, so a
    // German Mac's Option+L (`@`) fell through to the page. Only Option alone,
    // though: Cmd+Option is a browser chord whatever character it reports.
    const typed =
      isAltGraph(event) ||
      (!event.ctrlKey && !event.metaKey && isCharacterProduction(event))
    const chord = (event.ctrlKey || event.metaKey || event.altKey) && !typed
    if (chord) return false

    const key = event.key

    // Movement is on the arrows alone: letters belong to what the user is
    // typing, and binding the alphabet makes the list something you steer
    // rather than something you search.
    if (this.handleListNavigation(event)) return true

    switch (key) {
      case "Escape":
        // A committed filter is still narrowing the level, so Escape undoes
        // that first. Leaving is the second press, which matches what the
        // status bar says while a filter is active.
        if (projection.filter) {
          this.session.cancelFilter()
          return true
        }
        this.hooks.onExit()
        return true
      default:
        // Any printable character starts filtering, with that character. The
        // `/` prefix is gone: nothing else is bound to a letter any more, so
        // requiring a key to say "now I am typing" was a mode announcing
        // itself for no reason, and it cost you `/` as a searchable
        // character, which on a page of paths is one you want. The status line
        // going bright with a block cursor says the same thing.
        if (key.length === 1) {
          this.session.beginFilter(key)
          return true
        }
        return false
    }
  }

  reset(): void {}
}
