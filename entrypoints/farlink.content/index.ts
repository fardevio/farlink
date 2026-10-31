import { ChangeTimer } from "~/lib/change-timer"
import { sendToWorker, SHORTCUTS_URL } from "~/lib/messaging"
import type { OpenTabsReply, WorkerMessage } from "~/lib/messaging"
import { Keymap } from "~/lib/nav/keymap"
import { NavSession } from "~/lib/nav/session"
import type { SerializedAnchor } from "~/lib/nav/session"
import {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsChanged,
  saveSettings
} from "~/lib/settings"
import type { Settings } from "~/lib/settings"
import { Highlighter, reveal } from "~/lib/ui/highlight"
import { Hud, shortcutLabel } from "~/lib/ui/hud"
import {
  applyFlavor,
  findFlavor,
  FLAVORS,
  nextFlavorId,
  resolveFlavor
} from "~/lib/ui/themes"

/**
 * The page agent.
 *
 * This file only ever runs because the worker injected it — the manifest
 * declares no content scripts, so there is no warm path and nothing runs at
 * `document_start`. `main()` installs listeners and returns; nothing is
 * extracted, no UI is built and no stylesheet is injected until the user
 * actually activates.
 *
 * The `matches`/`runAt`/`allFrames` keys on the default export below are what
 * WXT needs to emit the bundle, not a registration. Nothing calls
 * `chrome.scripting.registerContentScripts`.
 */

let settings: Settings = DEFAULT_SETTINGS
let agent: Agent | null = null
/** The concrete flavor in force, with "auto" resolved. */
function flavorNow(): string {
  return resolveFlavor(settings.flavorId).id
}

/** The flavor `delta` steps from the current one, wrapping. */
function stepFlavorId(id: string, delta: 1 | -1): string {
  if (delta === 1) return nextFlavorId(id, flavorNow())
  const ids = FLAVORS.map((f) => f.id)
  const at = ids.indexOf(id === "auto" ? flavorNow() : id)
  return ids[(at - 1 + ids.length) % ids.length]!
}

/**
 * Cursor position from the last visit to this tab, fetched once by `prime` on
 * the first activation and consumed by it.
 */
let restoreAnchor: SerializedAnchor | null = null

/**
 * The two methods used off the Navigation API. TypeScript's DOM lib has no
 * declaration for it at this target, and reaching for one through an inline
 * shape is what platform.ts already does for `userAgentData`.
 */
interface NavigationEvents {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

function navigationApi(): NavigationEvents | undefined {
  return (window as Window & { navigation?: NavigationEvents }).navigation
}

/** Facts about the product that the settings view reports. */
const AUTHOR = "Far Chinberdiev · fardev.io"
const AUTHOR_URL = "https://fardev.io"
const REPO_LABEL = "fardevio/farlink"
const REPO_URL = "https://github.com/fardevio/farlink"

const STORE_URL =
  "https://chromewebstore.google.com/detail/chfppficohobddfeafagjaecdbacepmh"

class Agent {
  readonly host: HTMLElement
  private shadow: ShadowRoot
  private session: NavSession
  private hud: Hud
  private highlighter: Highlighter
  private keymap: Keymap
  private observer: MutationObserver
  private reconcileTimer = 0
  private busyTimer = 0
  private lastBusy: boolean | null = null
  private landed: (() => void) | null = null
  /**
   * The two transient messages, each taken down once its own text changes.
   *
   * Not on every projection: the panel re-projects whenever the page mutates,
   * and restarting these countdowns each time meant a message on a busy page
   * never came down. See ChangeTimer.
   */
  private readonly noticeClear = new ChangeTimer(1600, () =>
    this.session.clearNotice()
  )
  private readonly statusClear = new ChangeTimer(2200, () =>
    this.session.clearStatus()
  )
  /**
   * What the toggle is bound to, once the worker has answered.
   *
   * Three states, not two. The empty string is a real answer -- Chrome says the
   * command has no key -- while a failed round-trip means we do not know, and
   * the two must not read the same. Reporting "not bound" because a message did
   * not come back is a confident lie about the one thing this row exists to
   * report, and it stuck: the retry guard used to be `chord !== null`, so a
   * single transient failure latched it for the rest of the page.
   *
   * Only the worker can call commands.getAll(), and reaching it wakes it, so
   * the question waits until the settings view is actually opened.
   */
  private chord: { value: string } | null = null
  private chordPending = false
  /**
   * Set when Chrome refused to open its own shortcut editor.
   *
   * The row then shows the address instead of the chord, which is the useful
   * half at that point: the user pressed Enter because they wanted that page,
   * and an address on screen can be read and typed. Copying it to the clipboard
   * was the alternative, and this extension promises in five places that it
   * never touches the clipboard -- including a section of the privacy policy.
   * test/cross-platform.test.ts enforces it across the whole source tree.
   */
  private shortcutsBlocked = false

  constructor() {
    // A random suffix, so a hostile page cannot ship a static CSS rule
    // targeting the host by tag name. Tag selectors have no substring form,
    // so the constant prefix alone is not enough to target.
    const suffix = Math.random().toString(36).slice(2, 8)
    this.host = document.createElement(`farlink-${suffix}`)
    // Every one of these is `!important`: an author rule in the page beats a
    // plain inline declaration, so `farlink-x { display: none !important }`
    // would otherwise blind the user while the session kept running and
    // still responded to Enter.
    for (const [property, value] of [
      ["all", "initial"],
      ["position", "static"],
      ["display", "block"],
      ["visibility", "visible"],
      ["opacity", "1"],
      ["pointer-events", "auto"]
    ]) {
      this.host.style.setProperty(property!, value!, "important")
    }
    this.shadow = this.host.attachShadow({ mode: "closed" })
    // Nothing inside the panel scrolls, because the columns window their own rows,
    // so a wheel event over it would otherwise reach the page and scroll a
    // document the user cannot see behind it. Not passive, because the whole
    // point is to preventDefault.
    this.host.addEventListener(
      "wheel",
      (event) => {
        if (this.session.isOpen) event.preventDefault()
      },
      { passive: false }
    )
    document.documentElement.appendChild(this.host)

    this.hud = new Hud(this.shadow)
    this.highlighter = new Highlighter(this.shadow)

    this.session = new NavSession({
      openUrls: (urls, background) =>
        sendToWorker<OpenTabsReply>({ type: "open-tabs", urls, background }),
      obstruction: () => this.hud.obstruction(),
      cycleTheme: () => this.cycleTheme(),
      // Theme only: the three settings in the panel are the three that change.
      hostSettings: () => [
        { key: "theme", label: "Theme", value: findFlavor(flavorNow()).name },
        {
          key: "shortcut",
          label: "Shortcut",
          value: this.shortcutsBlocked
            ? SHORTCUTS_URL
            : shortcutLabel(this.chord, this.chordPending),
          openable: true
        },
        { key: "gap", label: "", value: "", divider: true },
        {
          key: "version",
          label: "Version",
          value: chrome.runtime.getManifest().version,
          openable: true
        },
        { key: "author", label: "Author", value: AUTHOR, openable: true },
        { key: "github", label: "GitHub", value: REPO_LABEL, openable: true }
      ],
      openSetting: (key) => this.openSetting(key),
      changeSetting: (key, delta) => this.changeSetting(key, delta),
      reveal: (el) => reveal(el, this.hud.obstruction()),
      scrollTop: () => window.scrollY,
      restoreScroll: (top) => window.scrollTo({ top, behavior: "auto" })
    })

    this.keymap = new Keymap(this.session, { onExit: () => toggle(false) })

    this.session.subscribe((projection) => {
      if (projection.mode === "settings") this.askForChord()
      this.hud.render(projection)
      this.highlighter.update(this.session.cursorElement)
      this.statusClear.watch(projection.status)
      this.scheduleBusyClear(projection.busy)
      this.noticeClear.watch(projection.notice)
      // Corner and size are preferences, not per-page state: having to set
      // them again on every page would make the keys useless.
      //
      // Only while the session is open. `project()` returns EMPTY_PROJECTION
      // when the mode is "off", and that carries the *defaults*, and
      // `subscribe` fires once immediately at construction. So this wrote
      // "normal, bottom-left" back over whatever had been saved, before the
      // panel was ever shown, and again on every close. The size was being
      // destroyed rather than not stored.
      if (
        projection.mode !== "off" &&
        (projection.dockX !== settings.dockX ||
          projection.dockY !== settings.dockY ||
          projection.size !== settings.size)
      ) {
        const layout = {
          dockX: projection.dockX,
          dockY: projection.dockY,
          size: projection.size
        }
        settings = { ...settings, ...layout }
        void saveSettings(layout)
      }
    })

    this.observer = new MutationObserver((records) => this.onMutations(records))

    this.applyTheme()
  }

  applyTheme(): void {
    applyFlavor(this.host, resolveFlavor(settings.flavorId))
  }

  /** Step one of the settings the session does not own. */
  private changeSetting(key: string, delta: 1 | -1): void {
    if (key === "theme") this.setTheme(stepFlavorId(settings.flavorId, delta))
  }

  /** Applied locally first so the keypress feels immediate, then persisted. */
  private write(patch: Partial<Settings>): void {
    settings = { ...settings, ...patch }
    void saveSettings(patch)
  }

  private setTheme(flavorId: string): void {
    this.write({ flavorId })
    this.applyTheme()
    this.session.announce(findFlavor(flavorId).name)
  }

  /**
   * Next theme, applied at once and saved.
   *
   * Applied locally before the write resolves so the keypress feels immediate;
   * `onSettingsChanged` will arrive with the same value and re-apply it, which
   * is idempotent.
   */
  private cycleTheme(): void {
    this.setTheme(stepFlavorId(settings.flavorId, 1))
  }

  open(restore?: SerializedAnchor): void {
    this.session.applyLayout(settings.dockX, settings.dockY, settings.size)
    this.session.open(restore)
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
    window.addEventListener("pointerdown", this.onPointerDown, true)
  }

  /**
   * A press on the page, rather than on the panel, closes it.
   *
   * Reaching for the mouse means the panel is not what you are driving, and an
   * overlay you have to dismiss with the keyboard after clicking past it is
   * just in the way. `pointerdown` rather than `click`, so it lands before the
   * page acts on the press.
   *
   * `composedPath()` crosses the shadow boundary, so a press on the panel
   * itself contains the host; `contains()` would not, the root being closed.
   */
  private readonly onPointerDown = (event: Event): void => {
    if (!event.isTrusted) return
    if (event.composedPath().includes(this.host)) return
    this.close()
  }

  close(): void {
    window.removeEventListener("pointerdown", this.onPointerDown, true)
    this.observer.disconnect()
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer)
    if (this.busyTimer) clearTimeout(this.busyTimer)
    this.lastBusy = null
    this.stopWatchingNavigation()
    this.noticeClear.cancel()
    this.statusClear.cancel()
    this.keymap.reset()
    this.session.close()
    this.highlighter.update(null)
    void sendToWorker({
      type: "checkpoint",
      anchor: this.session.serializeCursor()
    })
  }

  handleKey(event: KeyboardEvent): boolean {
    return this.keymap.handle(event)
  }

  get isOpen(): boolean {
    return this.session.isOpen
  }

  /** Only in normal mode does a bare key belong to the extension. */
  get isNormalMode(): boolean {
    return this.session.project().mode === "normal"
  }

  private onMutations(records: MutationRecord[]): void {
    // A page that removes the host would leave the session running with no
    // cursor and no strip visible, while keys still activated elements. Put it
    // back rather than letting the user act blind.
    if (!this.host.isConnected) {
      document.documentElement.appendChild(this.host)
    }

    // Our own shadow host mutating must never trigger a re-extract, or the
    // HUD update loop feeds itself.
    const relevant = records.some(
      (record) =>
        record.target !== this.host && !this.host.contains(record.target)
    )
    if (!relevant) return

    if (this.reconcileTimer) clearTimeout(this.reconcileTimer)
    // Re-extraction costs tens of milliseconds on a large page, so it is
    // debounced well past the length of a typical render burst.
    this.reconcileTimer = window.setTimeout(() => {
      this.reconcileTimer = 0
      this.session.reconcile()
    }, 400)
  }

  /**
   * Stop saying "Opening…" once the navigation has actually landed.
   *
   * A hard same-tab navigation unloads the page, so nothing here has to fire.
   * The cases that do need clearing are the ones that keep the document alive:
   * an in-page anchor, which resolves instantly, and a client-side route change,
   * which is what most documentation sites do now.
   *
   * The Navigation API reports both. On onorca.dev/docs, navigatesuccess fires
   * 231 ms after the click while the timer below was set to 1200, so the word
   * sat there for about a second after the page had visibly finished. The timer
   * is still the backstop, for a navigation that fires nothing and a page that
   * never unloads.
   *
   * `navigation` is Chrome 102+, under the manifest's 116 floor, and in a
   * content script's isolated world it is the real API rather than anything the
   * page could put there.
   */
  private scheduleBusyClear(busy: boolean): void {
    if (busy === this.lastBusy) return
    this.lastBusy = busy
    if (this.busyTimer) clearTimeout(this.busyTimer)
    this.stopWatchingNavigation()
    if (!busy) return

    /**
     * The navigation we started has arrived.
     *
     * A page that unloads takes the panel with it, so on an ordinary site
     * following a link closes FarLink by simply destroying it. A client-side
     * route change does not unload, and the panel used to survive it — leaving
     * an overlay on a page the user had just chosen to go to, listing that new
     * page's links. Closing here makes the two behave the same, and matches
     * what session.close() already assumes: "Activating means they wanted to be
     * somewhere else".
     *
     * Safe against a page navigating on its own, because these listeners exist
     * only while an activation of ours is in flight.
     */
    const landed = () => {
      this.stopWatchingNavigation()
      if (this.busyTimer) clearTimeout(this.busyTimer)
      this.busyTimer = 0
      this.lastBusy = null
      this.close()
    }

    /** Nothing arrived. Stop saying "Opening…" but stay where we are. */
    const gaveUp = () => {
      this.stopWatchingNavigation()
      this.busyTimer = 0
      this.session.clearBusy()
    }

    // currententrychange as well as navigatesuccess: a framework that routes
    // through history.pushState changes the entry without a navigation event.
    const nav = navigationApi()
    if (nav) {
      this.landed = () => {
        nav.removeEventListener("navigatesuccess", landed)
        nav.removeEventListener("currententrychange", landed)
      }
      nav.addEventListener("navigatesuccess", landed)
      nav.addEventListener("currententrychange", landed)
    }

    this.busyTimer = window.setTimeout(gaveUp, 1200)
  }

  private stopWatchingNavigation(): void {
    this.landed?.()
    this.landed = null
  }

  /**
   * Ask the worker what the toggle is bound to, once.
   *
   * Only the worker can call commands.getAll(), and reaching it wakes it, so
   * this waits for the settings view rather than running on activation. Chrome
   * fires no event when the user rebinds, so the answer is re-asked whenever
   * the panel is opened afresh.
   */
  private askForChord(): void {
    if (this.chord !== null || this.chordPending) return

    this.chordPending = true
    void sendToWorker<{ chord: string }>({ type: "shortcut" }).then((reply) => {
      this.chordPending = false
      // Only a reply is an answer. Leaving it null on failure means the next
      // time settings opens, the question gets asked again.
      if (typeof reply?.chord === "string") this.chord = { value: reply.chord }
      this.session.refresh()
    })
  }

  /**
   * Enter on a row that reports rather than holds a value.
   *
   * The keys live here and not in the session: what "github" opens is a fact
   * about this product, and the state machine has no business knowing it.
   */
  private openSetting(key: string): void {
    const url =
      key === "github"
        ? REPO_URL
        : key === "author"
          ? AUTHOR_URL
          : key === "version"
            ? STORE_URL
            : null

    if (url) {
      void sendToWorker({ type: "open-tabs", urls: [url], background: false })
      return
    }

    if (key !== "shortcut") return

    // If Chrome will not let us open its own shortcut editor, say where it is.
    // Pressing Enter on the one row meant to unstick a broken shortcut and
    // getting nothing at all is the worst outcome available here.
    //
    // announce(), not say(): the status line is display:none in settings mode,
    // so a message put there would be as invisible as the silence it replaces.
    // The notice sits in the header, which settings does show.
    void sendToWorker<{ ok: boolean }>({ type: "open-shortcuts" }).then(
      (reply) => {
        this.shortcutsBlocked = reply?.ok !== true
        if (this.shortcutsBlocked) this.session.announce("Could not open it")
        this.session.refresh()
      }
    )
  }

  destroy(): void {
    this.close()
    this.observer.disconnect()
    this.highlighter.destroy()
    this.hud.destroy()
    this.host.remove()
  }
}

/**
 * The work that only matters once FarLink is actually used.
 *
 * Deliberately not done at document_start: an MV3 worker is killed after ~30 s
 * idle, so `sendToWorker` is a cold start, and doing it on every page load
 * would spend that on every navigation for a checkpoint that is almost always
 * null. Settings are the same: `DEFAULT_SETTINGS` is already a working
 * configuration, so the panel can open before storage has been read.
 */
let primed: Promise<void> | null = null

function prime(): Promise<void> {
  primed ??= (async () => {
    settings = await loadSettings()
    onSettingsChanged((next) => {
      settings = next
      agent?.applyTheme()
    })

    const stored = await sendToWorker<{ anchor: SerializedAnchor | null }>({
      type: "restore"
    })
    restoreAnchor = stored?.anchor ?? null
  })()
  return primed
}

function toggle(next?: boolean): void {
  const shouldOpen = next ?? !(agent?.isOpen ?? false)

  if (!shouldOpen) {
    agent?.close()
    return
  }

  void prime().then(() => {
    if (!agent) agent = new Agent()
    agent.applyTheme()
    agent.open(restoreAnchor ?? undefined)
    // One-shot: a restored position is for the first activation after a load,
    // not for every toggle within it.
    restoreAnchor = null
  })
}

function onKeyDown(event: KeyboardEvent): void {
  // A content script's window listeners also fire for events the *page*
  // dispatches. Without this check a hostile page could drive the whole
  // extension with synthetic keydowns: mark 500 rows and press `O` to make
  // the privileged service worker open 500 foreground tabs, or press `y` to
  // put attacker-chosen text on the clipboard. Nothing here should ever
  // respond to a key the user did not physically press.
  if (!event.isTrusted) return

  // IME composition: `isComposing` covers modern browsers, keyCode 229 covers
  // the older path some IMEs still take.
  if (event.isComposing || event.keyCode === 229) return

  // Closed means closed: there is one way in, and it is the command or the
  // toolbar button. Nothing here claims a key the user has not opened FarLink
  // to press.
  //
  // This is the only gate, and it has to come first. There used to be an
  // `isEditableTarget` check above it that returned whenever focus sat in a page
  // input — which made opening the panel from a focused search box produce a
  // panel that swallowed nothing and answered nothing: every arrow, letter,
  // Enter and *Escape* went to the input, and the only way out was the mouse.
  // On a keyboard-first tool that was the likeliest first-run failure.
  //
  // The check was also redundant. While the panel is closed this return already
  // ignores every key, and while it is open the keys are the panel's by
  // definition — the design treats touching the page as closing the panel
  // (`onPointerDown`), so focus cannot drift back mid-session. Keys the panel
  // does not claim still reach the page, because `handleKey` returns false for
  // them and nothing is prevented.
  if (!agent?.isOpen) return

  if (agent.handleKey(event)) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  runAt: "document_start",
  allFrames: false,
  cssInjectionMode: "manual",

  async main() {
    // Guard against double injection. `chrome.scripting.executeScript` is the
    // only way this file ever runs — the manifest declares no content scripts —
    // and the worker injects on every activation because injection has to be
    // idempotent rather than tracked.
    const flag = "__farlinkInstalled" as const
    const w = window as unknown as Record<string, boolean>
    if (w[flag]) return
    w[flag] = true

    window.addEventListener("keydown", onKeyDown, {
      capture: true,
      passive: false
    })

    chrome.runtime.onMessage.addListener((message: WorkerMessage) => {
      if (message.type === "toggle") toggle()
      return undefined
    })

    window.addEventListener("pagehide", () => {
      agent?.destroy()
      // A destroyed Agent must never be reused, and `toggle()` decides by
      // `if (!agent)`. Leaving the corpse in place meant that after a bfcache
      // restore (Back) the injection guard above still short-circuited, this
      // listener was still attached, and the dead Agent was reused: `hud`
      // had already removed the frame and its stylesheet and `host.remove()`
      // had detached the shadow host, which `open()` never re-appends — so
      // `session.isOpen` was true with nothing on screen, every arrow, letter
      // and Enter was consumed against a panel the user could not see, and
      // Enter still clicked a page element.
      //
      // Deliberately not `{ once: true }`: a restored page can be hidden again,
      // and the second hide has to clean up too.
      agent = null
    })

    // Nothing else happens here, so activating is the first thing that costs
    // anything. Reading storage and asking the worker for a checkpoint both
    // used to happen at this point; the second one *woke the service worker*
    // just to fetch a value that is null unless the panel was open on this tab
    // before. Both now wait for the first open. See `prime`.
  }
})
