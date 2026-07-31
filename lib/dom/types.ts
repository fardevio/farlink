/** A node in the extracted semantic graph. */
export interface SemanticNode {
  el: Element
  role: string
  children: SemanticNode[]
  parent: SemanticNode | null
  /**
   * Roles of significant elements that were skipped between `parent` and this
   * node. Stored on the edge rather than deleted so the breadcrumb can show
   * them and a descent can be reversed exactly.
   */
  collapsed: string[]
  /**
   * Set when this node was promoted from a detected record group. Below
   * `RECORD_CONFIDENT` the UI marks the group uncertain instead of presenting
   * it as records.
   */
  confidence?: number
  /**
   * Which detected record group this node belongs to. Groups can end up as
   * siblings once non-significant containers are hoisted away, so identity has
   * to be carried rather than inferred from parentage.
   */
  recordGroup?: number
}

/** Diagnostics returned alongside a tree, used by the test harness. */
export interface ExtractStats {
  /** Elements considered (visible, non-skipped) under the root. */
  candidates: number
  /** Nodes in the resulting graph. */
  nodes: number
  maxDepth: number
  /**
   * True when the page exceeded `lazyThreshold`, so record detection was
   * skipped. The tree is still built in full.
   */
  lazy: boolean
  /**
   * Nodes discarded by the per-level cap. Non-zero means the tree is an
   * incomplete view of the page, which the panel must not present as complete.
   */
  dropped: number
  elapsedMs: number
}

export interface ExtractResult {
  roots: SemanticNode[]
  stats: ExtractStats
}

/** Record groups at or above this confidence are presented as records. */
export const RECORD_CONFIDENT = 0.65
