/**
 * Where `el` goes, or null when it goes nowhere.
 *
 * Deliberately strict about the second half. `href="#"` and
 * `href="javascript:…"` are buttons wearing a link's clothes, and on a page
 * like Wikipedia they are most of what is not an article link: "Hide
 * Contents", every "Toggle … subsection". A row with no destination is a row
 * with an empty address column, and the panel calls itself a link index.
 */
export function hrefOf(el: Element): string | null {
  const isLink = el.matches?.("a[href]") === true

  // Descend only when the element is not itself a control. A
  // `<div role="button">` wrapping an anchor is a button: clicking it runs the
  // page's handler, and where the nested anchor points is not where the row
  // goes. Reporting that anchor gave one row three different answers — the
  // address column and Alt+Enter both showed the anchor's URL while
  // `activationTarget` stopped at the wrapper, so Enter clicked the div. A
  // share button wrapping a twitter.com/intent link is the everyday shape of
  // it. The two functions have to agree on what a row *is*, so this uses
  // activationTarget's own list minus the link case.
  if (!isLink && el.matches?.("button, [role=button], [role=link], input")) {
    return null
  }

  const anchor = isLink ? el : el.querySelector?.("a[href]")
  const raw = anchor?.getAttribute("href")?.trim()
  if (!raw) return null

  // A bare "#" is ambiguous, and both readings are common. In HTML it means the
  // top of the document, which is a real place to go. Wikipedia's "(Top)" link
  // is exactly that. It is also what a script-driven control uses when it wants
  // something focusable and no navigation. The aria that makes it a control is
  // what tells the two apart, so that is what is tested rather than the href.
  if (raw === "#" && anchor && isControl(anchor)) return null

  try {
    const url = new URL(raw, el.ownerDocument.baseURI)
    // Resolved rather than pattern-matched on the raw value, so
    // "JavaScript:", leading whitespace and entity tricks are all covered.
    return url.protocol === "javascript:" ? null : url.href
  } catch {
    return null
  }
}

/** An anchor that behaves as a button rather than as a link. */
function isControl(anchor: Element): boolean {
  return (
    anchor.getAttribute("role") === "button" ||
    anchor.hasAttribute("aria-expanded") ||
    anchor.hasAttribute("aria-controls")
  )
}

/**
 * A URL shortened for a one-line listing.
 *
 * Three tiers, each dropping what the row above it already told you. Off-site
 * links lead with the host, the thing you actually want to check before
 * following. Same-origin links show only their path, because repeating the host
 * you are already on down the whole column is noise. Links into *this* page show
 * only the fragment, for the same reason one step further: on a Wikipedia
 * article every contents entry read "/wiki/Nile#Geography", "/wiki/Nile#Sources",
 * with the same eleven characters on every row and the part that differs pushed
 * to the end. Long values are middle-truncated so the end, which carries the
 * slug, survives.
 */
export function formatUrl(href: string, base = location.href): string {
  let url: URL
  try {
    url = new URL(href, base)
  } catch {
    return href.slice(0, 48)
  }

  let here: URL | null = null
  try {
    here = new URL(base)
  } catch {
    here = null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `${url.protocol}${url.pathname}`.slice(0, 48)
  }

  const origin = here?.origin ?? ""

  // A fragment on the page you are already looking at: the path is noise.
  // Only when there *is* a fragment. A bare link back to this page is a
  // reload, not a jump, and "#" would misdescribe it.
  if (here && url.hash && isSamePage(url, here)) return middle(url.hash, 44)

  const path = url.pathname === "/" ? "" : url.pathname
  const tail = path + url.search + url.hash
  if (url.origin === origin) return middle(tail || "/", 44)

  const host = url.hostname.replace(/^www\./, "")
  return middle(host + tail, 44)
}

/**
 * Whether two URLs are the same document, differing at most in their fragment.
 *
 * Following one of these is not a page load: the browser jumps and nothing
 * unloads, so it must not be dressed up as one.
 */
export function isSamePage(url: URL, base: URL): boolean {
  return (
    url.origin === base.origin &&
    url.pathname === base.pathname &&
    url.search === base.search
  )
}

/** True when following `href` from `base` only moves within the document. */
export function isFragmentJump(href: string, base: string): boolean {
  try {
    const url = new URL(href, base)
    return url.hash !== "" && isSamePage(url, new URL(base))
  } catch {
    return false
  }
}

/** Truncate in the middle, so both the start and the slug survive. */
function middle(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

export function textOf(el: Element): string {
  const inner = (el as HTMLElement).innerText
  const text = typeof inner === "string" ? inner : el.textContent
  return (text || "").replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * The element that should actually receive a click. A record's click target is
 * usually a link inside it rather than the record box.
 */
export function activationTarget(el: Element): Element | null {
  if (
    el.matches?.("a[href], button, [role=button], [role=link], input, select")
  )
    return el
  return (
    el.querySelector?.("a[href], button, [role=button], [role=link]") ?? null
  )
}
