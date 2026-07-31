import { cached, newStore } from "./cache"

/**
 * Role assignment: explicit `role` first, then an HTML-AAM-style tag mapping.
 *
 * Two details that bit the research spikes and are load-bearing here:
 *   - SVG tagNames are lowercase, so every comparison goes through `tagOf()`,
 *     which uppercases. A case-sensitive skip set silently admits <g>/<path>.
 *   - `role="presentation"` / `role="none"` means *not structure*. Treating any
 *     explicit role as "this is real structure" inverts the one case that
 *     matters most for layout tables.
 */

// Prototype-less: `tag` is page-controlled, and a plain object literal would
// answer `<constructor>` or `<toString>` with an inherited member. `tagOf()`
// uppercases, which happens to miss every Object.prototype key, but relying on
// that coincidence is not a security boundary.
const TAG_ROLE: Readonly<Record<string, string>> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    A: "link",
    ARTICLE: "article",
    ASIDE: "complementary",
    BLOCKQUOTE: "blockquote",
    BUTTON: "button",
    CANVAS: "canvas",
    DETAILS: "group",
    IFRAME: "frame",
    DIALOG: "dialog",
    FIGCAPTION: "caption",
    FIGURE: "figure",
    FOOTER: "contentinfo",
    FORM: "form",
    H1: "heading",
    H2: "heading",
    H3: "heading",
    H4: "heading",
    H5: "heading",
    H6: "heading",
    HEADER: "banner",
    IMG: "img",
    LI: "listitem",
    MAIN: "main",
    NAV: "navigation",
    OL: "list",
    OPTION: "option",
    P: "paragraph",
    PRE: "code",
    SECTION: "region",
    SELECT: "combobox",
    SUMMARY: "summary",
    TABLE: "table",
    TD: "cell",
    TEXTAREA: "textbox",
    TH: "columnheader",
    TR: "row",
    UL: "list",
    VIDEO: "video"
  }
)

/** Roles worth showing as their own level in the navigation tree. */
export const SIGNIFICANT: ReadonlySet<string> = new Set([
  "article",
  "banner",
  "blockquote",
  "button",
  "canvas",
  "cell",
  "checkbox",
  "code",
  "frame",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "dialog",
  "figure",
  "form",
  "grid",
  "gridcell",
  "heading",
  "img",
  "link",
  "list",
  "listitem",
  "main",
  "menuitem",
  "navigation",
  "option",
  "paragraph",
  "radio",
  "record",
  "region",
  "row",
  "search",
  "summary",
  "switch",
  "tab",
  "table",
  "tablist",
  "textbox",
  "treeitem",
  "video"
])

/**
 * Roles that carry a click target. A single-child chain must never be unwrapped
 * *through* one of these, because doing so discards the element the user needs to
 * activate (this cost 17 real links on one GitHub page during research).
 */
export const ACTIONABLE: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "option",
  "radio",
  "switch",
  "tab",
  "textbox"
])

const PRESENTATIONAL: ReadonlySet<string> = new Set(["presentation", "none"])

/** Never entered: no user-visible structure inside. SVG tags included. */
const SKIP_TAGS: ReadonlySet<string> = new Set([
  "BR",
  "CIRCLE",
  "CLIPPATH",
  "DEFS",
  "ELLIPSE",
  "FILTER",
  "G",
  "HEAD",
  "LINEARGRADIENT",
  "LINK",
  "MARKER",
  "MASK",
  "META",
  "NOSCRIPT",
  "PATH",
  "POLYGON",
  "POLYLINE",
  "RECT",
  "SCRIPT",
  "STOP",
  "STYLE",
  "SVG",
  "SYMBOL",
  "TEMPLATE",
  "TEXTPATH",
  "TITLE",
  "TSPAN",
  "USE"
])

/**
 * Entered but never emitted as a node of their own. Pure grouping wrappers.
 * Distinct from SKIP_TAGS: putting TBODY in the skip set prunes every row
 * beneath it, which is how one research spike reported zero nodes on a table.
 */
const TRANSPARENT_TAGS: ReadonlySet<string> = new Set([
  "COLGROUP",
  "TBODY",
  "TFOOT",
  "THEAD"
])

/**
 * Landmarks whose contents are page chrome rather than content. Shared by
 * record detection (which refuses to look inside them) and by initial cursor
 * placement (which refuses to land in them).
 */
export const PAGE_CHROME_SELECTOR =
  "nav, header, footer, [role=navigation], [role=banner], [role=contentinfo]," +
  " [role=toolbar], [role=tablist], [role=menu], [role=menubar]," +
  " [role=search], [role=alert], [role=status]"

/** Roles that are page chrome in their own right. */
export const CHROME_ROLES: ReadonlySet<string> = new Set([
  "banner",
  "contentinfo",
  "navigation",
  "menu",
  "menubar",
  "search",
  "tablist",
  "toolbar"
])

export function tagOf(el: Element): string {
  return (el.tagName || "").toUpperCase()
}

export function isSkipped(el: Element): boolean {
  return SKIP_TAGS.has(tagOf(el))
}

export function isTransparentTag(el: Element): boolean {
  return TRANSPARENT_TAGS.has(tagOf(el))
}

function explicitRole(el: Element): string | null {
  const raw = el.getAttribute?.("role")
  if (!raw) return null
  // ARIA allows a fallback list; the first *recognized* token wins. We accept
  // the first token and let the caller filter on SIGNIFICANT.
  const first = raw.trim().split(/\s+/)[0]
  return first ? first.toLowerCase() : null
}

export interface TableVerdict {
  layout: boolean
  /** 0..1. Only >= LAYOUT_TABLE_THRESHOLD collapses the table. */
  score: number
  reason: string
}

const LAYOUT_TABLE_THRESHOLD = 0.6

/**
 * Layout-vs-data table classification.
 *
 * `role=presentation|none` is definitive layout; `role=grid|table|treegrid` and
 * the presence of `th`/`caption`/`[scope]` are definitive data. Everything else
 * is weighed, because malformed `td`-only data tables (calendars, financial
 * reports, enterprise apps) are common and flattening one destroys real
 * structure. Uncertain tables are preserved.
 */
const tableVerdicts = newStore<TableVerdict>()

export function classifyTable(el: Element): TableVerdict {
  return cached(tableVerdicts, el, () => classifyTableUncached(el))
}

function classifyTableUncached(el: Element): TableVerdict {
  if (tagOf(el) !== "TABLE") {
    return { layout: false, score: 0, reason: "not-a-table" }
  }

  const role = explicitRole(el)
  if (role && PRESENTATIONAL.has(role)) {
    return { layout: true, score: 1, reason: `role=${role}` }
  }
  if (role === "grid" || role === "table" || role === "treegrid") {
    return { layout: false, score: 0, reason: `role=${role}` }
  }

  // Headers belonging to *this* table (not a nested one) settle it.
  const owned = (sel: string) =>
    Array.from(el.querySelectorAll(sel)).filter(
      (c) => c.closest("table") === el
    )
  if (owned("th, caption, [scope]").length > 0) {
    return { layout: false, score: 0, reason: "has-headers" }
  }
  if (el.hasAttribute("summary")) {
    return { layout: false, score: 0, reason: "has-summary" }
  }

  // No headers is only weak evidence of layout. Weigh the rest.
  let score = 0.35
  const reasons: string[] = ["no-headers"]

  const rows = owned("tr")
  const cellCounts = rows.map(
    (r) => Array.from(r.children).filter((c) => /^T[DH]$/.test(tagOf(c))).length
  )

  if (rows.length >= 3 && cellCounts.length > 0) {
    const first = cellCounts[0] ?? 0
    const uniform = cellCounts.every((n) => n === first)
    if (uniform && first >= 2) {
      // Rectangular grids of >=2 columns are how real data tables look, even
      // without headers. Strong pull towards "data".
      score -= 0.4
      reasons.push("rectangular")
    } else if (!uniform) {
      score += 0.2
      reasons.push("ragged-columns")
    }
  } else if (rows.length <= 2) {
    // One- or two-row tables are the classic email/newsletter layout shim.
    score += 0.25
    reasons.push("few-rows")
  }

  // `closest("table")` matches the element itself, so the `owned` helper can
  // never find a nested table, so walk up from the parent instead.
  const nested = Array.from(el.querySelectorAll("table")).some(
    (t) => t.parentElement?.closest("table") === el
  )
  if (nested) {
    score += 0.25
    reasons.push("nested-table")
  }

  // Data cells hold short text; layout cells hold blocks, images and spacers.
  const cells = owned("td")
  if (cells.length > 0) {
    let textual = 0
    for (const c of cells) {
      const text = (c.textContent || "").trim()
      if (text.length > 0 && text.length <= 200) textual++
    }
    const density = textual / cells.length
    if (density >= 0.7) {
      score -= 0.25
      reasons.push("text-dense")
    } else if (density <= 0.3) {
      score += 0.2
      reasons.push("text-sparse")
    }
  }

  score = Math.max(0, Math.min(1, score))
  return {
    layout: score >= LAYOUT_TABLE_THRESHOLD,
    score,
    reason: reasons.join(",")
  }
}

/**
 * The role for `el`, or null when it carries no structural role of its own.
 * Null does not mean "ignore the subtree"; callers still descend.
 */
export function roleOf(el: Element): string | null {
  const explicit = explicitRole(el)
  if (explicit) {
    return PRESENTATIONAL.has(explicit) ? null : explicit
  }

  const tag = tagOf(el)

  if (tag === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase()
    if (type === "hidden") return null
    if (type === "checkbox") return "checkbox"
    if (type === "radio") return "radio"
    if (type === "submit" || type === "button" || type === "reset") {
      return "button"
    }
    if (type === "search") return "search"
    return "textbox"
  }

  // An anchor without href is not a link. It is a named location.
  if (tag === "A" && !el.hasAttribute("href")) return null

  // An unlabelled <section> is a generic div per HTML-AAM.
  if (
    tag === "SECTION" &&
    !el.hasAttribute("aria-label") &&
    !el.hasAttribute("aria-labelledby")
  ) {
    return null
  }

  if (tag === "TABLE") {
    return classifyTable(el).layout ? null : "table"
  }

  if (tag === "TR" || tag === "TD" || tag === "TH") {
    const table = el.closest("table")
    if (table && classifyTable(table).layout) return null
  }

  return TAG_ROLE[tag] ?? null
}
