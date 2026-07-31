import { detectRecords } from "~/lib/dom/records"
import { extractTree, nameOf } from "~/lib/dom/tree"
import type { SemanticNode } from "~/lib/dom/types"

/**
 * Runs the real extractor against a live page and scores it against a
 * hand-written ground-truth selector.
 *
 * It measures the shipped modules rather than a copy of them, so a regression
 * here is a regression in the product. Be honest about how weak the oracle is:
 * one CSS selector per site is a much thinner ground truth than hand-labelled
 * records would be, and it cannot score record boundaries at all.
 */

const GROUND_TRUTH: [RegExp, string, string][] = [
  [/ycombinator\.com/, "tr.athing", "HN story rows"],
  [/lobste\.rs/, ".story", "Lobsters stories"],
  [/github\.com\/trending/, "article.Box-row", "GitHub trending repos"],
  [/github\.com\/.+\/(issues|pulls)/, "div[id^='issue_']", "GitHub issues"],
  [/reddit\.com/, "shreddit-post", "Reddit posts"],
  [/news\.google\.com/, "article", "Google News articles"],
  [/unsplash\.com/, "figure", "Unsplash photos"],
  [/pinterest\./, "div[data-test-id='pin']", "Pinterest pins"],
  [/wikipedia\.org/, "#mw-content-text .mw-heading", "Wikipedia sections"],
  [/developer\.mozilla\.org/, "article section", "MDN sections"]
]

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return Number((sorted[index] ?? 0).toFixed(1))
}

function flatten(nodes: SemanticNode[]): SemanticNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

export function run(): string {
  const host = location.href
  const truthEntry = GROUND_TRUTH.find(([pattern]) => pattern.test(host))
  const truthSelector = truthEntry?.[1] ?? null
  const truth = truthSelector
    ? Array.from(document.querySelectorAll(truthSelector))
    : []

  // Timing: repeated runs so p50/p95 mean something. First run is cold (style
  // and layout caches empty) and is reported separately.
  const timings: number[] = []
  let result = extractTree(document.body)
  const coldMs = Number(result.stats.elapsedMs.toFixed(1))
  for (let i = 0; i < 7; i++) {
    result = extractTree(document.body)
    timings.push(result.stats.elapsedMs)
  }

  // Split the budget: how much of the extraction cost is record detection?
  const noRecords: number[] = []
  for (let i = 0; i < 5; i++) {
    const started = performance.now()
    extractTree(document.body, { detectRecords: false })
    noRecords.push(performance.now() - started)
  }
  const detectOnly: number[] = []
  for (let i = 0; i < 5; i++) {
    const started = performance.now()
    detectRecords(document.body)
    detectOnly.push(performance.now() - started)
  }

  const groups = detectRecords(document.body)
  const detected = new Set<Element>()
  for (const group of groups) {
    for (const item of group.items) detected.add(item)
  }

  // Strict scoring: a truth element counts as recalled only if it is itself
  // detected, or is the direct parent/child of a detected element. The
  // research spike's four-level ancestor walk made precision arithmetically
  // impossible to interpret.
  let recalled = 0
  for (const element of truth) {
    if (detected.has(element)) {
      recalled++
      continue
    }
    const parent = element.parentElement
    if (parent && detected.has(parent)) {
      recalled++
      continue
    }
    if (Array.from(element.children).some((c) => detected.has(c))) recalled++
  }

  const truthSet = new Set(truth)
  let onTarget = 0
  for (const element of detected) {
    if (truthSet.has(element)) {
      onTarget++
      continue
    }
    const parent = element.parentElement
    if (parent && truthSet.has(parent)) {
      onTarget++
      continue
    }
    if (Array.from(element.children).some((c) => truthSet.has(c))) onTarget++
  }

  const nodes = flatten(result.roots)
  const named = nodes.filter((n) => nameOf(n).length > 0).length

  // Record nodes grouped by detected record group — exactly what
  // NavSession.largestRecordSet() sees when choosing where to put the cursor.
  // Grouping by tree parent instead is the bug that made the cursor open on
  // GitHub's filter row: hoisting puts unrelated groups on one level.
  const byGroup = new Map<number, SemanticNode[]>()
  for (const node of nodes) {
    if (node.recordGroup === undefined) continue
    const group = byGroup.get(node.recordGroup)
    if (group) group.push(node)
    else byGroup.set(node.recordGroup, [node])
  }
  const recordSets = [...byGroup.values()]
    .sort((a, b) => b.length - a.length)
    .slice(0, 5)
    .map((g) => `${g[0]!.el.tagName.toLowerCase()} n=${g.length}`)

  return JSON.stringify(
    {
      url: location.href,
      domElements: document.querySelectorAll("*").length,
      groundTruth: truthEntry?.[2] ?? "(none)",
      truthCount: truth.length,
      detectedCount: detected.size,
      groupCount: groups.length,
      recallPct: truth.length
        ? Number(((recalled / truth.length) * 100).toFixed(1))
        : null,
      precisionPct: detected.size
        ? Number(((onTarget / detected.size) * 100).toFixed(1))
        : null,
      groupSummary: groups
        .slice()
        .sort((a, b) => b.items.length - a.items.length)
        .slice(0, 10)
        .map((g) => {
          const el = g.container
          const cls = el.className
          const name =
            typeof cls === "string" && cls
              ? `${el.tagName.toLowerCase()}.${cls.split(/\s+/)[0]}`
              : el.tagName.toLowerCase()
          const hit = g.items.filter(
            (i) =>
              truthSet.has(i) ||
              (i.parentElement && truthSet.has(i.parentElement)) ||
              Array.from(i.children).some((c) => truthSet.has(c))
          ).length
          const first = g.items[0]!
          const firstCls =
            typeof first.className === "string" && first.className
              ? `.${first.className.split(/\s+/)[0]}`
              : ""
          const item = `${first.tagName.toLowerCase()}${firstCls}`
          const sameParent = new Set(g.items.map((i) => i.parentElement)).size
          return (
            `${name} > ${item} n=${g.items.length} hit=${hit} ` +
            `parents=${sameParent} c=${g.confidence.toFixed(2)}`
          )
        }),
      recordSets,
      treeNodes: result.stats.nodes,
      maxDepth: result.stats.maxDepth,
      topLevel: result.roots.length,
      namedPct: nodes.length
        ? Number(((named / nodes.length) * 100).toFixed(1))
        : 0,
      lazy: result.stats.lazy,
      coldMs,
      p50Ms: percentile(timings, 0.5),
      p95Ms: percentile(timings, 0.95),
      treeOnlyP50Ms: percentile(noRecords, 0.5),
      recordsOnlyP50Ms: percentile(detectOnly, 0.5),
      topLevelPreview: result.roots.slice(0, 8).map((n) => {
        const name = nameOf(n) || "(unnamed)"
        const kids = n.children.length ? ` [${n.children.length}]` : ""
        return `${n.role}: ${name.slice(0, 46)}${kids}`
      })
    },
    null,
    1
  )
}
