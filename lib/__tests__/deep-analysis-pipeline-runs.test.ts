import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  abandonInFlightDeepAnalysisPipelineRun,
  DeepAnalysisPipelineSupersededError,
  finishDeepAnalysisPipelineRun,
  runObservedPipelineStage,
} from "@/lib/deep-analysis-pipeline-runs"

interface RecordedUpdate {
  payload: Record<string, unknown>
  filters: Record<string, unknown>
}

// A tiny fake of the query builder for the two shapes this module issues:
// `from(table).update(payload).eq(col, val)[.eq(...)][.select(...)]`, either
// awaited directly or resolved via `.then(...)` (the fire-and-forget
// heartbeat), and `from(table).select(cols).eq(col, val).maybeSingle()` (the
// lease-ownership check). Every update is recorded so a test can assert what
// was written and how it was scoped; `leaseStatus` drives what the ownership
// check sees.
function makeFakeAdmin(
  {
    leaseStatus = "running",
    leaseReadError = false,
  }: { leaseStatus?: string | null; leaseReadError?: boolean } = {},
): {
  admin: SupabaseClient
  updates: RecordedUpdate[]
} {
  const updates: RecordedUpdate[] = []
  const admin = {
    from() {
      return {
        update(payload: Record<string, unknown>) {
          const record: RecordedUpdate = { payload, filters: {} }
          updates.push(record)
          // Updates that ask for rows back get one, so the superseded-run
          // guard in finishDeepAnalysisPipelineRun reads as "still mine".
          const result = { data: [{ id: "run-1" }], error: null }
          const builder = {
            eq(col: string, val: unknown) {
              record.filters[col] = val
              return builder
            },
            select() {
              return builder
            },
            then(
              onFulfilled: (v: typeof result) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) {
              return Promise.resolve(result).then(onFulfilled, onRejected)
            },
          }
          return builder
        },
        select() {
          const builder = {
            eq() {
              return builder
            },
            maybeSingle() {
              if (leaseReadError) {
                return Promise.resolve({
                  data: null,
                  error: { message: "connection reset" },
                })
              }
              return Promise.resolve({
                data: leaseStatus == null ? null : { status: leaseStatus },
                error: null,
              })
            },
          }
          return builder
        },
      }
    },
  } as unknown as SupabaseClient
  return { admin, updates }
}

describe("runObservedPipelineStage", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("heartbeats the lease while a long stage runs, then stops once it settles", async () => {
    const { admin, updates } = makeFakeAdmin()
    const run = { id: "run-1", stages: {} }

    let releaseTask: () => void = () => {}
    const task = () =>
      new Promise<void>((resolve) => {
        releaseTask = resolve
      })

    const stagePromise = runObservedPipelineStage(admin, run, "extraction", task)

    // Let the initial "stage started" write flush.
    await Promise.resolve()
    const beatsBefore = updates.filter(
      (u) => u.filters.status === "running",
    ).length

    // Two heartbeat intervals pass while the task is still in flight.
    await vi.advanceTimersByTimeAsync(30 * 1000)
    await vi.advanceTimersByTimeAsync(30 * 1000)

    const heartbeats = updates.filter((u) => u.filters.status === "running")
    expect(heartbeats.length - beatsBefore).toBe(2)
    // A heartbeat only bumps updated_at, scoped to the still-running row.
    expect(heartbeats[heartbeats.length - 1]).toMatchObject({
      payload: { updated_at: expect.any(String) },
      filters: { id: "run-1", status: "running" },
    })

    releaseTask()
    await stagePromise

    // Once the stage settled, the heartbeat stops firing.
    const beatsAtSettle = updates.filter(
      (u) => u.filters.status === "running",
    ).length
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(
      updates.filter((u) => u.filters.status === "running").length,
    ).toBe(beatsAtSettle)
  })

  it("stops heartbeating even when the stage throws", async () => {
    const { admin, updates } = makeFakeAdmin()
    const run = { id: "run-1", stages: {} }

    await expect(
      runObservedPipelineStage(admin, run, "extraction", () =>
        Promise.reject(new Error("boom")),
      ),
    ).rejects.toThrow("boom")

    const beatsAtSettle = updates.filter(
      (u) => u.filters.status === "running",
    ).length
    await vi.advanceTimersByTimeAsync(90 * 1000)
    expect(
      updates.filter((u) => u.filters.status === "running").length,
    ).toBe(beatsAtSettle)
  })
})

describe("runObservedPipelineStage lease ownership", () => {
  it("refuses to start a stage once the run has lost its lease", async () => {
    // 'failed' is what a manual retry's abandon leaves behind.
    const { admin, updates } = makeFakeAdmin({ leaseStatus: "failed" })
    const run = { id: "run-1", stages: {} }
    const task = vi.fn(async () => {})

    await expect(
      runObservedPipelineStage(admin, run, "event_synthesis", task),
    ).rejects.toBeInstanceOf(DeepAnalysisPipelineSupersededError)

    // The superseded run must neither do the work nor touch the row that now
    // belongs to whoever took the lease.
    expect(task).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it("runs the stage normally while the lease is still held", async () => {
    const { admin } = makeFakeAdmin({ leaseStatus: "running" })
    const run = { id: "run-1", stages: {} }
    const task = vi.fn(async () => {})

    await runObservedPipelineStage(admin, run, "extraction", task)

    expect(task).toHaveBeenCalledTimes(1)
    expect(run.stages).toMatchObject({ extraction: { status: "ready" } })
  })

  it("keeps working when the ownership read itself errors", async () => {
    // A transient DB failure tells us nothing about ownership, and aborting a
    // healthy pipeline on one is worse than the overlap it would prevent.
    const { admin } = makeFakeAdmin({ leaseReadError: true })
    const run = { id: "run-1", stages: {} }
    const task = vi.fn(async () => {})

    await runObservedPipelineStage(admin, run, "extraction", task)

    expect(task).toHaveBeenCalledTimes(1)
  })
})

describe("finishDeepAnalysisPipelineRun", () => {
  it("scopes its write to a still-running row so an abandoned run can't resurrect itself", async () => {
    const { admin, updates } = makeFakeAdmin()

    await finishDeepAnalysisPipelineRun(admin, { id: "run-1", stages: {} }, {
      status: "ready",
    })

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      payload: { status: "ready" },
      filters: { id: "run-1", status: "running" },
    })
  })
})

describe("abandonInFlightDeepAnalysisPipelineRun", () => {
  it("fails only the video's running run so the next claim can start fresh", async () => {
    const { admin, updates } = makeFakeAdmin()

    await abandonInFlightDeepAnalysisPipelineRun(admin, "av-1")

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      payload: { status: "failed" },
      filters: { analysed_video_id: "av-1", status: "running" },
    })
  })
})
