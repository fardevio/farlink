import { ChangeTimer } from "~/lib/change-timer"

/**
 * A clock the test drives.
 *
 * `scheduled` counts every setTimeout ever made and is never decremented. That
 * is the point: the bug being guarded against cleared the timer and set another
 * one, so the number of *pending* timers stayed at one and told you nothing. An
 * earlier version of this file asserted on the pending count, and removing the
 * guard it exists to protect did not fail it.
 */
function fakeClock() {
  let next = 1
  let scheduled = 0
  const pending = new Map<number, () => void>()
  return {
    clock: {
      setTimeout: (fn: () => void) => {
        scheduled++
        const id = next++
        pending.set(id, fn)
        return id
      },
      clearTimeout: (id: number) => void pending.delete(id)
    },
    /** Fire everything currently scheduled. */
    fire: () => {
      const due = [...pending.values()]
      pending.clear()
      for (const fn of due) fn()
    },
    scheduled: () => scheduled,
    pending: () => pending.size
  }
}

describe("ChangeTimer", () => {
  it("schedules once however many times the same value is reported", () => {
    // The whole point. The panel re-projects on every page mutation, and the old
    // code cleared and restarted the countdown each time, so a message on a page
    // with any DOM churn had its deadline pushed out for as long as the churn
    // lasted and never came down.
    const { clock, scheduled } = fakeClock()
    const timer = new ChangeTimer(1600, () => {}, clock)
    for (let i = 0; i < 50; i++) timer.watch("Far Manager")
    expect(scheduled(), "restarted the countdown on an unchanged value").toBe(1)
  })

  it("restarts when the value changes", () => {
    const { clock, fire, scheduled, pending } = fakeClock()
    const fired: number[] = []
    const timer = new ChangeTimer(1600, () => fired.push(1), clock)
    timer.watch("Far Manager")
    timer.watch("Nord")
    expect(scheduled()).toBe(2)
    // The first was dropped rather than left to fire alongside the second.
    expect(pending()).toBe(1)
    fire()
    expect(fired).toHaveLength(1)
  })

  it("cancels on a falsy value, because nothing is on screen", () => {
    const { clock, fire, pending } = fakeClock()
    const fired: number[] = []
    const timer = new ChangeTimer(1600, () => fired.push(1), clock)
    timer.watch("Nord")
    timer.watch(null)
    expect(timer.pending).toBe(false)
    expect(pending()).toBe(0)
    fire()
    expect(fired).toHaveLength(0)
  })

  it("starts again after the same value returns", () => {
    // Announce, let it clear, announce the same thing: it has to come back.
    const { clock, fire, scheduled } = fakeClock()
    const fired: number[] = []
    const timer = new ChangeTimer(1600, () => fired.push(1), clock)
    timer.watch("Nord")
    fire()
    timer.watch(null)
    timer.watch("Nord")
    expect(scheduled()).toBe(2)
    fire()
    expect(fired).toHaveLength(2)
  })

  it("never schedules for a value that is falsy from the start", () => {
    // busy arrives false on the first projection and stays false until a
    // navigation begins; that must not put a countdown on the clock.
    const { clock, scheduled } = fakeClock()
    const timer = new ChangeTimer(1200, () => {}, clock)
    timer.watch(false)
    timer.watch(false)
    expect(scheduled()).toBe(0)
  })

  it("cancel stops a countdown that is already running", () => {
    const { clock, fire } = fakeClock()
    const fired: number[] = []
    const timer = new ChangeTimer(1600, () => fired.push(1), clock)
    timer.watch("Nord")
    timer.cancel()
    expect(timer.pending).toBe(false)
    fire()
    expect(fired).toHaveLength(0)
  })
})
