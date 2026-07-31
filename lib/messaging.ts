import type { SerializedAnchor } from "~/lib/nav/session"

/**
 * Where Chrome keeps the shortcut editor. Extensions may open it, but only from
 * the worker: a content script cannot navigate to a chrome:// page. Shared so
 * the worker that opens it and the row that falls back to showing it agree.
 */
export const SHORTCUTS_URL = "chrome://extensions/shortcuts"

/**
 * Content script to service worker. The worker is killed after ~30 s idle, so
 * it holds no navigation state: it only does what a content script cannot.
 */
export type ContentMessage =
  | { type: "open-tabs"; urls: string[]; background: boolean }
  | { type: "checkpoint"; anchor: SerializedAnchor | null }
  /** Sent by the content script on activation; answered with `{ anchor }`. */
  | { type: "restore" }
  /** Answered with `{ chord }`: what the toggle is actually bound to, or "". */
  | { type: "shortcut" }
  /**
   * Open the browser's own shortcut editor. No URL travels with this: the page
   * it opens is fixed in the worker, so nothing here can widen what `open-tabs`
   * is allowed to open.
   */
  | { type: "open-shortcuts" }

/**
 * Whether the worker will open this URL in a tab.
 *
 * Exported so the panel and the worker cannot disagree about it. They used to:
 * the rule lived only in the worker, which skipped anything non-http and replied
 * `{ ok: true }` regardless, while the panel had already said "Opened tab". A
 * `mailto:` link is indexed and displayed on purpose — `formatUrl` has a branch
 * for exactly those schemes — so the most ordinary contact link on the web
 * reported success and opened nothing.
 *
 * The rule itself is deliberately narrow and stays that way. Widening it is how
 * a privileged worker starts launching mail clients and native handlers on
 * behalf of a page.
 */
export function isOpenable(url: string): boolean {
  return /^https?:/i.test(url)
}

/** Why a URL the panel asked for was not opened. */
export type TabRefusal =
  /** Not http(s): the worker will not hand it to the platform. */
  | "not-web"
  /** The rolling tab ceiling was already spent. */
  | "throttled"
  /** Chrome refused the create. */
  | "failed"

/**
 * One entry per URL, so there is no way to spell success without evidence.
 *
 * Deliberately not an aggregate flag. `{ ok: true }` could not distinguish
 * "opened everything" from "opened nothing", and three separate paths through
 * the worker produced the second while reporting the first.
 */
export type TabResult =
  | { url: string; opened: true }
  | { url: string; opened: false; reason: TabRefusal }

export interface OpenTabsReply {
  results: TabResult[]
}

/** Service worker -> content script. */
export type WorkerMessage = { type: "toggle" }

export function sendToWorker<T = unknown>(
  message: ContentMessage
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        // Reading lastError suppresses the "unchecked runtime.lastError" noise
        // that appears whenever the worker was asleep and the port closed.
        void chrome.runtime.lastError
        resolve((response as T) ?? null)
      })
    } catch {
      resolve(null)
    }
  })
}
