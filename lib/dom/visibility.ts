import { cached, cachedGlobal, newGlobalSlot, newStore } from "./cache"
import { tagOf } from "./roles"

export type Visibility =
  /** Rendered and navigable. */
  | "visible"
  /** Not rendered at all; skip the subtree. */
  | "hidden"
  /** No box of its own (`display: contents`) but real children beneath. */
  | "transparent"
  /**
   * Visually clipped but exposed to assistive tech — the `.sr-only` pattern.
   * Not a node; its text is name material for an ancestor.
   */
  | "screen-reader-only"

/**
 * Elements that legitimately have no box but are still meaningful, so a
 * zero-rect test must not discard them.
 */
const BOXLESS_OK: ReadonlySet<string> = new Set([
  "AREA",
  "COL",
  "COLGROUP",
  "OPTION",
  "OPTGROUP",
  "PARAM",
  "TRACK"
])

// All four values at 0 or 1px, the two spellings of the recipe. Reading only
// the first misfiled `rect(0px, 500px, 300px, 0px)`, a crop that starts at the
// top edge, and `inset(50% 0 0 0)` likewise keeps the lower half visible.
const CLIP_RE = /rect\(\s*[01](px)?([\s,]+[01](px)?){3}\s*\)/
const INSET_FULL_RE = /inset\(\s*(50%|100%)\s*\)/

/**
 * The `.sr-only` recipe: pull out of flow, shrink to ~1px, and clip. Detecting
 * it matters because such elements carry *text* — treating them as collapsed
 * disclosures promotes invisible rows into the tree.
 */
function isScreenReaderOnly(
  style: CSSStyleDeclaration,
  rect: DOMRect
): boolean {
  const clipped =
    CLIP_RE.test(style.clip || "") ||
    INSET_FULL_RE.test(style.clipPath || "") ||
    style.clipPath === "inset(100%)"
  if (clipped) return true

  const positioned = style.position === "absolute" || style.position === "fixed"
  const tiny = rect.width <= 1 && rect.height <= 1
  return positioned && tiny && style.overflow === "hidden"
}

export interface VisibilityOptions {
  /**
   * Injected in tests. happy-dom does not lay out, so every rect is zero and
   * the geometry checks would discard the whole document.
   */
  rectOf?: (el: Element) => DOMRect
  styleOf?: (el: Element) => CSSStyleDeclaration
}

const visibilities = newStore<Visibility>()
const anyInert = newGlobalSlot<boolean>()

export function visibilityOf(
  el: Element,
  opts: VisibilityOptions = {}
): Visibility {
  return cached(visibilities, el, () => computeVisibility(el, opts))
}

function computeVisibility(el: Element, opts: VisibilityOptions): Visibility {
  if (el.getAttribute?.("aria-hidden") === "true") return "hidden"
  if ((el as HTMLElement).hidden) return "hidden"
  if (el.hasAttribute?.("inert")) return "hidden"

  // `closest` catches inert *ancestors*, but walking up from every element on
  // the page is not free and `inert` is rare. Ask the document once per pass.
  const hasInert = cachedGlobal(anyInert, () =>
    Boolean(el.ownerDocument?.querySelector("[inert]"))
  )
  if (hasInert && el.closest?.("[inert]")) return "hidden"

  const style = (opts.styleOf ?? getComputedStyle)(el)
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse"
  ) {
    return "hidden"
  }
  if (style.display === "contents") return "transparent"
  if (style.opacity === "0") return "hidden"

  if (BOXLESS_OK.has(tagOf(el))) return "visible"

  const rect = (opts.rectOf ?? ((e: Element) => e.getBoundingClientRect()))(el)

  if (rect.width === 0 && rect.height === 0) {
    if (isScreenReaderOnly(style, rect)) return "screen-reader-only"
    // A zero box with substantial text is more often an sr-only variant we
    // failed to fingerprint than a real collapsed section. Treat it as name
    // material rather than promoting an invisible row into the tree.
    const text = (el.textContent || "").trim()
    return text.length > 0 ? "screen-reader-only" : "hidden"
  }

  if (isScreenReaderOnly(style, rect)) return "screen-reader-only"

  return "visible"
}
