import { escapeSelector } from "./css-escape"
import { tagOf } from "./roles"

/**
 * Accessible name, in AccName order:
 *
 *   aria-labelledby -> aria-label -> native (<label>, alt, <caption>, <legend>)
 *   -> text content -> title -> <svg><title> -> nested img alt -> value
 *
 * The order is load-bearing: an icon-only control has no text content, so it
 * falls all the way to `<svg><title>` and would otherwise render as an empty
 * row. The last two steps are beyond the spec and exist for the same reason.
 */

const MAX_NAME = 120
/** How many `aria-labelledby` references are followed. */
const MAX_LABEL_REFS = 16
/** Read window before whitespace normalization. See `clean`. */
const MAX_RAW = 4096

function clean(text: string | null | undefined): string {
  if (!text) return ""
  // Slice first. A page can hand us a multi-megabyte text node, and
  // normalizing all of it to produce 120 characters is pure waste on a path
  // that runs for every visible node.
  return text.slice(0, MAX_RAW).replace(/\s+/g, " ").trim().slice(0, MAX_NAME)
}

function rootOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode()
  return root instanceof ShadowRoot ? root : el.ownerDocument
}

function byIds(el: Element, ids: string): string {
  const root = rootOf(el)
  const parts: string[] = []
  for (const id of ids.trim().split(/\s+/).slice(0, MAX_LABEL_REFS)) {
    if (!id) continue
    // getElementById exists on Document; ShadowRoot needs a selector.
    const target =
      "getElementById" in root
        ? root.getElementById(id)
        : (root as ShadowRoot).querySelector(`#${escapeSelector(id)}`)
    // A full name computation on the referenced node, per AccName step 2B —
    // not its text. This read `clean(target.textContent)`, so an icon link
    // labelled by a span that carries `aria-label` (or wraps an `<img alt>`)
    // came back empty. `linkTargets` drops links whose name is empty, so the
    // link did not even render as "(unnamed link)": it vanished from the index.
    //
    // `textContent`, not `innerText`, for the fallback: a referenced label is
    // very often visually hidden on purpose, and AccName includes it anyway.
    if (target) {
      parts.push(nameWithoutRefs(target, (node) => clean(node.textContent)))
    }
  }
  return clean(parts.join(" "))
}

/**
 * Returns null when no host-language labelling mechanism applied, and "" when
 * one applied and was deliberately empty. The distinction matters for
 * `alt=""`: per AccName that marks the image decorative and terminates with an
 * empty name, rather than falling through to `title`.
 */
function nativeName(el: Element): string | null {
  const tag = tagOf(el)

  if (tag === "IMG" || tag === "AREA" || tag === "INPUT") {
    const alt = el.getAttribute("alt")
    if (alt !== null) return clean(alt)
  }

  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
    const id = el.getAttribute("id")
    if (id) {
      const root = rootOf(el)
      const label = root.querySelector(`label[for="${escapeSelector(id)}"]`)
      if (label) return clean(label.textContent)
    }
    const wrapping = el.closest("label")
    if (wrapping) return clean(wrapping.textContent)
    const placeholder = el.getAttribute("placeholder")
    if (placeholder) return clean(placeholder)
  }

  if (tag === "TABLE") {
    const caption = el.querySelector("caption")
    if (caption && caption.closest("table") === el) {
      return clean(caption.textContent)
    }
  }

  if (tag === "FIELDSET") {
    const legend = el.querySelector("legend")
    if (legend) return clean(legend.textContent)
  }

  if (tag === "FIGURE") {
    const caption = el.querySelector("figcaption")
    if (caption) return clean(caption.textContent)
  }

  return null
}

/**
 * Text content, preferring `innerText` so CSS-hidden subtrees are excluded.
 * `innerText` forces layout, so callers on hot paths should batch their reads.
 */
function textName(el: Element): string {
  const inner = (el as HTMLElement).innerText
  return clean(typeof inner === "string" ? inner : el.textContent)
}

export function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute?.("aria-labelledby")
  if (labelledBy) {
    const name = byIds(el, labelledBy)
    if (name) return name
  }

  return nameWithoutRefs(el, textName)
}

/**
 * Every step after `aria-labelledby`, shared by an element and by a node it
 * references. References are not followed from here: AccName forbids recursing
 * through them, and a pair of elements labelling each other would not
 * terminate.
 *
 * `readText` is the one difference between the two callers. See `byIds`.
 */
function nameWithoutRefs(
  el: Element,
  readText: (el: Element) => string
): string {
  const label = el.getAttribute?.("aria-label")
  if (label) {
    const name = clean(label)
    if (name) return name
  }

  const native = nativeName(el)
  if (native !== null) return native

  const text = readText(el)
  if (text) return text

  const title = el.getAttribute?.("title")
  if (title) {
    const name = clean(title)
    if (name) return name
  }

  // Icon-only controls: <button><svg><title>Close</title></svg></button>
  const svgTitle = el.querySelector?.("svg > title, svg > desc")
  if (svgTitle) {
    const name = clean(svgTitle.textContent)
    if (name) return name
  }

  // Last resort: an image's alt text somewhere inside.
  const img = el.querySelector?.("img[alt]:not([alt=''])")
  if (img) {
    const name = clean(img.getAttribute("alt"))
    if (name) return name
  }

  const value = (el as HTMLInputElement).value
  if (typeof value === "string" && value) return clean(value)

  return ""
}

/**
 * A short description for the HUD when the name is empty — never fabricates a
 * name, so the UI can render "(unnamed link)" rather than a plausible lie.
 */
export function fallbackDescription(el: Element, role: string): string {
  const href = el.getAttribute?.("href")
  if (role === "link" && href) {
    try {
      const url = new URL(href, location.href)
      return url.hostname + url.pathname
    } catch {
      return href
    }
  }
  return `(unnamed ${role})`
}
