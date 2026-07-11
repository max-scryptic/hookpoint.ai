import { describe, expect, it } from "vitest"

import { computeFreePeriodWindow } from "@/lib/billing/entitlements"

// The Free plan's monthly reset is anchored to the account creation date, so
// this pure window computation is the heart of "when do limits reset". It must
// always return the window [start, end) that contains `now`, with the anchor's
// day-of-month preserved (clamped in short months).
describe("computeFreePeriodWindow", () => {
  it("returns the first window when now is inside the first month", () => {
    const anchor = new Date("2026-01-10T09:00:00Z")
    const now = new Date("2026-01-25T12:00:00Z")
    const { start, end } = computeFreePeriodWindow(anchor, now)
    expect(start.toISOString()).toBe("2026-01-10T09:00:00.000Z")
    expect(end.toISOString()).toBe("2026-02-10T09:00:00.000Z")
  })

  it("rolls forward to the window containing now several months later", () => {
    const anchor = new Date("2026-01-10T09:00:00Z")
    const now = new Date("2026-04-15T00:00:00Z")
    const { start, end } = computeFreePeriodWindow(anchor, now)
    expect(start.toISOString()).toBe("2026-04-10T09:00:00.000Z")
    expect(end.toISOString()).toBe("2026-05-10T09:00:00.000Z")
  })

  it("always brackets now: start <= now < end", () => {
    const anchor = new Date("2026-01-31T09:00:00Z")
    for (const iso of [
      "2026-02-01T00:00:00Z",
      "2026-02-28T23:59:59Z",
      "2026-03-31T09:00:00Z",
      "2027-06-14T05:00:00Z",
    ]) {
      const now = new Date(iso)
      const { start, end } = computeFreePeriodWindow(anchor, now)
      expect(start.getTime()).toBeLessThanOrEqual(now.getTime())
      expect(end.getTime()).toBeGreaterThan(now.getTime())
    }
  })

  it("clamps the anchor day in shorter months", () => {
    // A 31st anchor has no equivalent in February; date-fns clamps to the 28th.
    const anchor = new Date("2026-01-31T00:00:00Z")
    const now = new Date("2026-02-10T00:00:00Z")
    const { start, end } = computeFreePeriodWindow(anchor, now)
    expect(start.toISOString()).toBe("2026-01-31T00:00:00.000Z")
    expect(end.toISOString()).toBe("2026-02-28T00:00:00.000Z")
  })

  it("treats now == anchor as the start of the first window", () => {
    const anchor = new Date("2026-05-05T10:00:00Z")
    const { start, end } = computeFreePeriodWindow(anchor, anchor)
    expect(start.toISOString()).toBe(anchor.toISOString())
    expect(end.toISOString()).toBe("2026-06-05T10:00:00.000Z")
  })
})
