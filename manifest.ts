/**
 * The manifest, and the store's limits on it.
 *
 * Separate from `wxt.config.ts` so a test can read it without importing `wxt`,
 * whose barrel pulls in the whole build stack (~400 ms of collect time).
 */

/**
 * Maximum lengths, in characters. Nothing in WXT or the build validates these,
 * so an over-long field passes `pnpm check` and `pnpm zip` and is rejected at
 * upload. `name` shipped at 49 against a limit of 45.
 */
export const STORE_LIMITS = {
  name: 45,
  short_name: 12,
  description: 132
} as const

/**
 * The icon sizes on disk, as a manifest icons map. Kept in step with SIZES in
 * `scripts/make-icons.mjs` by a test, so adding a size there without adding it
 * here cannot silently put Chrome back to resampling.
 */
export const ICON_SIZES = Object.fromEntries(
  [16, 24, 32, 48, 96, 128].map((size) => [size, `icon/${size}.png`])
)

export const MANIFEST = {
  name: "FarLink — Every link on a page, by keyboard",
  short_name: "FarLink",
  // The subtitle the Web Store shows. Keep it in step with the product.
  description:
    "Every link on a page in one keyboard-driven list. Filter by title or " +
    "address, then open it here or in a new tab. No mouse.",
  permissions: ["storage", "scripting", "activeTab"],
  minimum_chrome_version: "116",
  /**
   * Every size Chrome may ask for, so it never has to resample.
   *
   * The icon is pixel art rendered per size by `pnpm icons`; scaling it is what
   * makes it look broken, and Chrome scales whatever it can find when the size
   * it wants is missing. `icons` covers the management page and the store,
   * `action.default_icon` the toolbar, and both list the lot rather than a
   * subset, because guessing which slot a display density will ask for is how
   * the gap appeared in the first place.
   */
  icons: ICON_SIZES,
  // No `default_popup`: the click toggles the panel directly, and a popup would
  // make the command open a menu instead of firing action.onClicked.
  action: {
    default_title: "FarLink — open on this page",
    default_icon: ICON_SIZES
  },
  /**
   * One command, and it is Chrome's own.
   *
   * Declaring an `action` makes Chrome list `_execute_action` in
   * chrome://extensions/shortcuts whether we want it or not, and with no popup
   * it fires `action.onClicked` -- which is exactly what a named toggle command
   * did. Two rows, two code paths, one behavior. Putting the key here leaves
   * one row that does one thing, and the toolbar click and the chord are then
   * the same call rather than two that have to agree.
   *
   * The cost is that Chrome writes the label ("Activate the extension") and we
   * cannot. That is a fair trade against a row we could never hide, and against
   * the label it replaces, which read "Toggle structural navigation" -- jargon
   * from levels and columns that no longer exist.
   */
  commands: {
    _execute_action: {
      suggested_key: {
        // `default` covers Windows and Linux. A command with only a `mac`
        // binding shows up in chrome://extensions/shortcuts with no key
        // attached everywhere else, which reads as broken rather than unbound.
        default: "Ctrl+Shift+Space",
        mac: "Command+Shift+Space"
      }
    }
  }
}

/**
 * Throws if a limited field is too long, so `wxt zip` fails rather than
 * producing a package that cannot be uploaded. Takes the generated manifest,
 * not `MANIFEST`, so it checks what is actually written.
 */
export function assertStoreLimits(manifest: Record<string, unknown>): void {
  for (const [field, limit] of Object.entries(STORE_LIMITS)) {
    const value = manifest[field]
    if (typeof value !== "string") continue
    if (value.length > limit) {
      throw new Error(
        `manifest.${field} is ${value.length} characters; the Chrome Web ` +
          `Store limit is ${limit}. Shorten it: ${JSON.stringify(value)}`
      )
    }
  }
}
