import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { SceneCueScanResult } from "@/lib/media/scene-detection"
import {
  buildChunkTimestamps,
  buildSnapshotTimestampsFromSceneCues,
  createPendingRetentionWindowAudio,
  createRetentionWindowSnapshotsFromSceneCues,
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

function emptyCues(): SceneCueScanResult {
  return { cuts: [], freezes: [], blacks: [] }
}

describe("buildSnapshotTimestampsFromSceneCues", () => {
  it("falls back to the fixed grid when the window has no detected cuts", () => {
    expect(buildSnapshotTimestampsFromSceneCues(0, 30, emptyCues())).toEqual(
      buildChunkTimestamps(0, 30),
    )
  })

  it("places a flanking pair just before and after each detected cut", () => {
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 15 }],
      freezes: [],
      blacks: [],
    }

    expect(buildSnapshotTimestampsFromSceneCues(0, 30, cues)).toEqual([14, 16])
  })

  it("clamps flanking offsets to the window's own bounds", () => {
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 0.5 }, { atSeconds: 29.5 }],
      freezes: [],
      blacks: [],
    }

    expect(buildSnapshotTimestampsFromSceneCues(0, 30, cues)).toEqual([
      0, 1.5, 28.5, 30,
    ])
  })

  it("de-duplicates overlapping flanking pairs from adjacent cuts", () => {
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 10 }, { atSeconds: 11.5 }],
      freezes: [],
      blacks: [],
    }

    // 10±1 => [9, 11]; 11.5±1 => [10.5, 12.5]; none of these coincide, so all
    // four survive — this just documents dedup happens on exact overlaps.
    expect(buildSnapshotTimestampsFromSceneCues(0, 30, cues)).toEqual([
      9, 10.5, 11, 12.5,
    ])
  })

  it("caps the result and spreads it evenly across a high cut-rate window", () => {
    const cuts = Array.from({ length: 20 }, (_, i) => ({ atSeconds: i * 2 + 1 }))
    const timestamps = buildSnapshotTimestampsFromSceneCues(0, 40, {
      cuts,
      freezes: [],
      blacks: [],
    })

    expect(timestamps.length).toBeLessThanOrEqual(12)
    expect(timestamps[0]).toBeLessThan(5)
    expect(timestamps[timestamps.length - 1]).toBeGreaterThan(35)
    // Strictly ascending, no duplicates from the subsampling itself.
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1])
    }
  })
})

// A minimal chainable fake of the Supabase query builder, just enough to
// capture what these functions write to each table.
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

describe("createPendingRetentionWindowAudio", () => {
  it("creates one audio row per window with an analysis window", async () => {
    const { supabase, upserts } = makeFakeSupabase()
    const window = makeWindow()

    await createPendingRetentionWindowAudio(supabase, "user-1", "av-1", [
      window,
    ])

    expect(upserts["retention_window_snapshots"]).toBeUndefined()
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

    await createPendingRetentionWindowAudio(supabase, "user-1", "av-1", [
      window,
    ])

    expect(upserts["retention_window_audio"]).toBeUndefined()
  })
})

describe("createRetentionWindowSnapshotsFromSceneCues", () => {
  it("creates one snapshot row per derived timestamp and prunes stale trailing rows", async () => {
    const { supabase, upserts, deletes } = makeFakeSupabase()

    await createRetentionWindowSnapshotsFromSceneCues(
      supabase,
      "user-1",
      "av-1",
      "rw-1",
      0,
      30,
      { cuts: [{ atSeconds: 15 }], freezes: [], blacks: [] },
    )

    const snapshots = upserts["retention_window_snapshots"]
    expect(snapshots).toEqual([
      expect.objectContaining({
        retention_window_id: "rw-1",
        chunk_index: 0,
        timestamp_seconds: 14,
        status: "pending",
      }),
      expect.objectContaining({
        retention_window_id: "rw-1",
        chunk_index: 1,
        timestamp_seconds: 16,
        status: "pending",
      }),
    ])
    expect(deletes).toContainEqual(
      expect.objectContaining({
        table: "retention_window_snapshots",
        retentionWindowId: "rw-1",
      }),
    )
  })
})
