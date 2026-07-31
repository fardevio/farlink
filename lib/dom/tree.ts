import { accessibleName } from "./accname"
import { beginPass, endPass } from "./cache"
import { detectRecords } from "./records"
import type { DetectOptions } from "./records"
import {
  ACTIONABLE,
  isSkipped,
  isTransparentTag,
  roleOf,
  SIGNIFICANT,
  tagOf
} from "./roles"
import type { ExtractResult, SemanticNode } from "./types"
import type { VisibilityOptions } from "./visibility"
import { visibilityOf } from "./visibility"

/**
 * Builds the semantic tree the cursor navigates.
 *
 * Two decisions worth knowing before changing anything here:
 *
 * 1. Accessible names are computed *lazily* (`nameOf`). Naming every node
 *    eagerly means an `innerText` read per node, and the UI only ever shows a
 *    couple of dozen at a time. This is most of the difference between hitting
 *    and missing the 50 ms budget on a 5k-element page.
 *
 * 2. Collapsing a single-child chain replaces the *parent* with the child and
 *    records the parent's role on the edge. The research spike replaced the
 *    child with its grandchildren instead, which silently deleted wrapping
 *    <a> elements: 17 real links on one GitHub page. Because the surviving
 *    node keeps a real `parent` pointer, `h` reverses `l` exactly.
 */

export interface ExtractOptions extends VisibilityOptions, DetectOptions {
  /** Above this many candidate elements, build one level and stop. */
  lazyThreshold?: number
  /** Hard cap on children materialized for a single node. */
  maxLevelSize?: number
  /** Skip record detection. Used by tests and by the lazy path. */
  detectRecords?: boolean
}

const DEFAULT_LAZY_THRESHOLD = 20_000

/**
 * Hard ceiling on children materialized for one node.
 *
 * This must stay at or above `MAX_INDEX_LINKS` in lib/nav/session.ts, because
 * whichever is lower is the real limit on what the panel can see. It was 500
 * while that one was 5000, so raising the index cap — done specifically because
 * "the index stopped at 500 and filtering for `equestrianism`, plainly on the
 * page, found nothing at all" — changed nothing for a flat list: a <ul> of 2000
 * links still yielded exactly 500. The constant was raised in the wrong file.
 *
 * It is a backstop against a pathological page, not a design limit, so it is
 * deliberately far above any real level. When it does bite it reports the loss
 * through `stats.dropped` rather than truncating in silence.
 */
const DEFAULT_MAX_LEVEL_SIZE = 5000

/** Never descended into; their contents are not addressable from here. */
const OPAQUE: ReadonlySet<string> = new Set(["frame", "canvas", "video", "img"])

/**
 * A childless node with no text and nothing to activate. Layout scaffolding:
 * `<tr class="spacer">`, clearing divs, empty grid cells, which would
 * otherwise appear in the strip as "(unnamed row)" and cost a keypress to skip
 * past. Uses `textContent` rather than `innerText` because this runs for every
 * candidate leaf and must not force layout.
 */
function isVacant(el: Element, role: string): boolean {
  if (ACTIONABLE.has(role) || OPAQUE.has(role)) return false
  if ((el.textContent || "").trim() !== "") return false
  return (
    el.querySelector(
      "img[alt]:not([alt='']), [aria-label], input, select, textarea, " +
        "button, a[href], [role=button], [role=link]"
    ) === null
  )
}

/**
 * Names are cached for the lifetime of one extracted tree, not forever.
 *
 * `nameOf` is called during *projection*, after `extractTree` has returned, so
 * it cannot use the `beginPass`/`endPass` bracket in lib/dom/cache.ts, because outside
 * that bracket `cached()` degrades to no caching at all. Replacing the map when
 * a tree is built gives the same effect with the right lifetime: a live
 * counter, a late-loading label or an edited title shows its new value after
 * the next reconcile instead of being pinned to whatever it said first.
 */
let nameCache = new WeakMap<Element, string>()

/** Accessible name for a node, computed once per element per extracted tree. */
export function nameOf(node: SemanticNode): string {
  const cached = nameCache.get(node.el)
  if (cached !== undefined) return cached
  const name = accessibleName(node.el)
  nameCache.set(node.el, name)
  return name
}

/**
 * Children in composed-tree order: shadow content replaces light children when
 * a shadow root is attached, and <slot> resolves to its assigned elements. A
 * closed shadow root is unreachable, so such a host is simply a leaf.
 */
function composedChildren(el: Element): Element[] {
  if (tagOf(el) === "SLOT") {
    const slot = el as HTMLSlotElement
    const assigned = slot.assignedElements?.()
    if (assigned && assigned.length > 0) return assigned
    return Array.from(el.children)
  }
  if (el.shadowRoot) return Array.from(el.shadowRoot.children)
  return Array.from(el.children)
}

interface BuildContext {
  opts: ExtractOptions
  records: Map<Element, RecordMark>
  candidates: number
  maxLevelSize: number
  /** Nodes discarded by the level cap, so the loss is never silent. */
  dropped: number
}

function buildChildren(
  el: Element,
  parent: SemanticNode | null,
  ctx: BuildContext
): SemanticNode[] {
  const out: SemanticNode[] = []

  for (const child of composedChildren(el)) {
    if (isSkipped(child)) continue

    const vis = visibilityOf(child, ctx.opts)
    if (vis === "hidden" || vis === "screen-reader-only") continue

    ctx.candidates++

    // `display: contents` and <tbody>-style wrappers have no box or no role of
    // their own, but their children are real. Pass straight through; these are
    // genuinely not boxes, so they can never be a group.
    if (vis === "transparent" || isTransparentTag(child)) {
      for (const node of buildChildren(child, parent, ctx)) out.push(node)
      continue
    }

    const mark = ctx.records.get(child)
    let role = roleOf(child)
    if (mark !== undefined && (role === null || !SIGNIFICANT.has(role))) {
      role = "record"
    }

    const significant = role !== null && SIGNIFICANT.has(role)

    if (!significant) {
      // No role of its own: hoist whatever is beneath it to this level.
      for (const node of buildChildren(child, parent, ctx)) out.push(node)
      continue
    }

    const node: SemanticNode = {
      el: child,
      role: role!,
      children: [],
      parent,
      collapsed: []
    }
    if (mark !== undefined) {
      node.confidence = mark.confidence
      node.recordGroup = mark.group
    }

    if (OPAQUE.has(node.role)) {
      out.push(node)
      continue
    }

    node.children = buildChildren(child, node, ctx)

    if (node.children.length === 0 && isVacant(child, node.role)) continue

    out.push(node)
  }

  // Sliced here rather than checked inside the loop: several branches skip a
  // mid-loop check, so a level could exceed the cap by an arbitrary margin.
  if (out.length > ctx.maxLevelSize) {
    ctx.dropped += out.length - ctx.maxLevelSize
    return collapseChains(out.slice(0, ctx.maxLevelSize), parent)
  }

  return collapseChains(out, parent)
}

/**
 * Replace each single-child chain with its innermost node, recording the roles
 * passed through on the surviving node's `collapsed` edge. Stops at actionable
 * roles so a wrapping <a> or <button> is never discarded.
 */
function collapseChains(
  nodes: SemanticNode[],
  parent: SemanticNode | null
): SemanticNode[] {
  const out: SemanticNode[] = []

  for (const node of nodes) {
    let current = node
    const passed: string[] = []

    while (
      current.children.length === 1 &&
      !ACTIONABLE.has(current.role) &&
      current.confidence === undefined
    ) {
      passed.push(current.role)
      current = current.children[0]!
    }

    if (current !== node) {
      // Outermost first, so the breadcrumb reads in document order. The
      // surviving node may already carry roles collapsed at a deeper level,
      // and those must be kept rather than replaced.
      current.collapsed = [...node.collapsed, ...passed, ...current.collapsed]
    }

    current.parent = parent
    out.push(current)
  }

  return out
}

interface RecordMark {
  confidence: number
  group: number
}

/** Record membership keyed by element, for the whole document once. */
function recordMap(
  root: Element,
  opts: ExtractOptions
): Map<Element, RecordMark> {
  const map = new Map<Element, RecordMark>()
  if (opts.detectRecords === false) return map
  detectRecords(root, opts).forEach((group, index) => {
    for (const item of group.items) {
      map.set(item, { confidence: group.confidence, group: index })
    }
  })
  return map
}

export function extractTree(
  root: Element,
  opts: ExtractOptions = {}
): ExtractResult {
  const started = performance.now()
  nameCache = new WeakMap()
  beginPass()
  try {
    return build(root, opts, started)
  } finally {
    endPass()
  }
}

function build(
  root: Element,
  opts: ExtractOptions,
  started: number
): ExtractResult {
  // A cheap pre-count decides whether the page is big enough to skip record
  // detection. querySelectorAll is far cheaper than the work it guards.
  //
  // Record detection is the expensive half — it partitions every candidate
  // container and scores each partition by sampling subtrees — so on a very
  // large page it is what gets dropped. The tree itself is always built in
  // full. It used to be the other way round: a `budget` of 1 stopped the walk
  // after one level, `expandNode()` was supposed to materialize the rest on
  // demand and had no callers, and `stats.lazy` reached no UI. So a page over
  // this threshold produced a panel listing *zero* links, with nothing to say
  // the extractor had given up. Measured on a 24,040-element document:
  // `links=0, unexpanded=20000`.
  const elementCount = root.querySelectorAll("*").length
  const lazyThreshold = opts.lazyThreshold ?? DEFAULT_LAZY_THRESHOLD
  const lazy = elementCount > lazyThreshold

  const ctx: BuildContext = {
    opts,
    records: lazy ? new Map() : recordMap(root, opts),
    candidates: 0,
    maxLevelSize: opts.maxLevelSize ?? DEFAULT_MAX_LEVEL_SIZE,
    dropped: 0
  }

  let roots = buildChildren(root, null, ctx)

  // A document wrapped in one container is the container, not the document.
  while (roots.length === 1 && roots[0]!.children.length > 0) {
    const only = roots[0]!
    if (ACTIONABLE.has(only.role)) break
    roots = only.children
    for (const child of roots) child.parent = null
  }

  let nodes = 0
  let maxDepth = 0
  const measure = (list: SemanticNode[], depth: number) => {
    if (depth > maxDepth) maxDepth = depth
    for (const node of list) {
      nodes++
      if (node.children.length > 0) measure(node.children, depth + 1)
    }
  }
  measure(roots, 0)

  return {
    roots,
    stats: {
      candidates: ctx.candidates,
      nodes,
      maxDepth,
      lazy,
      dropped: ctx.dropped,
      elapsedMs: performance.now() - started
    }
  }
}

/** Root-to-node path, for the breadcrumb. */
export function pathTo(node: SemanticNode): SemanticNode[] {
  const path: SemanticNode[] = []
  let current: SemanticNode | null = node
  while (current) {
    path.unshift(current)
    current = current.parent
  }
  return path
}
