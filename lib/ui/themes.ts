import { FLAVORS } from "./palettes"
import type { Flavor, Palette } from "./palettes"

export type { Flavor, Palette }
export { FLAVORS }

export const DEFAULT_FLAVOR = "far"

/** Monospace stack. The whole point is that it reads like a file manager. */
export const MONO_STACK =
  '"SF Mono", "JetBrains Mono", "Fira Code", "Cascadia Mono", ' +
  'Menlo, Consolas, "DejaVu Sans Mono", monospace'

export function findFlavor(id: string): Flavor {
  return FLAVORS.find((f) => f.id === id) ?? FLAVORS[0]!
}

/**
 * The next flavor after `id`, wrapping around.
 *
 * "auto" resolves first, so cycling from it steps off the resolved flavor
 * rather than jumping to the second in the list — otherwise the first press
 * looks like it skipped one.
 */
export function nextFlavorId(id: string, resolved: string): string {
  const from = id === "auto" ? resolved : id
  const at = FLAVORS.findIndex((f) => f.id === from)
  return FLAVORS[(at + 1) % FLAVORS.length]!.id
}

/**
 * Resolve "auto" against the *user's* color scheme, not the page's. A dark
 * page with a light OS theme should still get the light flavor if that is
 * what the user asked for.
 */
export function resolveFlavor(
  id: string,
  autoDark = "far",
  autoLight = "paper"
) {
  if (id !== "auto") return findFlavor(id)
  const prefersDark = window.matchMedia?.(
    "(prefers-color-scheme: dark)"
  ).matches
  return findFlavor(prefersDark ? autoDark : autoLight)
}

/** The `--fl-*` custom properties for a flavor. */
export function flavorVariables(flavor: Flavor): Record<string, string> {
  const palette = flavor.palette
  const vars: Record<string, string> = { "--fl-font": MONO_STACK }
  for (const [key, value] of Object.entries(palette)) {
    vars[`--fl-${kebab(key)}`] = value
  }
  return vars
}

export function applyFlavor(host: HTMLElement, flavor: Flavor): void {
  for (const [name, value] of Object.entries(flavorVariables(flavor))) {
    host.style.setProperty(name, value)
  }
  host.dataset.scheme = flavor.scheme
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/** Contrast ratio per WCAG 2.1, used by the theme tests. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const value = hex.replace("#", "")
    const channel = (offset: number) => {
      const raw = parseInt(value.slice(offset, offset + 2), 16) / 255
      return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  }
  const la = lum(a)
  const lb = lum(b)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}
