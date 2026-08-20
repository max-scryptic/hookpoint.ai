import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

// The billing side is stubbed so these tests can be about the one rule that
// matters here: credits only ever go back when a row actually went away.
const refundUsage = vi.fn(async () => {})
const periodStart = new Date("2026-08-01T00:00:00.000Z")

vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlement: vi.fn(async () => ({ periodStart })),
  refundUsage: (...args: unknown[]) =>
    (refundUsage as unknown as (...a: unknown[]) => Promise<void>)(...args),
}))

const {
  rollBackComparison,
  rollBackComparisonForPair,
  sweepAbandonedComparisons,
} = await import("@/lib/comparison-cleanup")
const { VIDEO_COMPARISON_CREDIT_COST } = await import("@/lib/plans")

interface DeleteCall {
  table: string
  filters: Array<{ op: string; column: string; value: unknown }>
}

// Fake of the one query shape these modules issue: a delete, narrowed by some
// mix of eq/gte/lt/is/or, finished with a select that returns the rows it
// removed. `deleted` is what the delete reports back.
function makeSupabase(deleted: Array<Record<string, unknown>>): {
  supabase: SupabaseClient
  calls: DeleteCall[]
} {
  const calls: DeleteCall[] = []

  const supabase = {
    from(table: string) {
      return {
        delete() {
          const call: DeleteCall = { table, filters: [] }
          calls.push(call)
          const chain = {
            eq: (column: string, value: unknown) => record("eq", column, value),
            gte: (column: string, value: unknown) =>
              record("gte", column, value),
            lt: (column: string, value: unknown) => record("lt", column, value),
            is: (column: string, value: unknown) => record("is", column, value),
            or: (value: unknown) => record("or", "or", value),
            select() {
              return Promise.resolve({ data: deleted, error: null })
            },
          }
          function record(op: string, column: string, value: unknown) {
            call.filters.push({ op, column, value })
            return chain
          }
          return chain
        },
      }
    },
  } as unknown as SupabaseClient

  return { supabase, calls }
}

beforeEach(() => {
  refundUsage.mockClear()
})

describe("rollBackComparison", () => {
  it("deletes the run's own row and hands its credits back", async () => {
    const { supabase, calls } = makeSupabase([{ id: "comparison-1" }])

    const rolledBack = await rollBackComparison(supabase, "user-1", "comparison-1", {
      at: new Date("2026-08-05T10:00:00.000Z"),
      credits: VIDEO_COMPARISON_CREDIT_COST,
    })

    expect(rolledBack).toBe(true)
    expect(calls[0].table).toBe("video_comparisons")
    expect(calls[0].filters).toEqual([
      { op: "eq", column: "id", value: "comparison-1" },
      { op: "eq", column: "user_id", value: "user-1" },
    ])
    expect(refundUsage).toHaveBeenCalledWith("user-1", periodStart, {
      deepCredits: VIDEO_COMPARISON_CREDIT_COST,
    })
  })

  // The same abandonment can be reported twice: the creator's browser says so on
  // its way out, and the generate endpoint notices the dropped connection. Only
  // the report that finds a row to delete may refund.
  it("refunds nothing when the row is already gone", async () => {
    const { supabase } = makeSupabase([])

    const rolledBack = await rollBackComparison(supabase, "user-1", "comparison-1", {
      at: new Date("2026-08-05T10:00:00.000Z"),
      credits: VIDEO_COMPARISON_CREDIT_COST,
    })

    expect(rolledBack).toBe(false)
    expect(refundUsage).not.toHaveBeenCalled()
  })

  it("still deletes, but refunds nothing, when the run never charged", async () => {
    const { supabase } = makeSupabase([{ id: "comparison-1" }])

    const rolledBack = await rollBackComparison(
      supabase,
      "user-1",
      "comparison-1",
      null,
    )

    expect(rolledBack).toBe(true)
    expect(refundUsage).not.toHaveBeenCalled()
  })

  // The free first comparison goes through this same rollback, and a run that
  // spent nothing must get nothing back. Refunding the flat cost for it would
  // mint credits: the row is deleted, so the next press is free again.
  it("hands back nothing for a run that was free", async () => {
    const { supabase } = makeSupabase([{ id: "comparison-1" }])

    const rolledBack = await rollBackComparison(
      supabase,
      "user-1",
      "comparison-1",
      { at: new Date("2026-08-05T10:00:00.000Z"), credits: 0 },
    )

    expect(rolledBack).toBe(true)
    expect(refundUsage).not.toHaveBeenCalled()
  })
})

describe("rollBackComparisonForPair", () => {
  // A pair generated (and paid for) previously is what the creator had before
  // they pressed the button, so re-opening one to finish a missing section must
  // never be undone by walking away. The created_at floor is what guarantees it.
  it("only takes a row this run created", async () => {
    const startedAt = new Date("2026-08-05T10:00:00.000Z")
    const { supabase, calls } = makeSupabase([{ id: "comparison-1" }])

    const rolledBack = await rollBackComparisonForPair(
      supabase,
      "user-1",
      "video-a",
      "video-b",
      startedAt,
    )

    expect(rolledBack).toBe(true)
    expect(calls[0].filters).toContainEqual({
      op: "gte",
      column: "created_at",
      value: startedAt.toISOString(),
    })
    // And only a row nothing was ever written onto, which is what keeps a
    // finished report safe when the two clocks disagree about when the run
    // started.
    expect(
      calls[0].filters
        .filter((filter) => filter.op === "is")
        .map((filter) => filter.column),
    ).toEqual(["script_report", "packaging_report", "retention_report"])
    expect(refundUsage).toHaveBeenCalledTimes(1)
  })

  // The browser reporting the abandonment was never told what the run cost, so
  // the price comes off the row that was deleted. A free first comparison
  // recorded a zero, and a zero refunds nothing.
  it("hands back what the deleted row recorded, including nothing", async () => {
    const { supabase } = makeSupabase([
      { id: "comparison-1", deep_credits_charged: 0 },
    ])

    const rolledBack = await rollBackComparisonForPair(
      supabase,
      "user-1",
      "video-a",
      "video-b",
      new Date("2026-08-05T10:00:00.000Z"),
    )

    expect(rolledBack).toBe(true)
    expect(refundUsage).not.toHaveBeenCalled()
  })

  // A row that recorded no price at all predates the column, and every one of
  // those was charged the flat cost.
  it("falls back to the flat cost for a row that recorded no price", async () => {
    const { supabase } = makeSupabase([{ id: "comparison-1" }])

    await rollBackComparisonForPair(
      supabase,
      "user-1",
      "video-a",
      "video-b",
      new Date("2026-08-05T10:00:00.000Z"),
    )

    expect(refundUsage).toHaveBeenCalledWith("user-1", periodStart, {
      deepCredits: VIDEO_COMPARISON_CREDIT_COST,
    })
  })

  it("leaves an older pair alone and refunds nothing", async () => {
    const { supabase } = makeSupabase([])

    const rolledBack = await rollBackComparisonForPair(
      supabase,
      "user-1",
      "video-a",
      "video-b",
      new Date("2026-08-05T10:00:00.000Z"),
    )

    expect(rolledBack).toBe(false)
    expect(refundUsage).not.toHaveBeenCalled()
  })
})

describe("sweepAbandonedComparisons", () => {
  it("clears rows with no written report and refunds each of them", async () => {
    const { supabase, calls } = makeSupabase([
      { id: "comparison-1", created_at: "2026-08-05T10:00:00.000Z" },
      { id: "comparison-2", created_at: "2026-08-06T10:00:00.000Z" },
    ])

    const swept = await sweepAbandonedComparisons(supabase, "user-1")

    expect(swept).toBe(2)
    // Only a row carrying none of the three written head-to-heads, and old
    // enough that no run could still be writing it, counts as abandoned.
    const columns = calls[0].filters
      .filter((filter) => filter.op === "is")
      .map((filter) => filter.column)
    expect(columns).toEqual([
      "script_report",
      "packaging_report",
      "retention_report",
    ])
    expect(
      calls[0].filters.some((filter) => filter.op === "lt"),
    ).toBe(true)
    expect(refundUsage).toHaveBeenCalledTimes(2)
  })

  // The sweep is the last thing to catch an abandoned run, so it too refunds
  // per row rather than a flat amount: a free comparison abandoned without
  // notice cost nothing and gives nothing back.
  it("refunds only the rows that were charged", async () => {
    const { supabase } = makeSupabase([
      {
        id: "comparison-1",
        created_at: "2026-08-05T10:00:00.000Z",
        deep_credits_charged: 0,
      },
      {
        id: "comparison-2",
        created_at: "2026-08-06T10:00:00.000Z",
        deep_credits_charged: VIDEO_COMPARISON_CREDIT_COST,
      },
    ])

    const swept = await sweepAbandonedComparisons(supabase, "user-1")

    expect(swept).toBe(2)
    expect(refundUsage).toHaveBeenCalledTimes(1)
    expect(refundUsage).toHaveBeenCalledWith("user-1", periodStart, {
      deepCredits: VIDEO_COMPARISON_CREDIT_COST,
    })
  })

  // A charge that landed in a usage window which has since rolled over is not
  // refundable: that window's tally no longer gates anything the creator can
  // spend, so crediting the current one would hand back credits twice over.
  it("does not refund a row charged in a window that has since rolled over", async () => {
    const { supabase } = makeSupabase([
      { id: "comparison-1", created_at: "2026-07-14T10:00:00.000Z" },
    ])

    const swept = await sweepAbandonedComparisons(supabase, "user-1")

    expect(swept).toBe(1)
    expect(refundUsage).not.toHaveBeenCalled()
  })
})
