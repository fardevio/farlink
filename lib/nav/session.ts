import { fallbackDescription } from "~/lib/dom/accname"
import { ACTIONABLE, CHROME_ROLES, PAGE_CHROME_SELECTOR } from "~/lib/dom/roles"
import { extractTree, nameOf, pathTo } from "~/lib/dom/tree"
import type { ExtractOptions } from "~/lib/dom/tree"
import { RECORD_CONFIDENT } from "~/lib/dom/types"
import type { SemanticNode } from "~/lib/dom/types"
import type { OpenTabsReply } from "~/lib/messaging"
import { isVisible } from "~/lib/occlusion"
import type { Box } from "~/lib/occlusion"

import { activationTarget, formatUrl, hrefOf, isFragmentJump } from "./actions"
import { captureAnchor, isActivatable, resolveAnchor } from "./anchor"
import type { Anchor, ResolveQuality } from "./anchor"
import { fuzzyMatch } from "./fuzzy"

/**
 * The navigation state machine.
 *
 * Deliberately plain TypeScript with no React and no Chrome APIs: the tree can
 * hold thousands of nodes and making any of it reactive is how this gets slow.
 * The UI subscribes to a small `Projection`, one level's worth of rows, and
 * every side effect goes through `SessionHost` so the whole thing is testable
 * without a browser.
 */

export type Mode = "off" | "normal" | "filter" | "settings"

export type View = "links" | "structure"

export type DockX = "left" | "right"
export type DockY = "top" | "bottom"

/**
 * How much of the viewport the panel takes.
 *
 * Three stops rather than a continuous zoom, because each one is a different
 * *layout* and not just a different size: compact drops the address column and
 * the key bar, because at 420 px a name and an address cannot share a row.
 */
export type PanelSize = "compact" | "normal" | "full"

export const PANEL_SIZES: PanelSize[] = ["compact", "normal", "full"]

/** All four corners, in the order the settings row cycles them. */
const CORNERS: [DockX, DockY][] = [
  ["left", "bottom"],
  ["right", "bottom"],
  ["right", "top"],
  ["left", "top"]
]

/**
 * One line of the settings view.
 *
 * Rendered through the same row as a link, with the label where the name goes
 * and the value where the address goes, so the settings view needs no new
 * layout, no new
 * styling and no second scrolling implementation.
 */
export interface SettingRow {
  key: string
  label: string
  value: string
  /**
   * True when Enter should open this row rather than step it. The row carries
   * no URL: what opening means is the host's business, so the session never
   * learns about repository addresses or chrome:// pages.
   */
  openable?: boolean
  /** A rule between groups. Not a row you can land on or act on. */
  divider?: boolean
}

export interface LevelItem {
  name: string
  /** Shortened href, shown after the name. Null for anything not a link. */
  url: string | null
  /** Indices in `name` that matched the current query, for highlighting. */
  match: number[]
  /** The same, in `url`: a filter searches the address as well as the title. */
  urlMatch: number[]
  /** Record group below the confidence bar: shown, but not claimed as a record. */
  uncertain: boolean
  /** Settings only: draws as a rule, and the cursor steps over it. */
  divider?: boolean
  /** Settings only: Enter opens this instead of stepping it, so it reads as a link. */
  openable?: boolean
}

export interface Projection {
  mode: Mode
  /** Root-to-cursor path, including roles collapsed on each edge. */
  breadcrumb: string[]
  items: LevelItem[]
  cursorIndex: number
  quality: ResolveQuality
  filter: string
  pending: string
  status: string | null
  /**
   * A short announcement about the panel itself, shown in the header's right
   * corner and cleared on a timer. Distinct from `status`, which is about the
   * list and sits at the foot.
   */
  notice: string | null
  /**
   * A navigation is in flight. Shown on the row it belongs to rather than in
   * the status line: "Opening…" at the foot of the panel says something is
   * happening but not to what, and the row is where the user is looking.
   */
  busy: boolean
  /** Which corner the panel is drawn in. */
  dockX: DockX
  dockY: DockY
  size: PanelSize
  view: View
  /** True when the last action was refused pending confirmation. */
  awaitingConfirm: boolean
}

export interface SessionHost {
  /** Advance to the next theme and persist it. The UI layer owns the palette. */
  cycleTheme?(): void

  /**
   * Settings the session does not own (the theme) and
   * their current values, for the settings view to show.
   */
  hostSettings?(): SettingRow[]

  /** Step one of those settings. */
  changeSetting?(key: string, delta: 1 | -1): void

  /** Act on a row marked `openable`, named by its key. */
  openSetting?(key: string): void

  /**
   * Scroll the cursor's element into view.
   *
   * Called only for deliberate movement (arrows, Home/End, PageUp/Down), never
   * while a filter is being typed. The cursor jumps rows on every keystroke
   * there, and revealing each one is a scroll storm; the first arrow press after
   * typing is the user opting in.
   */
  reveal(el: Element): void

  /** The page's scroll offset, so leaving can put it back. */
  scrollTop(): number

  /** Return the page to where it was when the panel opened. */
  restoreScroll(top: number): void

  /**
   * Opens a batch in one call. Deliberately not one-URL-at-a-time: the worker
   * caps how many tabs a single request may open, and a cap applied per
   * message is no cap at all.
   *
   * Returns what actually happened, per URL. It used to return `void`, which
   * made the outcome unrepresentable, so `openTargets` had nothing to branch on
   * and said "Opened tab" unconditionally — including for the `mailto:` links
   * the panel indexes on purpose and the worker refuses to open. Null when the
   * worker could not be reached at all.
   */
  openUrls(
    urls: [string, ...string[]],
    background: boolean
  ): Promise<OpenTabsReply | null>
  /**
   * Our own panel's rect, so "visible" can mean visible rather than merely
   * within the viewport. Null when nothing is drawn.
   */
  obstruction?(): Box | null
  extractOptions?: ExtractOptions
}

/**
 * A record set at least this large is treated as the reason the page exists,
 * and the cursor opens on it instead of at the top of the main content.
 */
const DOMINANT_RECORD_SET = 8

/** A content block is taller than this; a tab strip or breadcrumb is not. */
const TOOLBAR_MAX_HEIGHT = 64

/**
 * Upper bound on the link index. A safety valve against a pathological page,
 * not a feature limit. It must stay far above any real page's link count.
 *
 * These were one constant, and sharing it was wrong in a way that only showed
 * up once the index became the default view: hints are capped because
 * two-character labels run out at 676, which is a fact about labels and says
 * nothing about how many links you may search. Wikipedia's New York University
 * article has roughly 1,400, so the index stopped at 500 and filtering for
 * "equestrianism", plainly on the page, found nothing at all. A search that
 * silently cannot see two-thirds of the page is not a search.
 */
const MAX_INDEX_LINKS = 5000

/**
 * Offsets the start-of-string bonus that scoring a slice of the address
 * fabricates, so an address match and a title match are on one scale and an
 * equally good title wins.
 */
const ADDRESS_PENALTY = 12

/** One node's answer to the current filter. */
interface Hit {
  node: SemanticNode
  score: number
  match: number[]
  urlMatch: number[]
}

/**
 * The one place a message about opening a tab is produced.
 *
 * Every branch is driven by evidence from the worker, so there is no way to
 * report success without it. The status line used to say "Opened tab" before the
 * message had even been sent.
 */
export function openedMessage(reply: OpenTabsReply | null): string {
  // No answer at all: the worker was unreachable, which is not the same as a
  // refusal and must not read like one.
  if (!reply) return "Could not reach the extension"

  const opened = reply.results.filter((r) => r.opened).length
  if (opened > 0) return opened === 1 ? "Opened tab" : `Opened ${opened} tabs`

  const refused = reply.results.find((r) => !r.opened)
  if (!refused) return "Nothing to open"
  switch (refused.reason) {
    case "throttled":
      return "Too many tabs at once, try again"
    case "not-web":
      return "Only http and https links open in a tab"
    default:
      return "Could not open it"
  }
}

/**
 * Frozen because it is handed out by reference to every subscriber, and
 * `subscribe` fires immediately at construction — so one subscriber mutating
 * what it received would corrupt the closed-panel projection for every future
 * caller in the process.
 */
const EMPTY_PROJECTION: Projection = Object.freeze({
  mode: "off",
  breadcrumb: [],
  items: [],
  cursorIndex: -1,
  quality: "exact",
  filter: "",
  pending: "",
  status: null,
  notice: null,
  busy: false,
  dockX: "left",
  dockY: "bottom",
  size: "normal",
  view: "links",
  awaitingConfirm: false
})

export class NavSession {
  private host: SessionHost
  private explicitRoot: Element | null

  private mode: Mode = "off"
  private roots: SemanticNode[] = []
  private cursor: SemanticNode | null = null
  private quality: ResolveQuality = "exact"

  private filter = ""
  private pending = ""
  private status: string | null = null
  private notice: string | null = null
  private busy = false
  private dockX: DockX = "left"
  private dockY: DockY = "bottom"
  private size: PanelSize = "normal"
  /** Cursor within the settings view, which is a separate list. */
  private settingsIndex = 0
  /**
   * Where the page was when the panel opened, restored on leaving.
   *
   * This is what makes revealing safe rather than merely tolerable. The
   * objection to moving the page was never that it moved. It was losing your
   * place. With the offset remembered you can walk a whole page through the
   * list and end up exactly where you started.
   */
  private openedAt = 0
  /** Set once the user has moved deliberately; suppresses reveal until then. */
  private moved = false
  private awaitingConfirm = false
  private view: View = "links"
  /** Every link and control on the page, rebuilt with the tree. */
  private links: SemanticNode[] = []
  /** Formatted hrefs, memoized per tree. See `urlFor`. */
  private urls = new Map<SemanticNode, string | null>()

  private listeners = new Set<(p: Projection) => void>()

  constructor(host: SessionHost, root?: Element) {
    this.host = host
    this.explicitRoot = root ?? null
  }

  /**
   * Resolved on every use rather than captured once.
   *
   * `document.body` is null at `document_start`, and the panel can be opened
   * before it exists; a root captured then would stay null for the life of the
   * page. Some single-page apps also replace `document.body` outright, which
   * would leave the session extracting from a detached tree forever.
   */
  private get root(): Element {
    return this.explicitRoot ?? document.body ?? document.documentElement
  }

  // --- subscription -------------------------------------------------------

  subscribe(fn: (p: Projection) => void): () => void {
    this.listeners.add(fn)
    fn(this.project())
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    const projection = this.project()
    for (const fn of this.listeners) fn(projection)
  }

  /** Public so the page agent can surface something the session cannot know. */
  say(message: string): void {
    this.status = message
    this.emit()
  }

  /** A transient note about the panel itself, shown top-right. */
  announce(message: string): void {
    this.notice = message
    this.emit()
  }

  clearNotice(): void {
    if (this.notice === null) return
    this.notice = null
    this.emit()
  }

  // --- lifecycle ----------------------------------------------------------

  get isOpen(): boolean {
    return this.mode !== "off"
  }

  get cursorElement(): Element | null {
    return this.cursor?.el ?? null
  }

  open(restore?: SerializedAnchor): void {
    this.rebuild()
    this.openedAt = this.host.scrollTop()
    this.moved = false
    this.busy = false
    this.mode = "normal"

    // A page with no links at all has nothing for the index to list, so fall
    // through to the tree rather than opening on an empty panel.
    if (this.view === "links" && this.links.length === 0) {
      this.view = "structure"
    }

    if (restore) {
      const found = resolveAnchor(deserializeAnchor(restore), this.root)
      if (found.el) {
        const node = this.nodeFor(found.el)
        if (node) this.cursor = node
      }
    }
    // `close()` deliberately keeps the cursor so reopening returns you where
    // you were, but `rebuild()` just replaced every node object, so the old
    // one belongs to a tree that no longer exists. Re-find it by element.
    if (this.cursor) this.cursor = this.nodeFor(this.cursor.el)

    if (!this.cursor) {
      // Draw the panel before choosing where the cursor goes. "Which links can
      // the user see?" cannot be answered until the thing covering a third of
      // them is actually on screen and has a rect.
      this.emit()
      this.cursor = this.preferredStart()
    }
    this.emit()
  }

  /**
   * Where the cursor lands when there is nothing to restore.
   *
   * Not simply the first root: on a page whose outermost structure is a header
   * (which is most pages) that opens the cursor on the site navigation with
   * the actual content several levels down. Prefer the main landmark, then the
   * first detected record, and only then fall back to document order.
   */
  private preferredStart(): SemanticNode | null {
    // Read once: the panel's rect costs a layout flush, and this asks about
    // every node on the page.
    const panel = this.host.obstruction?.() ?? null

    if (this.view === "links") {
      return (
        this.links.find((n) => this.inViewport(n.el, panel)) ??
        this.links[0] ??
        null
      )
    }

    const main = this.root.querySelector("main, [role=main]")
    const inMain = (node: SemanticNode) =>
      main === null || (node.el !== main && main.contains(node.el))
    const onScreen = (node: SemanticNode) => this.inViewport(node.el, panel)

    // Being inside `main` is not the same as being content. Wikipedia puts the
    // article tabs, page tools and appearance panel inside `<main>`, so the
    // first visible named node there is the "Main Page / Talk" tab strip:
    // technically correct and useless. Chrome is skipped for placement the
    // same way record detection skips it.
    const isContent = (node: SemanticNode) =>
      !CHROME_ROLES.has(node.role) &&
      node.el.closest(PAGE_CHROME_SELECTOR) === null &&
      !this.looksLikeToolbar(node)

    // What the user can see wins, always. Opening a navigation tool must never
    // move the page, and ranking record sets by size alone did exactly that:
    // on Wikipedia's main page the biggest repeated structure by far is the
    // list of languages at the very bottom, so opening at the top of the
    // article scrolled the window down to a wall of language links. The
    // viewport is the strongest statement of intent available and costs
    // nothing to read.
    //
    // The set still has to be long in *total* to count as the point of the
    // page. A screenful of a feed is four or five rows, so counting only the
    // visible ones would reject every feed there is. It qualifies when some of
    // it is on screen, and the cursor goes to the first row that is: opening
    // halfway down a feed should not jump back to the top.
    const dominant = this.largestRecordSet(inMain, DOMINANT_RECORD_SET)
    const visibleRecord = dominant?.find(onScreen)
    if (visibleRecord) return visibleRecord

    // Named, because the first node in view is often a wrapper with nothing to
    // show, and a row reading "(unnamed paragraph)" says nothing about where
    // the cursor is.
    const visibleNamed = this.findNode(
      (node) =>
        inMain(node) && onScreen(node) && isContent(node) && nameOf(node) !== ""
    )
    if (visibleNamed) return visibleNamed

    // Everything on screen is chrome: a page that is all navigation, or one
    // still loading its content. Better to land somewhere real than nowhere.
    const visible = this.findNode(
      (node) => inMain(node) && onScreen(node) && nameOf(node) !== ""
    )
    if (visible) return visible

    // Nothing at all in view, so an empty or still-loading viewport. Fall back to
    // document order within the content, which at least is not arbitrary.
    if (dominant?.[0]) return dominant[0]

    const named = this.findNode((node) => inMain(node) && nameOf(node) !== "")
    if (named) return named

    return this.findNode(inMain) ?? this.roots[0] ?? null
  }

  /**
   * Whether any part of `el` can actually be seen: on screen, and not behind
   * our own panel. A link the panel is covering is not somewhere to put the
   * cursor on open, however true it is that the viewport contains it.
   *
   * Goes through the same `rectOf` seam the extractor uses, so tests can
   * declare geometry, because happy-dom does not lay out and a real
   * `getBoundingClientRect` there reports every element as invisible.
   */
  private inViewport(el: Element, obstruction: Box | null = null): boolean {
    const rectOf =
      this.host.extractOptions?.rectOf ??
      ((target: Element) => target.getBoundingClientRect())
    const viewport = {
      width: window.innerWidth || 1200,
      height: window.innerHeight || 800
    }
    return isVisible(rectOf(el), viewport, obstruction)
  }

  /**
   * The biggest set of records, in document order.
   *
   * Not simply the first record on the page: on GitHub the first record set
   * inside `main` is a row of three filter dropdowns, and the repository list
   * (the thing the user came for) is further down. The dominant list is a
   * far better guess than document order.
   */
  private largestRecordSet(
    accept: (node: SemanticNode) => boolean,
    minimum: number
  ): SemanticNode[] | null {
    // Grouped by detected record group, not by tree parent. Once
    // non-significant containers are hoisted away, records from different
    // groups become siblings. On GitHub's trending page the three filter
    // dropdowns and the eighteen repository rows end up on one level, and
    // grouping by parent sees a single set of twenty-one whose first member
    // is a dropdown.
    const sets = new Map<number, SemanticNode[]>()
    const walk = (nodes: SemanticNode[]) => {
      for (const node of nodes) {
        if (node.recordGroup !== undefined && accept(node)) {
          const group = sets.get(node.recordGroup)
          if (group) group.push(node)
          else sets.set(node.recordGroup, [node])
        }
        walk(node.children)
      }
    }
    walk(this.roots)

    let best: SemanticNode[] | null = null
    for (const group of sets.values()) {
      if (group.length < minimum) continue
      if (!best || group.length > best.length) best = group
    }
    return best
  }

  /**
   * A short band that is almost entirely links: a tab strip, a breadcrumb, a
   * page toolbar. Wikipedia's article tabs are not marked up as `nav` and sit
   * inside `<main>`, so nothing in the markup distinguishes them from content;
   * their shape does.
   */
  private looksLikeToolbar(node: SemanticNode): boolean {
    const rectOf =
      this.host.extractOptions?.rectOf ??
      ((target: Element) => target.getBoundingClientRect())
    if (rectOf(node.el).height >= TOOLBAR_MAX_HEIGHT) return false

    const links = node.el.querySelectorAll("a[href], [role=link]")
    if (links.length < 3) return false

    const total = (node.el.textContent || "").replace(/\s+/g, "").length
    if (total === 0) return false
    let linkText = 0
    for (const link of links) {
      linkText += (link.textContent || "").replace(/\s+/g, "").length
    }
    return linkText / total > 0.8
  }

  /** First node in document order matching `predicate`. */
  private findNode(
    predicate: (node: SemanticNode) => boolean
  ): SemanticNode | null {
    const walk = (nodes: SemanticNode[]): SemanticNode | null => {
      for (const node of nodes) {
        if (predicate(node)) return node
        const nested = walk(node.children)
        if (nested) return nested
      }
      return null
    }
    return walk(this.roots)
  }

  close(): void {
    // Only when the user leaves without following anything. Activating means
    // they wanted to be somewhere else, and putting the page back would undo it.
    if (this.moved && !this.busy) this.host.restoreScroll(this.openedAt)
    this.mode = "off"
    this.filter = ""
    this.pending = ""
    this.awaitingConfirm = false
    this.emit()
  }

  private rebuild(): void {
    const result = extractTree(this.root, this.host.extractOptions ?? {})
    this.roots = result.roots
    // Replaced, not cleared: the old nodes are gone, and a Map keyed on them
    // would pin every one of them alive for the life of the page.
    this.urls = new Map()
    this.links = this.linkTargets()
  }

  /**
   * Re-extract after the page mutated and re-anchor the cursor and every mark.
   * A degraded cursor stays navigable but refuses to activate until confirmed.
   */
  reconcile(): void {
    if (this.mode === "off") return
    try {
      this.reconcileInner()
    } catch (error) {
      // Fail *closed*. If re-anchoring threw, which a hostile page can cause with a
      // tag name that makes any selector built from it a syntax error, then
      // leaving `quality` at its old value would keep the activation guard
      // switched off while the HUD showed a stale label. That is the one
      // failure mode that gets a user to press Enter on the wrong element.
      console.warn("[farlink] reconcile failed; cursor invalidated", error)
      this.quality = "lost"
      this.awaitingConfirm = false
      this.emit()
    }
  }

  private reconcileInner(): void {
    const cursorAnchor = this.cursor ? captureAnchor(this.cursor.el) : null

    this.rebuild()

    if (cursorAnchor) {
      const found = resolveAnchor(cursorAnchor, this.root)
      this.quality = found.quality
      this.cursor = found.el ? this.nodeFor(found.el) : null
      if (!this.cursor) {
        this.cursor = this.roots[0] ?? null
        this.quality = found.el ? "degraded" : "lost"
      }
      if (!isActivatable(this.quality)) this.awaitingConfirm = false
    }

    // A page still loading when the panel opened has no links and so no
    // cursor, and re-anchoring cannot restore what was never there. Without
    // this the list fills in as content arrives and nothing is ever selected.
    if (!this.cursor) this.cursor = this.preferredStart()

    this.emit()
  }

  /** The node whose element is `el`, or the nearest ancestor node. */
  private nodeFor(el: Element): SemanticNode | null {
    let best: SemanticNode | null = null
    const walk = (nodes: SemanticNode[]): boolean => {
      for (const node of nodes) {
        if (node.el === el) {
          best = node
          return true
        }
        if (node.el.contains(el)) {
          best = node
          if (walk(node.children)) return true
          return true
        }
      }
      return false
    }
    walk(this.roots)
    return best
  }

  // --- level model --------------------------------------------------------

  private siblings(): SemanticNode[] {
    if (!this.cursor) return this.roots
    return this.cursor.parent ? this.cursor.parent.children : this.roots
  }

  /**
   * Switch between the flat link index and the structural tree.
   *
   * The index is the default because targeting a link is the common case and a
   * flat list costs no descending. The tree is one keypress away and is what
   * makes a *scoped* batch possible: "these five comments" needs a boundary
   * that a flat list of four hundred links does not have.
   */
  setView(view: View): void {
    if (this.view === view) return
    this.view = view
    this.filter = ""
    const list = this.level()
    if (this.cursor && !list.includes(this.cursor)) {
      const first = list[0]
      if (first) this.cursor = first
    }
    if (!this.cursor) this.cursor = this.level()[0] ?? null
    this.emit()
  }

  /**
   * Every named link on the page that goes somewhere, in document order.
   *
   * A name via `nameOf`, not `labelFor`, which falls back to the URL: Hacker
   * News vote arrows are unnamed links, and a quarter of a 231-row index read
   * "news.ycombinator.com/vote" with no way to tell the rows apart.
   *
   * And a destination, because `ACTIONABLE` also covers buttons and textboxes,
   * which put rows with an empty address column in a panel that counts links.
   */
  private linkTargets(): SemanticNode[] {
    const out: SemanticNode[] = []
    const seen = new Set<string>()
    const walk = (nodes: SemanticNode[]) => {
      for (const node of nodes) {
        if (out.length >= MAX_INDEX_LINKS) return
        if (ACTIONABLE.has(node.role)) {
          const name = nameOf(node)
          const href = hrefOf(node.el)
          if (name !== "" && href !== null) {
            const key = `${name}\u0000${href}`
            if (!seen.has(key)) {
              seen.add(key)
              out.push(node)
            }
          }
        }
        walk(node.children)
      }
    }
    walk(this.roots)
    return out
  }

  private level(): SemanticNode[] {
    const all = this.view === "links" ? this.links : this.siblings()
    if (!this.filter) return all
    return this.matches(all).map((hit) => hit.node)
  }

  /**
   * A filter matches the title or the address, by two different rules.
   *
   * Titles match fuzzily. Addresses match as a substring, never fuzzily: a path
   * is a dense run of letters with nothing to aim at, so "post" would find
   * p-o-s-t inside "example.com/docs/install" and inside most other URLs on the
   * page.
   */
  private matchNode(query: string, node: SemanticNode): Hit | null {
    const named = fuzzyMatch(query, this.labelFor(node))
    const title: Hit | null = named && {
      node,
      score: named.score,
      match: named.positions,
      urlMatch: []
    }

    const url = this.urlFor(node)
    const at = url ? url.toLowerCase().indexOf(query.toLowerCase()) : -1
    if (!url || at === -1) return title

    // Scored on the same scale as a title rather than sorted into a tier below
    // it. Tiers put *any* title match above *every* address match, and a
    // scattered fuzzy title match is a much worse answer than an exact run in
    // the address: filtering Hacker News for "item" ranked eight rows of
    // "**it**sallabout**the**bit.**com**" above every "/**item**?id=" there
    // was. Contiguity is already most of what fuzzyMatch rewards, so scoring
    // the run itself puts the exact match on top without a special case.
    const run = fuzzyMatch(query, url.slice(at))
    const address: Hit = {
      node,
      // Earlier in the address is better: the host and the first path segment
      // say more than a fragment buried at the end.
      score: (run?.score ?? 0) - ADDRESS_PENALTY - Math.floor(at / 8),
      match: [],
      urlMatch: Array.from({ length: query.length }, (_, i) => at + i)
    }

    if (!title) return address
    return title.score >= address.score ? title : address
  }

  /** Every node matching the current filter, best first. */
  private matches(nodes: SemanticNode[]): Hit[] {
    const query = this.filter
    const found: { hit: Hit; index: number }[] = []
    nodes.forEach((node, index) => {
      const hit = this.matchNode(query, node)
      if (hit) found.push({ hit, index })
    })
    // By score, then in document order, which is the order the user can
    // already see on the page.
    return found
      .sort((a, b) => b.hit.score - a.hit.score || a.index - b.index)
      .map((entry) => entry.hit)
  }

  /**
   * Shortened href for the listing, or null when there is nothing to show.
   *
   * Memoized for the life of the tree. It is a DOM query plus two `new URL()`
   * constructions, and the filter now asks for it once per link per keystroke
   * On a page with 1,800 links that was 3,600 URL parses between one
   * keypress and the next.
   */
  private urlFor(node: SemanticNode): string | null {
    const cached = this.urls.get(node)
    if (cached !== undefined) return cached

    const href = hrefOf(node.el)
    const url = href ? formatUrl(href, this.root.ownerDocument.baseURI) : null
    this.urls.set(node, url)
    return url
  }

  private labelFor(node: SemanticNode): string {
    const name = nameOf(node)
    return name || fallbackDescription(node.el, node.role)
  }

  private cursorIndexIn(list: SemanticNode[]): number {
    return this.cursor ? list.indexOf(this.cursor) : -1
  }

  // --- movement -----------------------------------------------------------

  move(delta: number): void {
    const list = this.level()
    if (list.length === 0) return

    const at = this.cursorIndexIn(list)
    const next =
      at === -1 ? 0 : Math.min(list.length - 1, Math.max(0, at + delta))
    this.deliberately(() => this.setCursor(list[next]!))
  }

  first(): void {
    const list = this.level()
    if (list[0]) this.deliberately(() => this.setCursor(list[0]!))
  }

  last(): void {
    const list = this.level()
    const item = list[list.length - 1]
    if (item) this.deliberately(() => this.setCursor(item))
  }

  private setCursor(node: SemanticNode): void {
    this.busy = false
    this.cursor = node
    this.quality = "exact"
    this.awaitingConfirm = false
    if (this.moved) this.host.reveal(node.el)
    this.emit()
  }

  /**
   * Movement the user asked for, as opposed to the cursor being pulled along by
   * a filter. Only this kind scrolls the page.
   */
  private deliberately(move: () => void): void {
    this.moved = true
    move()
  }

  // --- filter -------------------------------------------------------------

  /** Start filtering, optionally with the character that started it. */
  beginFilter(initial = ""): void {
    this.mode = "filter"
    this.filter = initial
    this.busy = false
    if (initial) {
      const list = this.level()
      if (list.length > 0 && this.cursorIndexIn(list) === -1) {
        this.cursor = list[0]!
      }
    }
    this.emit()
  }

  setFilter(value: string): void {
    this.busy = false
    this.filter = value
    const list = this.level()
    if (list.length > 0 && this.cursorIndexIn(list) === -1) {
      this.cursor = list[0]!
    }
    this.emit()
  }

  cancelFilter(): void {
    this.mode = "normal"
    this.filter = ""
    this.emit()
  }

  /**
   * Acting on a mis-anchored node is the one failure that permanently loses
   * trust, so a degraded cursor requires the key to be pressed twice.
   */
  private guardActivation(): boolean {
    if (isActivatable(this.quality)) return true
    if (this.awaitingConfirm) {
      this.awaitingConfirm = false
      return true
    }
    this.awaitingConfirm = true
    this.say("Cursor moved, repeat to confirm")
    this.emit()
    return false
  }

  // --- operations ---------------------------------------------------------

  activate(): void {
    if (!this.guardActivation()) return
    const node = this.cursor
    if (!node) return

    const target = activationTarget(node.el) ?? node.el
    const href = hrefOf(node.el)

    // A fragment on this page is not a page load: the browser jumps, nothing
    // unloads, and there is nothing to wait for. Showing "Opening…" and dimming
    // the list for it invented a transition where the whole point is that there
    // is none.
    if (!href || !isFragmentJump(href, this.root.ownerDocument.baseURI)) {
      // Marked before the click, so the row is already showing "Opening…" when
      // a synchronous handler on the page starts working.
      this.busy = true
      this.emit()
    }
    ;(target as HTMLElement).click?.()
  }

  openTargets(background: boolean): void {
    if (!this.guardActivation()) return
    if (!this.cursor) return

    const href = hrefOf(this.cursor.el)
    if (!href) {
      this.say("No link here")
      this.emit()
      return
    }
    // A statement of intent, which cannot be wrong. The outcome arrives one
    // round-trip later — an asleep worker is a cold start — and replaces this.
    this.say("Opening tab…")
    this.emit()
    void this.host.openUrls([href], background).then((reply) => {
      this.say(openedMessage(reply))
      this.emit()
    })
  }

  // --- misc ---------------------------------------------------------------

  setPending(value: string): void {
    this.pending = value
    this.emit()
  }

  /**
   * Stop showing a navigation as in flight.
   *
   * Driven by a timer in the content script rather than by anything here. A
   * same-tab navigation tears the page down and the question never arises, but
   * an in-page anchor does not: the click resolves instantly and nothing would
   * ever take the word back off the row.
   */
  clearBusy(): void {
    if (!this.busy) return
    this.busy = false
    this.emit()
  }

  /**
   * Move the panel to a corner, or report that it is already there.
   *
   * The lightweight answer to the panel covering the thing you wanted to read:
   * cheaper than scrolling the page around it, and unlike auto-placement it
   * leaves the panel exactly where you last put it, which is most of what
   * makes a docked panel readable.
   */
  setDockX(dock: DockX): void {
    if (this.dockX === dock) return
    this.dockX = dock
    this.emit()
  }

  setDockY(dock: DockY): void {
    if (this.dockY === dock) return
    this.dockY = dock
    this.emit()
  }

  /**
   * Step to the next size, wrapping.
   *
   * One key that cycles rather than separate grow and shrink keys: with three
   * stops, wrapping is never more than two presses from anywhere, and it costs
   * one binding instead of two in a keyspace where every unmodified letter is
   * the start of a search.
   */
  cycleSize(): void {
    const at = PANEL_SIZES.indexOf(this.size)
    this.size = PANEL_SIZES[(at + 1) % PANEL_SIZES.length]!
    this.emit()
  }

  /**
   * Step to the next theme.
   *
   * Delegated rather than implemented here: the session knows nothing about
   * color, and the flavor has to be persisted through settings, which is the
   * page agent's business.
   */
  cycleTheme(): void {
    this.host.cycleTheme?.()
  }

  /**
   * The settings view: the panel's own preferences, editable without leaving it.
   *
   * Here rather than only in the options page because cycling blind through
   * twelve themes on one key is not discovery, and because a keyboard tool
   * should not send you to a mouse-driven page to change how it looks.
   */
  openSettings(): void {
    this.mode = "settings"
    this.settingsIndex = 0
    this.emit()
  }

  closeSettings(): void {
    this.mode = "normal"
    this.emit()
  }

  /** Rows shown in the settings view: the session's own, then the host's. */
  settingRows(): SettingRow[] {
    const corner = `${this.dockY}-${this.dockX}`
    return [
      { key: "size", label: "Size", value: this.size },
      { key: "corner", label: "Corner", value: corner },
      ...(this.host.hostSettings?.() ?? [])
    ]
  }

  /**
   * Re-project because something the host reports has changed.
   *
   * Nothing in here moved; a value the host supplies to `hostSettings()` did.
   * Goes through the one render path rather than letting the host draw itself.
   */
  refresh(): void {
    this.emit()
  }

  /**
   * What Enter does in the settings view, which depends on the row.
   *
   * A row with values steps to the next one, which is what Enter has always
   * done here. A row that only reports something -- the shortcut, the
   * repository -- opens it instead. One row is never both, so there is nothing
   * to disambiguate.
   */
  activateSetting(): void {
    const row = this.settingRows()[this.settingsIndex]
    if (!row) return
    if (!row.openable) {
      this.adjustSetting(1)
      return
    }
    this.host.openSetting?.(row.key)
  }

  moveSetting(delta: number): void {
    const rows = this.settingRows()
    if (rows.length === 0) return

    // Clamp first, the way this always has, then step off a rule: a divider is
    // drawn between groups and is not somewhere the cursor can rest.
    const step = delta > 0 ? 1 : -1
    let next = Math.min(
      rows.length - 1,
      Math.max(0, this.settingsIndex + delta)
    )
    while (rows[next]?.divider) {
      const moved = next + step
      if (moved < 0 || moved >= rows.length) return
      next = moved
    }

    this.settingsIndex = next
    this.emit()
  }

  /**
   * Step the focused setting. Left and right, because they are free here:
   * docking is an Alt chord, so a bare arrow means nothing else in this view.
   */
  adjustSetting(delta: 1 | -1): void {
    const row = this.settingRows()[this.settingsIndex]
    if (!row) return

    if (row.key === "size") {
      const at = PANEL_SIZES.indexOf(this.size)
      const next = (at + delta + PANEL_SIZES.length) % PANEL_SIZES.length
      this.size = PANEL_SIZES[next]!
      this.emit()
      return
    }

    if (row.key === "corner") {
      const at = CORNERS.findIndex(
        ([x, y]) => x === this.dockX && y === this.dockY
      )
      const next = (at + delta + CORNERS.length) % CORNERS.length
      const [x, y] = CORNERS[next]!
      this.dockX = x
      this.dockY = y
      this.emit()
      return
    }

    this.host.changeSetting?.(row.key, delta)
  }

  /** Restores the corner and size the user last chose. */
  applyLayout(dockX: DockX, dockY: DockY, size: PanelSize): void {
    this.dockX = dockX
    this.dockY = dockY
    this.size = size
  }

  clearStatus(): void {
    if (this.status === null) return
    this.status = null
    this.emit()
  }

  serializeCursor(): SerializedAnchor | null {
    if (!this.cursor) return null
    return serializeAnchor(captureAnchor(this.cursor.el))
  }

  // --- projection ---------------------------------------------------------

  /**
   * The settings view, projected through the ordinary row shape: the label goes
   * where a link's name goes and the value where its address goes.
   */
  private projectSettings(): Projection {
    const rows = this.settingRows()
    return {
      ...EMPTY_PROJECTION,
      mode: "settings",
      breadcrumb: ["settings"],
      items: rows.map((row) => ({
        name: row.label,
        url: row.value,
        match: [],
        urlMatch: [],
        uncertain: false,
        divider: row.divider,
        openable: row.openable
      })),
      cursorIndex: this.settingsIndex,
      quality: this.quality,
      notice: this.notice,
      dockX: this.dockX,
      dockY: this.dockY,
      size: this.size,
      view: this.view
    }
  }

  private toItems(nodes: SemanticNode[]): LevelItem[] {
    const query = this.filter
    return nodes.map((node) => {
      // Highlighted in whichever column it actually matched. A row that
      // matched only in its address would otherwise show no highlight at all
      // and read as an arbitrary result, the same complaint that put
      // highlighting on names in the first place.
      const hit = query ? this.matchNode(query, node) : null

      return {
        name: this.labelFor(node),
        url: this.urlFor(node),
        match: hit?.match ?? [],
        urlMatch: hit?.urlMatch ?? [],
        uncertain:
          node.confidence !== undefined && node.confidence < RECORD_CONFIDENT
      }
    })
  }

  project(): Projection {
    if (this.mode === "off") return EMPTY_PROJECTION
    if (this.mode === "settings") return this.projectSettings()

    const list = this.level()
    const cursorIndex = this.cursorIndexIn(list)

    const breadcrumb: string[] = []
    if (this.view === "links") {
      // A flat index has no path. Say what it is and how big it is instead.
      let host = ""
      try {
        host = new URL(this.root.ownerDocument.baseURI).hostname.replace(
          /^www\./,
          ""
        )
      } catch {
        host = ""
      }
      if (host) breadcrumb.push(host)
      // Counts what is on screen, not what the page holds. A filtered list
      // under a header still reading "1704 links" describes a list that is no
      // longer there.
      breadcrumb.push(
        this.filter
          ? `${list.length} of ${this.links.length} links`
          : `${this.links.length} links`
      )
    } else if (this.cursor) {
      for (const node of pathTo(this.cursor)) {
        for (const role of node.collapsed) breadcrumb.push(role)
        breadcrumb.push(nameOf(node) || node.role)
      }
    }

    return {
      mode: this.mode,
      breadcrumb,
      items: this.toItems(list),
      cursorIndex,
      quality: this.quality,
      filter: this.filter,
      pending: this.pending,
      status: this.status,
      notice: this.notice,
      busy: this.busy,
      dockX: this.dockX,
      dockY: this.dockY,
      size: this.size,
      view: this.view,
      awaitingConfirm: this.awaitingConfirm
    }
  }
}

// --- checkpointing ---------------------------------------------------------

/** An anchor without WeakRefs, small enough for chrome.storage.session. */
export interface SerializedAnchor {
  role: string
  tag: string
  id?: string
  testId?: string
  href?: string
  formName?: string
  nameHash?: string
  textHash?: string
  ancestorRoles: string[]
  siblingIndex: number
  setSize: number
  posinset?: number
}

export function serializeAnchor(anchor: Anchor): SerializedAnchor {
  const { ref: _ref, ancestorRefs: _refs, rect: _rect, ...rest } = anchor
  return rest
}

export function deserializeAnchor(stored: SerializedAnchor): Anchor {
  return {
    ...stored,
    rect: { x: 0, y: 0, w: 0, h: 0 },
    // A restored anchor has no live references, so resolution starts from the
    // document and relies entirely on identity signals.
    ref: new WeakRef(document.documentElement),
    ancestorRefs: []
  }
}
