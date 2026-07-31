import { accessibleName } from "~/lib/dom/accname"
import { escapeSelector } from "~/lib/dom/css-escape"
import { roleOf, tagOf } from "~/lib/dom/roles"

/**
 * Cursor identity across re-render, the project's largest technical risk.
 *
 * There is no universal stable identity for a DOM node observed from outside
 * the app. React keys never reach the DOM, and list virtualizers *recycle the
 * same element object* for a different logical row, so a `WeakRef` that still
 * dereferences may be pointing at the wrong record. Every resolution therefore
 * re-verifies content signals even when the original element is still alive.
 *
 * Signals are split into two classes and they are not interchangeable:
 *
 *   identity: durable id, data-testid, canonical href, form name, accessible
 *              name, text, ancestor path. These can establish a match.
 *   location: sibling index, aria-posinset, viewport rectangle. These may
 *              only break ties between candidates that already passed the
 *              identity threshold. Using them to establish a match is how you
 *              silently activate the wrong row after a list reorders.
 */

export type ResolveQuality =
  /** Same element, all identity signals still agree. */
  | "exact"
  /** A different element matched on identity signals above threshold. */
  | "confident"
  /** Fell back to a surviving ancestor. Navigable, but not activatable. */
  | "degraded"
  /** Nothing survived. */
  | "lost"

export interface Anchor {
  role: string
  tag: string
  id?: string
  testId?: string
  href?: string
  formName?: string
  nameHash?: string
  textHash?: string
  /** Roles from nearest ancestor outward, at most 6. */
  ancestorRoles: string[]
  /** Location signals. Tie-breakers only. */
  siblingIndex: number
  setSize: number
  posinset?: number
  rect: { x: number; y: number; w: number; h: number }
  ref: WeakRef<Element>
  ancestorRefs: WeakRef<Element>[]
}

export interface Resolution {
  el: Element | null
  quality: ResolveQuality
  /** Identity score of the winning candidate, 0..1. */
  score: number
}

/** Above this, a candidate is a match on identity alone. */
const CONFIDENT = 0.5
/** Above this, treat as the same node without further checks. */
const CERTAIN = 0.75

const MAX_ANCESTORS = 6
const MAX_CANDIDATES = 200

/** FNV-1a. Cheap, deterministic, and adequate for equality checks. */
function hash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function normalizeText(el: Element): string {
  // Slice *before* normalizing. A page can put a 50 MB text node on an
  // element, and normalizing the whole thing to produce 200 characters turns
  // every reconcile tick into a copy of the entire string.
  return (el.textContent || "")
    .slice(0, 4096)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}

/**
 * The HTML tokenizer accepts almost anything in a tag name, so `<a"q>` yields
 * `tagName === 'A"Q'` and a page can produce a tag that makes every selector
 * built from it a syntax error. Anything that is not a plain tag becomes the
 * universal selector, which is slower but cannot throw.
 */
const SAFE_TAG = /^[A-Z][A-Z0-9-]*$/

function tagPart(tag: string): string {
  return SAFE_TAG.test(tag) ? tag : "*"
}

function canonicalHref(el: Element): string | undefined {
  const raw = el.getAttribute?.("href")
  if (!raw) return undefined
  try {
    const url = new URL(raw, el.ownerDocument.baseURI)
    // The fragment is part of the target on a docs page, so it is kept; the
    // search string is kept too. Only the hash-only case is normalized away.
    return url.href
  } catch {
    return raw
  }
}

function durableId(el: Element): string | undefined {
  const id = el.getAttribute?.("id")
  if (!id) return undefined
  // Framework-generated ids change every render and are worse than nothing:
  // they look durable and are not. Reject the common shapes.
  if (/^(:r|radix-|headlessui-|mui-|react-aria-|ember|ext-gen)/i.test(id)) {
    return undefined
  }
  if (/\d{6,}/.test(id)) return undefined
  return id
}

export function captureAnchor(el: Element): Anchor {
  const rect = el.getBoundingClientRect()
  const parent = el.parentElement
  const siblings = parent ? Array.from(parent.children) : [el]

  const ancestorRoles: string[] = []
  const ancestorRefs: WeakRef<Element>[] = []
  let node = el.parentElement
  while (node && ancestorRoles.length < MAX_ANCESTORS) {
    ancestorRoles.push(roleOf(node) ?? tagOf(node).toLowerCase())
    ancestorRefs.push(new WeakRef(node))
    node = node.parentElement
  }

  const name = accessibleName(el)
  const text = normalizeText(el)
  const posinset = el.getAttribute?.("aria-posinset")

  const anchor: Anchor = {
    role: roleOf(el) ?? tagOf(el).toLowerCase(),
    tag: tagOf(el),
    ancestorRoles,
    ancestorRefs,
    siblingIndex: siblings.indexOf(el),
    setSize: siblings.length,
    rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    ref: new WeakRef(el)
  }

  const id = durableId(el)
  if (id) anchor.id = id
  const testId =
    el.getAttribute?.("data-testid") ??
    el.getAttribute?.("data-test-id") ??
    el.getAttribute?.("data-cy") ??
    undefined
  if (testId) anchor.testId = testId
  const href = canonicalHref(el)
  if (href) anchor.href = href
  const formName = el.getAttribute?.("name")
  if (formName) anchor.formName = formName
  if (name) anchor.nameHash = hash(name)
  if (text) anchor.textHash = hash(text)
  if (posinset) anchor.posinset = Number(posinset)

  return anchor
}

function hasIdentitySignals(anchor: Anchor): boolean {
  return Boolean(
    anchor.id ||
    anchor.testId ||
    anchor.href ||
    anchor.formName ||
    anchor.nameHash ||
    anchor.textHash
  )
}

/** Identity-only score. Location signals deliberately excluded. */
function identityScore(anchor: Anchor, el: Element): number {
  if (tagOf(el) !== anchor.tag) return 0

  let score = 0

  if (anchor.id && durableId(el) === anchor.id) score += 0.45
  if (anchor.testId) {
    const testId =
      el.getAttribute?.("data-testid") ??
      el.getAttribute?.("data-test-id") ??
      el.getAttribute?.("data-cy")
    if (testId === anchor.testId) score += 0.4
  }
  if (anchor.href && canonicalHref(el) === anchor.href) score += 0.35
  if (anchor.formName && el.getAttribute?.("name") === anchor.formName) {
    score += 0.25
  }
  if (anchor.nameHash && hash(accessibleName(el)) === anchor.nameHash) {
    score += 0.25
  }
  if (anchor.textHash && hash(normalizeText(el)) === anchor.textHash) {
    score += 0.2
  }

  // Ancestor path is weak evidence and only counts proportionally.
  if (anchor.ancestorRoles.length > 0) {
    let matched = 0
    let node = el.parentElement
    for (const role of anchor.ancestorRoles) {
      if (!node) break
      if ((roleOf(node) ?? tagOf(node).toLowerCase()) === role) matched++
      node = node.parentElement
    }
    score += 0.15 * (matched / anchor.ancestorRoles.length)
  }

  return Math.min(1, score)
}

/** Location-only score, used strictly to order already-qualified candidates. */
function locationScore(anchor: Anchor, el: Element): number {
  let score = 0

  const parent = el.parentElement
  if (parent) {
    const index = Array.from(parent.children).indexOf(el)
    if (index === anchor.siblingIndex) score += 0.5
    else if (Math.abs(index - anchor.siblingIndex) <= 1) score += 0.25
  }

  const posinset = el.getAttribute?.("aria-posinset")
  if (posinset && Number(posinset) === anchor.posinset) score += 0.3

  const rect = el.getBoundingClientRect()
  const dx = Math.abs(rect.left - anchor.rect.x)
  const dy = Math.abs(rect.top - anchor.rect.y)
  if (dx < 4 && dy < 4) score += 0.2
  else if (dx < 40 && dy < 40) score += 0.1

  return score
}

/**
 * Search scope: the nearest ancestor that is still in the document. Also the
 * fallback target when nothing matches.
 */
function survivingAncestor(anchor: Anchor): Element | null {
  for (const ref of anchor.ancestorRefs) {
    const el = ref.deref()
    if (el && el.isConnected) return el
  }
  return null
}

function candidateSelector(anchor: Anchor): string {
  const tag = tagPart(anchor.tag)
  const parts: string[] = []
  if (anchor.id) parts.push(`${tag}#${escapeSelector(anchor.id)}`)
  if (anchor.testId) {
    const id = escapeSelector(anchor.testId)
    parts.push(`${tag}[data-testid="${id}"]`)
    parts.push(`${tag}[data-test-id="${id}"]`)
  }
  if (anchor.href) {
    // Match on the raw attribute is unreliable (relative vs absolute), so the
    // tag alone is the filter and canonicalHref does the comparison.
    parts.push(`${tag}[href]`)
  }
  if (anchor.formName) {
    parts.push(`${tag}[name="${escapeSelector(anchor.formName)}"]`)
  }
  if (parts.length === 0) parts.push(tag)
  return parts.join(", ")
}

export function resolveAnchor(anchor: Anchor, root?: ParentNode): Resolution {
  // 1. The original element, if it is still both alive and *itself*. The
  //    content re-check is what catches virtualizer recycling: the element
  //    object survives, but it is now showing a different record.
  const original = anchor.ref.deref()
  if (original && original.isConnected) {
    if (!hasIdentitySignals(anchor)) {
      // Nothing to verify against. Recycling only happens in virtualized
      // lists, whose rows always carry text, so trusting the reference here
      // is safe and the alternative is reporting every anonymous container
      // as degraded on each reconcile.
      return { el: original, quality: "exact", score: 0 }
    }
    const score = identityScore(anchor, original)
    if (score >= CONFIDENT) return { el: original, quality: "exact", score }
  }

  // 2. Search, narrowest scope first.
  const scope = survivingAncestor(anchor) ?? root ?? document
  let best: { el: Element; score: number; location: number } | null = null

  const consider = (where: ParentNode) => {
    let found: NodeListOf<Element>
    try {
      found = where.querySelectorAll(candidateSelector(anchor))
    } catch {
      // A selector that will not parse means we cannot search, not that the
      // caller may treat the old cursor as still valid.
      return
    }
    const limit = Math.min(found.length, MAX_CANDIDATES)
    for (let i = 0; i < limit; i++) {
      const el = found[i]!
      const score = identityScore(anchor, el)
      if (score < CONFIDENT) continue
      const location = locationScore(anchor, el)
      if (
        !best ||
        score > best.score ||
        (score === best.score && location > best.location)
      ) {
        best = { el, score, location }
      }
    }
  }

  consider(scope)
  if (!best && scope !== document) consider(document)

  if (best) {
    const winner = best as { el: Element; score: number; location: number }
    return {
      el: winner.el,
      quality: winner.score >= CERTAIN ? "exact" : "confident",
      score: winner.score
    }
  }

  // 3. Nothing matched. Fall back to a surviving ancestor so the user keeps a
  //    position, but the caller must refuse to activate from here.
  const ancestor = survivingAncestor(anchor)
  if (ancestor) return { el: ancestor, quality: "degraded", score: 0 }

  return { el: null, quality: "lost", score: 0 }
}

/** Whether a resolution is safe to fire Enter / open / yank against. */
export function isActivatable(quality: ResolveQuality): boolean {
  return quality === "exact" || quality === "confident"
}
