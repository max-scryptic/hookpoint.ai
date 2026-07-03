import { describe, expect, it } from "vitest"

import { runWithConcurrency } from "@/lib/concurrency"

describe("runWithConcurrency", () => {
  it("runs every item exactly once", async () => {
    const seen: number[] = []
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it("never runs more than `limit` calls at once", async () => {
    let active = 0
    let maxActive = 0
    const items = Array.from({ length: 10 }, (_, i) => i)

    await runWithConcurrency(items, 3, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
    })

    expect(maxActive).toBeLessThanOrEqual(3)
    expect(maxActive).toBeGreaterThan(1)
  })

  it("does nothing for an empty list", async () => {
    let calls = 0
    await runWithConcurrency([], 4, async () => {
      calls++
    })
    expect(calls).toBe(0)
  })

  it("clamps the worker pool to the item count", async () => {
    let active = 0
    let maxActive = 0
    await runWithConcurrency([1, 2], 10, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
    })
    expect(maxActive).toBe(2)
  })

  it("lets one slow item's work overlap with the rest instead of blocking them", async () => {
    const order: string[] = []
    await runWithConcurrency(["slow", "fast", "fast"], 3, async (item) => {
      const delay = item === "slow" ? 20 : 1
      await new Promise((resolve) => setTimeout(resolve, delay))
      order.push(item)
    })
    expect(order.slice(0, 2)).toEqual(["fast", "fast"])
    expect(order[2]).toBe("slow")
  })
})
