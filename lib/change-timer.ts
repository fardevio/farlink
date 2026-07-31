/**
 * A countdown that restarts when the thing it watches changes, and not before.
 *
 * The panel puts up three transient messages — the theme name in the header, the
 * status line, and "Opening…" on a row — and each is taken down by a timer out
 * here rather than by the state machine. All three had their own copy of "clear
 * the timer, then set it again", called on every projection.
 *
 * That is the bug. The panel re-projects whenever anything changes, including on
 * every page mutation the observer reports, so a message showing on a page with
 * any ongoing DOM churn had its deadline pushed out by the full delay again and
 * again. The theme name never went away.
 *
 * Two of the three use this: the notice and the status line. "Opening…" keeps its
 * own countdown in the content script, because it also has to add and remove the
 * navigation listeners, which this knows nothing about. It carries the same
 * change guard by hand.
 *
 * Falsy watches cancel: there is nothing on screen left to take down.
 */
export class ChangeTimer {
  private seen: unknown
  private started = false
  private timer = 0

  constructor(
    private readonly ms: number,
    private readonly elapsed: () => void,
    /** Injected so a test can drive it without a real clock. */
    private readonly clock: {
      setTimeout: (fn: () => void, ms: number) => number
      clearTimeout: (id: number) => void
    } = window
  ) {}

  /**
   * Report the current value. The countdown starts on the first call and on
   * every change after it; an unchanged value leaves the running one alone.
   */
  watch(value: unknown): void {
    if (this.started && value === this.seen) return
    this.started = true
    this.seen = value
    this.cancel()
    if (!value) return
    this.timer = this.clock.setTimeout(() => {
      this.timer = 0
      this.elapsed()
    }, this.ms)
  }

  cancel(): void {
    if (!this.timer) return
    this.clock.clearTimeout(this.timer)
    this.timer = 0
  }

  /** Whether a countdown is running, for tests and teardown. */
  get pending(): boolean {
    return this.timer !== 0
  }
}
