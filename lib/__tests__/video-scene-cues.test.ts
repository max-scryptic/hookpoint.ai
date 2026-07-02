import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { PersistedRetentionWindow } from "@/lib/retention-windows"
import {
  computeAverageSceneCueMetrics,
  computeSceneCueMetrics,
  createPendingRetentionWindowSceneCueScans,
  getPendingRetentionWindowSceneCueScans,
  replaceRetentionWindowSceneCues,
  updateRetentionWindowSceneCueScanStatus,
  type VideoSceneCue,
} from "@/lib/video-scene-cues"

function cue(overrides: Partial<VideoSceneCue>): VideoSceneCue {
  return {
    id: "cue-1",
    kind: "cut",
    fromSeconds: 0,
    toSeconds: 0,
    score: null,
    ...overrides,
  }
}

describe("computeSceneCueMetrics", () => {
  it("counts only cuts whose timestamp falls inside the range", () => {
    const cues = [
      cue({ kind: "cut", fromSeconds: 5, toSeconds: 5 }),
      cue({ kind: "cut", fromSeconds: 15, toSeconds: 15 }),
      cue({ kind: "cut", fromSeconds: 25, toSeconds: 25 }),
    ]

    expect(computeSceneCueMetrics(cues, 10, 20).cutCount).toBe(1)
  })

  it("derives cuts per minute from the range's duration", () => {
    const cues = [
      cue({ kind: "cut", fromSeconds: 5, toSeconds: 5 }),
      cue({ kind: "cut", fromSeconds: 10, toSeconds: 10 }),
      cue({ kind: "cut", fromSeconds: 15, toSeconds: 15 }),
    ]

    expect(computeSceneCueMetrics(cues, 0, 30).cutsPerMinute).toBe(6)
  })

  it("returns null cuts-per-minute for a zero-length range", () => {
    expect(computeSceneCueMetrics([], 10, 10).cutsPerMinute).toBeNull()
  })

  it("clips freeze/black spans that extend past the range when summing coverage", () => {
    const cues = [
      cue({ kind: "freeze", fromSeconds: -5, toSeconds: 5 }),
      cue({ kind: "black", fromSeconds: 8, toSeconds: 100 }),
    ]

    const metrics = computeSceneCueMetrics(cues, 0, 10)
    expect(metrics.freezeCoverage).toBeCloseTo(0.5)
    expect(metrics.blackCoverage).toBeCloseTo(0.2)
  })

  it("ignores cues outside the range entirely", () => {
    const cues = [cue({ kind: "freeze", fromSeconds: 100, toSeconds: 110 })]
    expect(computeSceneCueMetrics(cues, 0, 30).freezeCoverage).toBe(0)
  })
})

describe("computeAverageSceneCueMetrics", () => {
  it("returns null when no windows have been scanned yet", () => {
    expect(computeAverageSceneCueMetrics([], [])).toBeNull()
  })

  it("averages cuts-per-minute and coverage across the scanned windows", () => {
    const cues = [
      // Window A: 30s span, 1 cut => 2 cuts/min.
      cue({ kind: "cut", fromSeconds: 10, toSeconds: 10 }),
      // Window B: 30s span, 3 cuts => 6 cuts/min.
      cue({ kind: "cut", fromSeconds: 105, toSeconds: 105 }),
      cue({ kind: "cut", fromSeconds: 110, toSeconds: 110 }),
      cue({ kind: "cut", fromSeconds: 115, toSeconds: 115 }),
    ]
    const windows = [
      { fromSeconds: 0, toSeconds: 30 },
      { fromSeconds: 100, toSeconds: 130 },
    ]

    const metrics = computeAverageSceneCueMetrics(cues, windows)
    expect(metrics?.cutsPerMinute).toBeCloseTo(4)
    expect(metrics?.cutCount).toBe(4)
  })
})

// A minimal chainable fake of the Supabase query builder, covering the
// upsert/delete shape createPendingRetentionWindowSceneCueScans issues and
// the select/update/insert shapes the read/write helpers below it issue.
function makeFakeSupabase(seedRows: Record<string, unknown>[] = []) {
  const upserts: Record<string, Record<string, unknown>[]> = {}
  const inserts: Record<string, Record<string, unknown>[]> = {}
  const updates: { table: string; id?: string; payload: Record<string, unknown> }[] =
    []
  const deletes: { table: string; retentionWindowId?: string; ids?: string[] }[] =
    []

  const supabase = {
    from(table: string) {
      let pendingId: string | undefined
      let pendingWindowId: string | undefined
      const builder: Record<string, unknown> = {
        upsert: (rows: Record<string, unknown>[]) => {
          upserts[table] = rows
          return Promise.resolve({ data: rows, error: null })
        },
        insert: (rows: Record<string, unknown>[]) => {
          inserts[table] = rows
          return Promise.resolve({ error: null })
        },
        update: (payload: Record<string, unknown>) => {
          builder._payload = payload
          return builder
        },
        delete: () => builder,
        select: () => {
          builder._select = true
          return builder
        },
        order: () => builder,
        eq: (column: string, value: string) => {
          if (column === "id") pendingId = value
          if (column === "retention_window_id") pendingWindowId = value
          return builder
        },
        gte: () => {
          deletes.push({ table, retentionWindowId: pendingWindowId })
          return Promise.resolve({ error: null })
        },
        in: (_column: string, ids: string[]) => {
          deletes.push({ table, ids })
          return Promise.resolve({ error: null })
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (builder._payload) {
            updates.push({
              table,
              id: pendingId,
              payload: builder._payload as Record<string, unknown>,
            })
            return Promise.resolve({ error: null }).then(resolve)
          }
          // A bare delete (no upsert/update payload, no gte/in terminator hit)
          // — used by replaceRetentionWindowSceneCues' clear step.
          if (!builder._select) {
            deletes.push({ table, retentionWindowId: pendingWindowId })
          }
          return Promise.resolve({ data: seedRows, error: null }).then(resolve)
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, upserts, inserts, updates, deletes }
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

describe("createPendingRetentionWindowSceneCueScans", () => {
  it("creates one pending scan row per window with an analysis window", async () => {
    const { supabase, upserts } = makeFakeSupabase()

    await createPendingRetentionWindowSceneCueScans(supabase, "user-1", "av-1", [
      makeWindow(),
    ])

    const rows = upserts["retention_window_scene_cue_scans"]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      retention_window_id: "rw-1",
      from_seconds: 0,
      to_seconds: 30,
      status: "pending",
    })
  })

  it("skips windows with no analysis window", async () => {
    const { supabase, upserts } = makeFakeSupabase()
    const window = makeWindow({
      analysisFromSeconds: null,
      analysisToSeconds: null,
    })

    await createPendingRetentionWindowSceneCueScans(supabase, "user-1", "av-1", [
      window,
    ])

    expect(upserts["retention_window_scene_cue_scans"]).toBeUndefined()
  })
})

describe("getPendingRetentionWindowSceneCueScans", () => {
  it("maps pending rows to their camelCase shape", async () => {
    const { supabase } = makeFakeSupabase([
      {
        id: "scan-1",
        retention_window_id: "rw-1",
        from_seconds: 0,
        to_seconds: 30,
        status: "pending",
        error: null,
      },
    ])

    const scans = await getPendingRetentionWindowSceneCueScans(
      supabase,
      "user-1",
      "av-1",
    )

    expect(scans).toEqual([
      {
        id: "scan-1",
        retentionWindowId: "rw-1",
        fromSeconds: 0,
        toSeconds: 30,
        status: "pending",
        error: null,
      },
    ])
  })
})

describe("updateRetentionWindowSceneCueScanStatus", () => {
  it("clears any prior error when marking a scan ready", async () => {
    const { supabase, updates } = makeFakeSupabase()

    await updateRetentionWindowSceneCueScanStatus(supabase, "user-1", "scan-1", {
      status: "ready",
    })

    expect(updates).toContainEqual({
      table: "retention_window_scene_cue_scans",
      id: "scan-1",
      payload: { status: "ready", error: null },
    })
  })

  it("records the error message when marking a scan failed", async () => {
    const { supabase, updates } = makeFakeSupabase()

    await updateRetentionWindowSceneCueScanStatus(supabase, "user-1", "scan-1", {
      status: "failed",
      error: "ffmpeg timed out",
    })

    expect(updates).toContainEqual({
      table: "retention_window_scene_cue_scans",
      id: "scan-1",
      payload: { status: "failed", error: "ffmpeg timed out" },
    })
  })
})

describe("replaceRetentionWindowSceneCues", () => {
  it("clears the window's previous cues and inserts the freshly-scanned set", async () => {
    const { supabase, inserts, deletes } = makeFakeSupabase()

    await replaceRetentionWindowSceneCues(supabase, "user-1", "av-1", "rw-1", {
      cuts: [{ atSeconds: 12.3 }],
      freezes: [{ fromSeconds: 5, toSeconds: 7 }],
      blacks: [],
    })

    expect(deletes).toContainEqual({
      table: "video_scene_cues",
      retentionWindowId: "rw-1",
    })
    expect(inserts["video_scene_cues"]).toEqual([
      expect.objectContaining({
        retention_window_id: "rw-1",
        kind: "cut",
        from_seconds: 12.3,
        to_seconds: 12.3,
      }),
      expect.objectContaining({
        retention_window_id: "rw-1",
        kind: "freeze",
        from_seconds: 5,
        to_seconds: 7,
      }),
    ])
  })

  it("skips the insert when the scan found nothing", async () => {
    const { supabase, inserts } = makeFakeSupabase()

    await replaceRetentionWindowSceneCues(supabase, "user-1", "av-1", "rw-1", {
      cuts: [],
      freezes: [],
      blacks: [],
    })

    expect(inserts["video_scene_cues"]).toBeUndefined()
  })
})
