import { DEFAULT_FLAVOR } from "~/lib/ui/themes"

export interface Settings {
  /** A flavor id from lib/ui/palettes.ts, or "auto". */
  flavorId: string
  /** Which corner the panel sits in. Moved with Alt and the arrow keys. */
  dockX: "left" | "right"
  dockY: "top" | "bottom"
  /** How much of the viewport the panel takes. Cycled with Alt+S. */
  size: "compact" | "normal" | "full"
}

export const DEFAULT_SETTINGS: Settings = {
  flavorId: DEFAULT_FLAVOR,
  dockX: "left",
  dockY: "bottom",
  size: "normal"
}

const SETTINGS_KEY = "farlink_settings"

function warn(operation: string, error: unknown): void {
  console.warn(`[farlink] settings ${operation} failed`, error)
}

export async function loadSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY)
    const stored = result[SETTINGS_KEY] as Partial<Settings> | undefined
    return { ...DEFAULT_SETTINGS, ...stored }
  } catch (error) {
    warn("load", error)
    return DEFAULT_SETTINGS
  }
}

/**
 * Writes are serialized on a single chain. Each one is read-modify-write, so
 * two toggles in quick succession would otherwise both read the old value and
 * the second would silently discard the first — invisibly, because the options
 * page updates its local state optimistically.
 */
let writeQueue: Promise<void> = Promise.resolve()

export function saveSettings(patch: Partial<Settings>): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    try {
      const current = await loadSettings()
      await chrome.storage.sync.set({
        [SETTINGS_KEY]: { ...current, ...patch }
      })
    } catch (error) {
      warn("save", error)
    }
  })
  return writeQueue
}

export function onSettingsChanged(
  fn: (settings: Settings) => void
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => {
    if (area !== "sync" || !changes[SETTINGS_KEY]) return
    const next = changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined
    fn({ ...DEFAULT_SETTINGS, ...next })
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
