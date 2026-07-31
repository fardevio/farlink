import { isOpenable, SHORTCUTS_URL } from "~/lib/messaging"
import type { ContentMessage, TabResult } from "~/lib/messaging"
import type { SerializedAnchor } from "~/lib/nav/session"

/**
 * The service worker is killed after ~30 s idle, so it holds no navigation
 * state. It exists to do the five things a content script cannot: open tabs,
 * inject on the cold path, persist a cursor checkpoint across navigation, report
 * what the toggle command is actually bound to, and open Chrome's own shortcut
 * editor.
 *
 * Note it owns no host permissions, because the extension declares none —
 * `activeTab` is granted by the invocation itself.
 */

const CONTENT_SCRIPT = "content-scripts/farlink.js"

/**
 * Chrome's own action command. There is no named command any more: with no
 * popup declared, a key bound here fires `action.onClicked`, the same listener
 * the toolbar button uses.
 */
const TOGGLE = "_execute_action"

function checkpointKey(tabId: number): string {
  return `farlink_cursor_${tabId}`
}

/**
 * A saved cursor, with the origin it was saved on.
 *
 * The origin is the whole point: the store is keyed by tab, and a tab outlives
 * the page in it. See the `restore` handler.
 */
interface Checkpoint {
  origin: string
  anchor: SerializedAnchor | null
}

/** The sender's origin, or null when it cannot be established. */
function originOf(sender: chrome.runtime.MessageSender): string | null {
  if (sender.origin) return sender.origin
  if (!sender.url) return null
  try {
    return new URL(sender.url).origin
  } catch {
    return null
  }
}

/**
 * A rolling ceiling on tab creation.
 *
 * A per-message cap is not a cap: the sender chooses how many messages to
 * send. The user-facing worst case this protects is a page that manages to
 * drive the content script into opening hundreds of foreground tabs, which a
 * page cannot do on its own but the privileged worker can.
 */
const TAB_LIMIT = 20
const TAB_WINDOW_MS = 5000
let tabTimestamps: number[] = []

function tabBudget(): number {
  const now = Date.now()
  tabTimestamps = tabTimestamps.filter((t) => now - t < TAB_WINDOW_MS)
  return Math.max(0, TAB_LIMIT - tabTimestamps.length)
}

function spendTab(): void {
  tabTimestamps.push(Date.now())
}

/**
 * Cold path: `activeTab` is granted by the command invocation itself, so the
 * script can be injected without any declared host permission. Injection is
 * idempotent, because the content script guards on a window flag.
 */
async function ensureInjected(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT]
    })
    return true
  } catch (error) {
    // Restricted pages (chrome://, the Web Store, other extensions' pages)
    // reject injection and there is nothing useful to do about it.
    console.warn("[farlink] cannot inject into this page", error)
    return false
  }
}

async function messageTab(tabId: number, message: unknown): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message)
  } catch {
    // The content script may not be listening yet on a page that just began
    // loading; the next invocation will land.
  }
}

export default defineBackground(() => {
  /**
   * Put the real state of the shortcut in the button's tooltip.
   *
   * A global hotkey from another app wins before Chrome sees the key, and when
   * that happens nothing says why: the shortcut simply does nothing, and the
   * toolbar button becomes the only way in.
   *
   * `commands.getAll()` reporting an empty `shortcut` is the only signal
   * available. Chrome fires no event when the user rebinds, so this can go
   * stale until the next startup.
   */
  const describeShortcut = async (): Promise<void> => {
    try {
      const commands = await chrome.commands.getAll()
      const chord = commands.find((c) => c.name === TOGGLE)?.shortcut
      await chrome.action.setTitle({
        title: chord
          ? `FarLink — open on this page (${chord})`
          : "FarLink — open on this page. No keyboard shortcut is bound: " +
            "another app or extension may have taken it. Right-click to set one."
      })
    } catch {
      // A tooltip is not worth a broken worker.
    }
  }

  chrome.runtime.onInstalled.addListener(() => void describeShortcut())
  chrome.runtime.onStartup.addListener(() => void describeShortcut())

  /**
   * Clicking the toolbar button toggles the panel, rather than opening a menu
   * about it.
   *
   * A click grants `activeTab` exactly as the command does, and it is the only
   * way in when the chord is unbound or the page is one Chrome will not let a
   * command reach.
   */
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id === undefined) return
    if (!(await ensureInjected(tab.id))) return
    await messageTab(tab.id, { type: "toggle" })
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove(checkpointKey(tabId))
  })

  chrome.runtime.onMessage.addListener(
    (message: ContentMessage, sender, sendResponse) => {
      // Only this extension's own contexts may drive the worker. There is no
      // `externally_connectable` and no `onMessageExternal` listener today, so
      // nothing else can reach here, but this handler opens tabs, and that
      // should not depend on a manifest key staying absent.
      if (sender.id !== chrome.runtime.id) return false

      const tabId = sender.tab?.id

      switch (message.type) {
        case "open-tabs": {
          if (!Array.isArray(message.urls)) return false
          // One result per URL. This used to reply `{ ok: true }` from outside
          // the loop, so a skipped scheme, an exhausted budget and a rejected
          // create were all indistinguishable from success — and the panel had
          // already told the user "Opened tab".
          void (async () => {
            const results: TabResult[] = []
            for (const url of message.urls) {
              if (typeof url !== "string") continue
              // `new URL().href` has already normalized the scheme by the time
              // it gets here, so an anchored test is sufficient.
              if (!isOpenable(url)) {
                results.push({ url, opened: false, reason: "not-web" })
                continue
              }
              if (tabBudget() === 0) {
                results.push({ url, opened: false, reason: "throttled" })
                continue
              }
              spendTab()
              try {
                await chrome.tabs.create({
                  url,
                  active: !message.background,
                  openerTabId: tabId
                })
                results.push({ url, opened: true })
              } catch {
                results.push({ url, opened: false, reason: "failed" })
              }
            }
            sendResponse({ results })
          })()
          return true
        }

        case "shortcut": {
          // The one thing the panel cannot find out for itself. A global hotkey
          // in another app wins before Chrome sees the key, and then the
          // shortcut silently does nothing with no way to discover why.
          //
          // The catch is load-bearing. Without it a rejected getAll() means
          // sendResponse is never called, the channel stays open until it is
          // torn down, and the caller's promise never settles — which latches
          // `chordPending` for the life of the page and leaves the Shortcut row
          // reading "checking…" forever. That is the same latch the content
          // script's own comment records having already been fixed once.
          void chrome.commands
            .getAll()
            .then((commands) => {
              sendResponse({
                chord: commands.find((c) => c.name === TOGGLE)?.shortcut ?? ""
              })
            })
            .catch(() => sendResponse({ chord: "" }))
          return true
        }

        case "open-shortcuts": {
          // A fixed page, not a URL from the message. chrome:// is outside what
          // `open-tabs` will open, and it stays that way.
          //
          // The result is reported rather than discarded. Chrome can refuse to
          // navigate to a chrome:// page, and a silent refusal leaves the user
          // pressing Enter on the one row that exists to unstick them.
          void chrome.tabs
            .create({ url: SHORTCUTS_URL })
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }))
          return true
        }

        case "checkpoint": {
          if (tabId === undefined) return false
          const origin = originOf(sender)
          // No origin means nothing downstream could check it, and an anchor
          // that cannot be checked is worse than no anchor.
          if (origin === null) return false
          void chrome.storage.session.set({
            [checkpointKey(tabId)]: { origin, anchor: message.anchor }
          })
          return false
        }

        case "restore": {
          if (tabId === undefined) return false
          const origin = originOf(sender)
          void chrome.storage.session
            .get(checkpointKey(tabId))
            .then((stored) => {
              const saved = stored[checkpointKey(tabId)] as
                Checkpoint | undefined
              // The key is the tab, not the page, so the checkpoint outlives a
              // navigation to an unrelated site in the same tab. Without this
              // check, selecting "Login" on one site and then opening FarLink on
              // another put the cursor on *that* site's "Login": the selector
              // degrades to a tag-only `A[href]`, and nameHash + textHash +
              // ancestors clear CONFIDENT on their own — so the cursor landed on
              // an unrelated link on a different origin and was marked
              // activatable.
              if (!saved || saved.origin !== origin) {
                if (saved)
                  void chrome.storage.session.remove(checkpointKey(tabId))
                sendResponse({ anchor: null })
                return
              }
              sendResponse({ anchor: saved.anchor })
            })
          return true
        }

        default:
          return false
      }
    }
  )
})
