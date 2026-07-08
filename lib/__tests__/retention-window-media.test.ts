import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { SceneCueScanResult } from "@/lib/media/scene-detection"
import {
  buildChunkTimestamps,
  buildSnapshotTimestampsFromSceneCues,
  collapseClusteredCuts,
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

  it("snaps interior samples to a global grid, not to the window's start", () => {
    // A window starting off the grid keeps its own start/end but its interior
    // samples land on global 5s gridlines (10,15,…,45), not 7.4-relative ones
    // (12.4,17.4,…). This is what lets it share those seconds with an
    // overlapping window that also falls back to the grid.
    expect(buildChunkTimestamps(7.375, 47.375)).toEqual([
      7.375, 10, 15, 20, 25, 30, 35, 40, 45, 47.375,
    ])
  })

  it("overlapping windows share their interior gridlines in the shared span", () => {
    const hook = buildChunkTimestamps(0, 30)
    const dropOff = buildChunkTimestamps(7.375, 47.375)
    const shared = hook.filter((t) => dropOff.includes(t))
    // Everything the hook samples from 10s on is shared with the drop-off,
    // so the extraction frame cache grabs each of those seconds once.
    expect(shared).toEqual([10, 15, 20, 25, 30])
  })

  it("honours a coarser step for a confirmed-static window", () => {
    expect(buildChunkTimestamps(0, 30, 15)).toEqual([0, 15, 30])
  })

  it("returns a single point for a degenerate (zero-length) window", () => {
    expect(buildChunkTimestamps(10, 10)).toEqual([10])
  })
})

function emptyCues(): SceneCueScanResult {
  return { cuts: [], freezes: [], blacks: [] }
}

describe("buildSnapshotTimestampsFromSceneCues", () => {
  it("samples a single frame at the window start when the scan confirmed no cuts", () => {
    // A confirmed-static shot never visually changes, so one frame from the
    // start of the window is enough — no grid of near-duplicates.
    expect(buildSnapshotTimestampsFromSceneCues(0, 30, emptyCues())).toEqual([0])
    // The lone frame tracks the window's actual start, not a global gridline.
    expect(
      buildSnapshotTimestampsFromSceneCues(7.375, 47.375, emptyCues()),
    ).toEqual([7.375])
  })

  it("falls back to the dense grid when the scan failed (content unknown)", () => {
    // A window whose scan errored keeps the dense hedge grid rather than
    // trusting a single frame for content the scan never actually inspected.
    expect(
      buildSnapshotTimestampsFromSceneCues(0, 30, emptyCues(), true),
    ).toEqual(buildChunkTimestamps(0, 30))
  })

  it("ignores the no-cut fallback once real cuts exist", () => {
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 15 }],
      freezes: [],
      blacks: [],
    }
    // The no-cut fallback only governs the cut-less path; a detected cut still
    // yields its flanking pair regardless of the scanFailed flag.
    expect(buildSnapshotTimestampsFromSceneCues(0, 30, cues, true)).toEqual([
      14, 16,
    ])
  })

  it("places a flanking pair just before and after each detected cut", () => {
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 15 }],
      freezes: [],
      blacks: [],
    }

    expect(buildSnapshotTimestampsFromSceneCues(0, 30, cues)).toEqual([14, 16])
  })

  it("clamps segment frames to the window's own bounds", () => {
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 0.5 }, { atSeconds: 29.5 }],
      freezes: [],
      blacks: [],
    }

    // Leading frame 0.5-1 clamps up to the window start (0), the trailing
    // 29.5+1 clamps down to the end (30); the interior segment between the two
    // cuts is sampled once at 0.5+1 => 1.5.
    expect(buildSnapshotTimestampsFromSceneCues(0, 30, cues)).toEqual([
      0, 1.5, 30,
    ])
  })

  it("samples each scene segment once instead of double-sampling the middle", () => {
    // The reported case: two sequential cuts (facecam -> screen -> facecam)
    // carve the window into three segments. Flanking every cut would yield four
    // frames — 6, 8 and 22, 24 — but 8 and 22 both sit inside the same middle
    // (screen) segment, a near-duplicate pair. One frame per segment keeps the
    // head frame (6), the middle screen frame (8), and the trailing facecam
    // frame (24): three snapshots, not four.
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 7 }, { atSeconds: 23 }],
      freezes: [],
      blacks: [],
    }

    expect(buildSnapshotTimestampsFromSceneCues(0, 30, cues)).toEqual([
      6, 8, 24,
    ])
  })

  it("collapses a sub-2s cluster of cuts into a single flanking pair", () => {
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 10 }, { atSeconds: 11.5 }],
      freezes: [],
      blacks: [],
    }

    // The two cuts sit 1.5s apart, below the 2s cluster separation, so the
    // second is discarded as part of the first's cluster: only 10±1 => [9, 11]
    // survives instead of four frames straddling a transition that (on a static
    // shot) usually never happened.
    expect(buildSnapshotTimestampsFromSceneCues(0, 30, cues)).toEqual([9, 11])
  })

  it("collapses the over-detected talking-head burst to two frames", () => {
    // The reported case: a static talking head where the subject's own motion
    // tripped cuts at 49 and 50, yielding four near-duplicate frames. Clustering
    // keeps one cut, so the window samples one flanking pair, not a per-second
    // grid.
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 49 }, { atSeconds: 50 }],
      freezes: [],
      blacks: [],
    }

    expect(buildSnapshotTimestampsFromSceneCues(45, 55, cues)).toEqual([48, 50])
  })

  it("keeps cuts spaced at least the cluster separation apart", () => {
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 10 }, { atSeconds: 12 }],
      freezes: [],
      blacks: [],
    }

    // Exactly 2s apart, so both survive clustering: a leading frame at 10-1=9,
    // then one per cut at 10+1=11 and 12+1=13 — one frame for each of the three
    // segments the two cuts carve out.
    expect(buildSnapshotTimestampsFromSceneCues(0, 30, cues)).toEqual([
      9, 11, 13,
    ])
  })

  it("sorts before clustering so out-of-order cuts still collapse", () => {
    const cues: SceneCueScanResult = {
      cuts: [{ atSeconds: 50 }, { atSeconds: 49 }],
      freezes: [],
      blacks: [],
    }

    expect(buildSnapshotTimestampsFromSceneCues(45, 55, cues)).toEqual([48, 50])
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

describe("collapseClusteredCuts", () => {
  it("keeps a single cut and passes through well-spaced cuts unchanged", () => {
    expect(collapseClusteredCuts([{ atSeconds: 12 }])).toEqual([{ atSeconds: 12 }])
    expect(
      collapseClusteredCuts([{ atSeconds: 0 }, { atSeconds: 5 }, { atSeconds: 12 }]),
    ).toEqual([{ atSeconds: 0 }, { atSeconds: 5 }, { atSeconds: 12 }])
  })

  it("drops every cut within the separation of the last kept one", () => {
    expect(
      collapseClusteredCuts([
        { atSeconds: 10 },
        { atSeconds: 10.5 },
        { atSeconds: 11 },
      ]),
    ).toEqual([{ atSeconds: 10 }])
  })

  it("measures separation from the last kept cut, not the previous input", () => {
    // A steady 1s-apart run: 0 kept, 1 dropped (<2 from 0), 2 kept (>=2 from 0),
    // 3 dropped (<2 from 2), 4 kept — thinned to a spread, not collapsed to one.
    expect(
      collapseClusteredCuts([
        { atSeconds: 0 },
        { atSeconds: 1 },
        { atSeconds: 2 },
        { atSeconds: 3 },
        { atSeconds: 4 },
      ]),
    ).toEqual([{ atSeconds: 0 }, { atSeconds: 2 }, { atSeconds: 4 }])
  })

  it("returns an empty array for no cuts", () => {
    expect(collapseClusteredCuts([])).toEqual([])
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
