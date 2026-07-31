import { classifyTable, isSkipped, PAGE_CHROME_SELECTOR, tagOf } from "./roles"
import { RECORD_CONFIDENT } from "./types"
import type { VisibilityOptions } from "./visibility"
import { visibilityOf } from "./visibility"

/**
 * Record detection: repeated logical units (a story row, a search result, a
 * comment, a card) that the user thinks of as one thing.
 *
 * Research finding: DOM-signature matching gets 0% recall on Hacker News,
 * geometry gets 100%. So geometry *leads*. But every site validated during
 * research was a single-column, roughly-uniform list, and geometry alone is
 * exactly what breaks on masonry and wrapped grids. Hence the hybrid score
 * Geometry's weight (0.35) is deliberately below the
 * acceptance threshold (0.65) so it can never decide alone.
 *
 *   score = .35*G + .25*S + .15*R + .15*C + .10*D - .30*X
 *
 * Geometry is generalized past the research spike in one important way: the
 * spike required a regular *vertical pitch*, which masonry does not have. Here
 * pitch regularity is one of three geometric sub-signals (with width
 * similarity and lattice alignment), so a masonry column scores moderately on
 * G and is carried over the line by subtree similarity and coverage.
 */

export interface RecordSignals {
  /** Geometry: width similarity, lattice alignment, pitch regularity. */
  G: number
  /** Subtree structural similarity between items. */
  S: number
  /** Semantic role evidence (list/listitem/article/row/feed). */
  R: number
  /** Coverage of the container and contiguity of the run. */
  C: number
  /** Repeated content and action shape across items. */
  D: number
  /** Toolbar / nav / menu evidence. Subtracted. */
  X: number
}

export interface RecordGroup {
  container: Element
  items: Element[]
  confidence: number
  signals: RecordSignals
}

export interface DetectOptions extends VisibilityOptions {
  /** Minimum items in a group. Two repeated things are a coincidence. */
  minItems?: number
  /** Containers with more children than this are skipped for cost. */
  maxChildren?: number
  /** How deep records may nest inside records. Bounds the work on deep pages. */
  maxNesting?: number
  /** Groups below this are reported but flagged uncertain by the caller. */
  threshold?: number
}

const LIST_TAGS: ReadonlySet<string> = new Set(["UL", "OL", "DL", "TBODY"])
const LIST_ROLES: ReadonlySet<string> = new Set([
  "list",
  "feed",
  "grid",
  "table",
  "listbox",
  "tree",
  "rowgroup"
])
const ITEM_ROLES: ReadonlySet<string> = new Set([
  "listitem",
  "article",
  "row",
  "gridcell",
  "option",
  "treeitem",
  "comment"
])

const TABLE_STRUCTURE: ReadonlySet<string> = new Set([
  "TABLE",
  "TBODY",
  "THEAD",
  "TFOOT",
  "TR",
  "TD",
  "TH"
])

/**
 * True for the scaffolding of a table that `classifyTable` judged to be layout
 * rather than data.
 *
 * Found on Hacker News, whose page is one outer layout table: its three rows
 * (header, spacer, content) are geometrically regular and structurally alike,
 * so they scored as a record set and the cursor opened on page chrome with the
 * entire story list buried two levels down.
 *
 * The check is deliberately narrow: only the table's *own* rows and cells are
 * excluded, not everything inside them. On HN the real story list lives inside
 * one of those cells, and excluding descendants wholesale would lose it.
 */
function isLayoutTableStructure(el: Element): boolean {
  const tag = tagOf(el)
  if (!TABLE_STRUCTURE.has(tag)) return false
  const table = tag === "TABLE" ? el : el.closest("table")
  return table !== null && classifyTable(table).layout
}

const MIN_ITEM_WIDTH = 40
const MIN_ITEM_HEIGHT = 16
/** Lattice tolerance in CSS px for edge alignment. */
const EDGE_TOLERANCE = 8

interface Box {
  el: Element
  rect: DOMRect
  /** Position in the container's eligible-children list, for contiguity. */
  ordinal: number
}

// --- small numeric helpers -------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Coefficient of variation, clamped to [0,1] and safe for a zero mean. */
function cov(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const variance = mean(xs.map((x) => (x - m) ** 2))
  // Identical values are maximally *similar*, including when they are all
  // zero. Returning 1 for a zero mean would report "no two items alike" for a
  // set of items that agree perfectly, e.g. every card containing no images.
  if (variance === 0) return 0
  if (m <= 0) return 1
  return Math.min(1, Math.sqrt(variance) / m)
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function bucketBy(values: number[], tolerance: number): Map<number, number[]> {
  const buckets = new Map<number, number[]>()
  values.forEach((v, i) => {
    const key = Math.round(v / tolerance)
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  })
  return buckets
}

// --- geometry --------------------------------------------------------------

/**
 * Fraction of items sitting on a shared lattice line. A single-column list and
 * a three-column grid both score 1.0; scattered boxes score near 0.
 */
function alignmentOn(values: number[]): number {
  if (values.length < 2) return 0
  const buckets = bucketBy(values, EDGE_TOLERANCE)
  let aligned = 0
  for (const members of buckets.values()) {
    if (members.length >= 2) aligned += members.length
  }
  return aligned / values.length
}

/**
 * Regularity of spacing along `crossAxis` within each lattice line of
 * `mainAxis`. Masonry scores low here by construction. That is intended, and
 * is why G is only one term of the score.
 */
function pitchOn(boxes: Box[], mainAxis: "left" | "top"): number {
  const crossKey = mainAxis === "left" ? "top" : "left"
  const buckets = bucketBy(
    boxes.map((b) => b.rect[mainAxis]),
    EDGE_TOLERANCE
  )

  let weighted = 0
  let weight = 0
  for (const members of buckets.values()) {
    if (members.length < 3) continue
    const line = members
      .map((i) => boxes[i]!)
      .sort((a, b) => a.rect[crossKey] - b.rect[crossKey])
    const gaps: number[] = []
    for (let i = 1; i < line.length; i++) {
      gaps.push(line[i]!.rect[crossKey] - line[i - 1]!.rect[crossKey])
    }
    weighted += (1 - cov(gaps)) * line.length
    weight += line.length
  }
  return weight === 0 ? 0 : weighted / weight
}

function geometry(boxes: Box[]): number {
  const widths = boxes.map((b) => b.rect.width)
  const heights = boxes.map((b) => b.rect.height)
  const lefts = boxes.map((b) => b.rect.left)
  const tops = boxes.map((b) => b.rect.top)

  const widthSim = 1 - cov(widths)
  // Height similarity is deliberately *not* required, because variable-height records
  // (a comment, a masonry card) are still records.
  const sizeHint = 0.75 * widthSim + 0.25 * (1 - cov(heights))
  const alignment = Math.max(alignmentOn(lefts), alignmentOn(tops))
  const pitch = Math.max(pitchOn(boxes, "left"), pitchOn(boxes, "top"))

  return clamp01(0.4 * sizeHint + 0.35 * alignment + 0.25 * pitch)
}

// --- structure -------------------------------------------------------------

/** Multiset of `tag[role]` paths to depth 2, capped for cost. */
function shingles(el: Element, limit = 40): Set<string> {
  const out = new Set<string>()
  const walk = (node: Element, prefix: string, depth: number) => {
    if (out.size >= limit || depth > 2) return
    for (const child of Array.from(node.children)) {
      if (isSkipped(child)) continue
      const role = child.getAttribute?.("role")
      const token = `${prefix}/${tagOf(child)}${role ? `[${role}]` : ""}`
      out.add(token)
      if (out.size >= limit) return
      walk(child, token, depth + 1)
    }
  }
  walk(el, "", 0)
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let shared = 0
  for (const x of a) if (b.has(x)) shared++
  const union = a.size + b.size - shared
  return union === 0 ? 0 : shared / union
}

/** Mean similarity over a sample of consecutive pairs. */
function subtreeSimilarity(items: Element[]): number {
  if (items.length < 2) return 0
  const step = Math.max(1, Math.floor((items.length - 1) / 12))
  const scores: number[] = []
  let prev = shingles(items[0]!)
  for (let i = step; i < items.length; i += step) {
    const cur = shingles(items[i]!)
    scores.push(jaccard(prev, cur))
    prev = cur
  }
  return scores.length === 0 ? 0 : mean(scores)
}

function roleEvidence(container: Element, items: Element[]): number {
  let score = 0
  const containerRole = container.getAttribute?.("role")?.toLowerCase()
  if (
    LIST_TAGS.has(tagOf(container)) ||
    (containerRole && LIST_ROLES.has(containerRole))
  ) {
    score += 0.5
  }

  let itemish = 0
  let posinset = 0
  for (const item of items) {
    const role = item.getAttribute?.("role")?.toLowerCase()
    const tag = tagOf(item)
    if (
      (role && ITEM_ROLES.has(role)) ||
      tag === "LI" ||
      tag === "TR" ||
      tag === "ARTICLE"
    ) {
      itemish++
    }
    if (item.hasAttribute?.("aria-posinset")) posinset++
  }
  score += 0.5 * (itemish / items.length)
  if (posinset / items.length > 0.5) score += 0.3

  return clamp01(score)
}

function coverage(items: Box[], eligible: number): number {
  const cov0 = items.length / Math.max(1, eligible)

  const ordinals = items.map((b) => b.ordinal).sort((a, b) => a - b)
  let best = 1
  let run = 1
  for (let i = 1; i < ordinals.length; i++) {
    run = ordinals[i]! === ordinals[i - 1]! + 1 ? run + 1 : 1
    if (run > best) best = run
  }
  const contiguity = best / ordinals.length

  return clamp01(0.6 * cov0 + 0.4 * contiguity)
}

/** How alike the items are in *what they contain and offer to click*. */
function contentPattern(items: Element[]): number {
  const sample = items.slice(0, 16)
  const vectors = sample.map((item) => [
    item.querySelectorAll("a[href]").length,
    item.querySelectorAll("button, [role=button]").length,
    item.querySelectorAll("img, picture, svg").length,
    item.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]").length,
    Math.min(20, Math.round((item.textContent || "").trim().length / 40))
  ])
  if (vectors.length < 2) return 0

  const dims = vectors[0]!.length
  const similarities: number[] = []
  for (let d = 0; d < dims; d++) {
    similarities.push(1 - cov(vectors.map((v) => v[d]!)))
  }

  const actionable = sample.filter(
    (i) =>
      i.querySelector("a[href], button, [role=button], [role=link]") !== null
  ).length

  return clamp01(0.7 * mean(similarities) + 0.3 * (actionable / sample.length))
}

/**
 * One row of items side by side. Distinguishes a toolbar from a feed, and, in
 * a container that already sits inside a record, the record's own columns
 * from a genuinely nested record set.
 */
function isHorizontalBand(boxes: Box[]): boolean {
  const topBuckets = bucketBy(
    boxes.map((b) => b.rect.top),
    EDGE_TOLERANCE
  ).size
  const leftBuckets = bucketBy(
    boxes.map((b) => b.rect.left),
    EDGE_TOLERANCE
  ).size
  return topBuckets <= 2 && leftBuckets >= boxes.length - 1
}

function chromeEvidence(boxes: Box[]): number {
  const items = boxes.map((b) => b.el)

  // Both signals below are gated on a horizontal band. Without that gate,
  // "all links with short text" also fires on a perfectly legitimate vertical
  // list of short-titled links, which is a record set and not a toolbar.
  if (!isHorizontalBand(boxes)) return 0

  let score = 0

  const linky = items.filter(
    (i) => tagOf(i) === "A" || i.querySelector("a[href]") !== null
  ).length
  const texts = items.map((i) => (i.textContent || "").trim().length)
  if (linky / items.length > 0.9 && mean(texts) < 25) score += 0.6

  // A short horizontal band is a tab bar, a breadcrumb or a filter row. Three
  // is the minimum group size, so requiring four here let GitHub's three
  // filter dropdowns through as a record set.
  const shallow = Math.max(...boxes.map((b) => b.rect.height)) < 64
  if (shallow && items.length >= 3) score += 0.4

  return clamp01(score)
}

// --- scoring ---------------------------------------------------------------

/**
 * Whether the items contain anything at all.
 *
 * Every signal below measures how *alike* the items are, and items that are
 * uniformly empty are perfectly alike. Ten empty <div>s of identical size score
 * G=1 (same box), S=1 (`jaccard` of two empty shingle sets is 1), C=1 (they are
 * all of the container's eligible children) and D=0.7 (a flat content vector has
 * no variance) — 0.82 against a 0.65 threshold. So skeleton loaders, empty grid
 * cells and ad slots were promoted to record sets, and at ten items that clears
 * `DOMINANT_RECORD_SET`, which is where the cursor parks when the panel opens.
 *
 * Likeness cannot separate those from real records; substance can. Deliberately
 * a precondition rather than a seventh signal, so no amount of uniformity can
 * outvote it. Half is the bar because a real feed does carry the occasional
 * empty item — a spacer row, an ad slot that did not fill.
 *
 * Note this must not demand child *elements*: `<li>Apple</li>` has none, and a
 * list of leaf items is exactly what record detection is for. Text counts.
 */
function hasSubstance(items: Element[]): boolean {
  let real = 0
  for (const item of items) {
    if ((item.textContent || "").trim() !== "") real++
    else if (
      item.querySelector(
        "a[href], button, [role=button], [role=link], img, picture, svg, input"
      ) !== null
    ) {
      real++
    }
  }
  return real * 2 >= items.length
}

function scoreGroup(
  container: Element,
  boxes: Box[],
  eligible: number
): { confidence: number; signals: RecordSignals } {
  const items = boxes.map((b) => b.el)
  const signals: RecordSignals = {
    G: geometry(boxes),
    S: subtreeSimilarity(items),
    R: roleEvidence(container, items),
    C: coverage(boxes, eligible),
    D: contentPattern(items),
    X: chromeEvidence(boxes)
  }

  if (!hasSubstance(items)) return { confidence: 0, signals }

  const confidence = clamp01(
    0.35 * signals.G +
      0.25 * signals.S +
      0.15 * signals.R +
      0.15 * signals.C +
      0.1 * signals.D -
      0.3 * signals.X
  )

  return { confidence, signals }
}

// --- detection -------------------------------------------------------------

function eligibleChildren(container: Element, opts: DetectOptions): Box[] {
  const rectOf = opts.rectOf ?? ((e: Element) => e.getBoundingClientRect())
  const boxes: Box[] = []
  let ordinal = 0
  for (const child of Array.from(container.children)) {
    if (isSkipped(child)) continue
    if (isLayoutTableStructure(child)) continue
    if (visibilityOf(child, opts) !== "visible") continue
    const rect = rectOf(child)
    const slot = ordinal++
    if (rect.width < MIN_ITEM_WIDTH || rect.height < MIN_ITEM_HEIGHT) continue
    boxes.push({ el: child, rect, ordinal: slot })
  }
  return boxes
}

/**
 * Candidate partitions of a container's children. Whichever scores highest
 * wins, which is what lets one detector handle both "every child is a record"
 * (clean lists, wrapped grids, masonry) and "records are mixed in with a header
 * and a paginator" (the case that forced the research spike to bucket).
 */
function candidatePartitions(boxes: Box[], minItems: number): Box[][] {
  const partitions: Box[][] = []

  if (boxes.length >= minItems) partitions.push(boxes)

  const push = (map: Map<string, Box[]>, key: string, box: Box) => {
    const group = map.get(key)
    if (group) group.push(box)
    else map.set(key, [box])
  }

  const byGeometry = new Map<string, Box[]>()
  const byStructure = new Map<string, Box[]>()
  for (const box of boxes) {
    const left = Math.round(box.rect.left / EDGE_TOLERANCE)
    const width = Math.round(box.rect.width / 16)
    push(byGeometry, `${left}:${width}`, box)

    const role = box.el.getAttribute?.("role") ?? ""
    const key = `${tagOf(box.el)}[${role}]:${box.el.childElementCount}`
    push(byStructure, key, box)
  }

  for (const group of [...byGeometry.values(), ...byStructure.values()]) {
    if (group.length >= minItems && group.length < boxes.length) {
      partitions.push(group)
    }
  }

  return partitions
}

/**
 * Detect record groups beneath `root`, outermost first.
 *
 * Nested detection is allowed: a threaded discussion is records inside
 * records, and suppressing the whole subtree of an accepted item would flatten
 * every `<div>`-based reply thread. What *is* suppressed inside an accepted
 * record is a horizontal band, because that is the record's own columns rather
 * than a nested record set: the case that made the research spike return the
 * cells of a story row instead of the row.
 */
export function detectRecords(
  root: Element,
  opts: DetectOptions = {}
): RecordGroup[] {
  const minItems = opts.minItems ?? 3
  const maxChildren = opts.maxChildren ?? 400
  const maxNesting = opts.maxNesting ?? 3
  const threshold = opts.threshold ?? RECORD_CONFIDENT

  const containers = Array.from(root.querySelectorAll("*")).filter((el) => {
    if (isSkipped(el)) return false
    if (el.childElementCount < minItems) return false
    if (el.childElementCount > maxChildren) return false
    if (isLayoutTableStructure(el)) return false
    return el.closest(PAGE_CHROME_SELECTOR) === null
  })

  // Outermost first, so the story row is found before anything inside it.
  const depthOf = (el: Element) => {
    let depth = 0
    let node: Element | null = el
    while (node) {
      depth++
      node = node.parentElement
    }
    return depth
  }
  containers.sort((a, b) => depthOf(a) - depthOf(b))

  const items = new Set<Element>()
  const groups: RecordGroup[] = []

  /** How many accepted records enclose `el`. Bounds nesting work. */
  const recordDepth = (el: Element): number => {
    let depth = 0
    let node: Element | null = el
    while (node) {
      if (items.has(node)) depth++
      node = node.parentElement
    }
    return depth
  }

  for (const container of containers) {
    const nesting = recordDepth(container)
    if (nesting >= maxNesting) continue

    const boxes = eligibleChildren(container, opts)
    if (boxes.length < minItems) continue

    let best: RecordGroup | null = null
    for (const partition of candidatePartitions(boxes, minItems)) {
      if (nesting > 0 && isHorizontalBand(partition)) continue

      const { confidence, signals } = scoreGroup(
        container,
        partition,
        boxes.length
      )
      if (confidence < threshold) continue
      if (!best || confidence > best.confidence) {
        best = {
          container,
          items: partition.map((b) => b.el),
          confidence,
          signals
        }
      }
    }

    if (!best) continue
    // An element belongs to at most one record group.
    if (best.items.some((i) => items.has(i))) continue

    groups.push(best)
    for (const item of best.items) items.add(item)
  }

  return groups
}
