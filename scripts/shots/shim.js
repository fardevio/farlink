/**
 * Minimal `chrome` surface so the built content script runs on a live page.
 *
 * The gstack browser cannot load an unpacked extension, but the bundle only
 * touches a handful of chrome.* members. `runtime.id` must exist or WXT's
 * polyfill throws "This script should only be loaded in a browser extension".
 *
 * Read `window.__shot` (set before this file runs) for the settings the shot
 * wants — theme, corner, size.
 */
;(() => {
  const wanted = window.__shot || {}
  const settings = {
    flavorId: wanted.flavorId || "far",
    dockX: wanted.dockX || "left",
    dockY: wanted.dockY || "bottom",
    size: wanted.size || "normal"
  }

  const store = { farlink_settings: settings }
  const listeners = []

  window.chrome = {
    runtime: {
      id: "farlink-shot",
      lastError: undefined,
      getManifest: () => ({ version: "0.1.0" }),
      getURL: (p) => p,
      sendMessage: (msg, cb) => {
        if (!cb) return
        if (msg && msg.type === "restore") cb({ anchor: null })
        else if (msg && msg.type === "shortcut") cb({ chord: "⇧⌘Space" })
        else if (msg && msg.type === "open-tabs") {
          cb({
            results: (msg.urls || []).map((url) => ({ url, opened: true }))
          })
        } else cb({ ok: true })
      },
      onMessage: { addListener: (fn) => listeners.push(fn) }
    },
    storage: {
      sync: {
        get: async (k) => (k ? { [k]: store[k] } : { ...store }),
        set: async (o) => Object.assign(store, o)
      },
      session: {
        get: async () => ({}),
        set: async () => {}
      },
      onChanged: { addListener: () => {} }
    }
  }
  window.browser = window.chrome

  window.__farlink = {
    toggle: () => listeners.forEach((fn) => fn({ type: "toggle" })),
    ready: () => listeners.length > 0
  }
})()
