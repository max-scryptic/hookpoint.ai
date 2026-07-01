import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildChunkTimestamps,
  createPendingRetentionWindowMedia,
} from "@/lib/retention-window-media"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"

describe("buildChunkTimestamps", () => {
  it("splits the hook's 0-30s window into 5s chunks, per spec", () => {
    expect(buildChunkTimestamps(0, 30)).toEqual([0, 5, 10, 15, 20, 25, 30])
  })

  it("steps from an arbitrary start and always includes the exact end", () => {
    expect(buildChunkTimestamps(15, 55)).toEqual([
      15, 20, 25, 30, 35, 40, 45, 50, 55,
    ])
  })

  it("adds a shorter final gap when the span isn't a multiple of the step", () => {
    expect(buildChunkTimestamps(0, 12)).toEqual([0, 5, 10, 12])
  })

  it("returns a single point for a degenerate (zero-length) window", () => {
    expect(buildChunkTimestamps(10, 10)).toEqual([10])
  })
})

// A minimal chainable fake of the Supabase query builder, just enough to
// capture what createPendingRetentionWindowMedia writes to each table.
function makeFakeSupabase() {
  const upserts: Record<string, Record<string, unknown>[]> = {}
  const deletes: { table: string; retentionWindowId?: string; ids?: string[] }[] =
    []

  const supabase = {
    from(table: string) {
      let pendingDeleteWindowId: string | undefined
      const builder: Record<string, unknown> = {
        upsert: (rows: Record<string, unknown>[]) => {
          upserts[table] = rows
          return Promise.resolve({ data: rows, error: null })
        },
        delete: () => builder,
        eq: (column: string, value: string) => {
          if (column === "retention_window_id") pendingDeleteWindowId = value
          return builder
        },
        gte: () => {
          deletes.push({ table, retentionWindowId: pendingDeleteWindowId })
          return Promise.resolve({ error: null })
        },
        in: (_column: string, ids: string[]) => {
          deletes.push({ table, ids })
          return Promise.resolve({ error: null })
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, upserts, deletes }
}

function makeWindow(
  overrides: Partial<PersistedRetentionWindow> = {},
): PersistedRetentionWindow {
  return {
    id: "rw-1",
    kind: "hook",
    windowIndex: 0,
    windowKey: "initial-hook",
    label: "Initial Hook",
    fromSeconds: 0,
    toSeconds: 10,
    startWatchRatio: 1,
    endWatchRatio: 0.8,
    delta: -0.2,
    relativePerformance: null,
    steepness: null,
    isAbnormallySteep: null,
    outOfRange: false,
    analysisFromSeconds: 0,
    analysisToSeconds: 30,
    ...overrides,
  }
}

describe("createPendingRetentionWindowMedia", () => {
  it("creates one snapshot row per chunk timestamp and one audio row per window", async () => {
    const { supabase, upserts } = makeFakeSupabase()
    const window = makeWindow()

    await createPendingRetentionWindowMedia(supabase, "user-1", "av-1", [
      window,
    ])

    const snapshots = upserts["retention_window_snapshots"]
    expect(snapshots).toHaveLength(7) // 0,5,10,...,30
    expect(snapshots[0]).toMatchObject({
      retention_window_id: "rw-1",
      chunk_index: 0,
      timestamp_seconds: 0,
      status: "pending",
    })
    expect(snapshots[6]).toMatchObject({
      chunk_index: 6,
      timestamp_seconds: 30,
    })

    const audio = upserts["retention_window_audio"]
    expect(audio).toHaveLength(1)
    expect(audio[0]).toMatchObject({
      retention_window_id: "rw-1",
      from_seconds: 0,
      to_seconds: 30,
      status: "pending",
    })
  })

  it("skips windows with no analysis window (e.g. hook-delivery)", async () => {
    const { supabase, upserts } = makeFakeSupabase()
    const window = makeWindow({
      id: "rw-2",
      windowIndex: 1,
      windowKey: "hook-delivery",
      analysisFromSeconds: null,
      analysisToSeconds: null,
    })

    await createPendingRetentionWindowMedia(supabase, "user-1", "av-1", [
      window,
    ])

    expect(upserts["retention_window_snapshots"]).toBeUndefined()
    expect(upserts["retention_window_audio"]).toBeUndefined()
  })
})
