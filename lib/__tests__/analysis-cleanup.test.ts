import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

// Billing is stubbed so these tests stay on the one rule that matters here: the
// analysis only goes back into the allowance when the analysis itself went away.
const refundUsage = vi.fn(async () => {})

vi.mock("@/lib/billing/entitlements", () => ({
  refundUsage: (...args: unknown[]) =>
    (refundUsage as unknown as (...a: unknown[]) => Promise<void>)(...args),
}))

const { createAnalysisRunRecord, rollBackAnalysis } = await import(
  "@/lib/analysis-cleanup"
)

const periodStart = new Date("2026-08-01T00:00:00.000Z")

interface DeleteCall {
  table: string
  filters: Record<string, unknown>
}

// Fake of the delete this module issues: `from(t).delete().eq().eq().select()`,
// resolving to the rows it removed.
function makeSupabase(deleted: Array<{ id: string }>): {
  supabase: SupabaseClient
  calls: DeleteCall[]
} {
  const calls: DeleteCall[] = []

  const supabase = {
    from(table: string) {
      return {
        delete() {
          const call: DeleteCall = { table, filters: {} }
          calls.push(call)
          const chain = {
            eq(column: string, value: unknown) {
              call.filters[column] = value
              return chain
            },
            select() {
              return Promise.resolve({ data: deleted, error: null })
            },
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

describe("rollBackAnalysis", () => {
  it("deletes the analysis the run created and puts the charge back", async () => {
    const { supabase, calls } = makeSupabase([{ id: "analysed-1" }])
    const run = createAnalysisRunRecord()
    run.createdAnalysedVideoId = "analysed-1"
    run.chargedPeriodStart = periodStart

    const rolledBack = await rollBackAnalysis(supabase, "user-1", run)

    expect(rolledBack).toBe(true)
    expect(calls[0]).toEqual({
      table: "analysed_videos",
      filters: { user_id: "user-1", id: "analysed-1" },
    })
    expect(refundUsage).toHaveBeenCalledWith("user-1", periodStart, {
      videoAnalyses: 1,
    })
    // A rollback that has already happened has nothing left to undo, so a second
    // attempt cannot delete or refund twice.
    expect(run.createdAnalysedVideoId).toBeNull()
    expect(run.chargedPeriodStart).toBeNull()
  })

  // A run served from a stored analysis creates nothing and charges nothing, so
  // walking away from one has nothing to undo. Re-opening a video must never
  // delete the analysis it was reading.
  it("does nothing when the run created nothing", async () => {
    const { supabase, calls } = makeSupabase([{ id: "analysed-1" }])

    const rolledBack = await rollBackAnalysis(
      supabase,
      "user-1",
      createAnalysisRunRecord(),
    )

    expect(rolledBack).toBe(false)
    expect(calls).toEqual([])
    expect(refundUsage).not.toHaveBeenCalled()
  })

  it("refunds nothing when the analysis is already gone", async () => {
    const { supabase } = makeSupabase([])
    const run = createAnalysisRunRecord()
    run.createdAnalysedVideoId = "analysed-1"
    run.chargedPeriodStart = periodStart

    const rolledBack = await rollBackAnalysis(supabase, "user-1", run)

    expect(rolledBack).toBe(false)
    expect(refundUsage).not.toHaveBeenCalled()
  })

  it("still deletes when the run was never charged", async () => {
    const { supabase } = makeSupabase([{ id: "analysed-1" }])
    const run = createAnalysisRunRecord()
    run.createdAnalysedVideoId = "analysed-1"

    const rolledBack = await rollBackAnalysis(supabase, "user-1", run)

    expect(rolledBack).toBe(true)
    expect(refundUsage).not.toHaveBeenCalled()
  })
})
