import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { StorageProvider } from "@/lib/storage"

// The re-pend half of the reset is covered by each of these modules' own tests;
// stubbing them keeps this file on the one thing only the reset can get wrong —
// what survives the wipe.
vi.mock("@/lib/retention-window-media", () => ({
  createPendingRetentionWindowAudio: vi.fn(async () => {}),
}))
vi.mock("@/lib/video-scene-cues", () => ({
  createPendingRetentionWindowSceneCueScans: vi.fn(async () => {}),
}))
vi.mock("@/lib/retention-window-events", () => ({
  createPendingRetentionWindowEventSynthesis: vi.fn(async () => {}),
}))
vi.mock("@/lib/retention-window-transcripts", () => ({
  rependRetentionWindowTranscriptTaxonomies: vi.fn(async () => {}),
}))
vi.mock("@/lib/retention-windows", () => ({
  getRetentionWindows: vi.fn(async () => []),
}))

const { resetDeepAnalysis } = await import(
  "@/lib/retention-window-deep-analysis-reset"
)

interface RecordedCall {
  table: string
  op: "select" | "delete" | "update"
  payload?: Record<string, unknown>
  filters: Record<string, unknown>
}

// Fake of the query shapes this module issues: `from(t).select(cols).eq().eq()`,
// `from(t).delete().eq().eq()` and `from(t).update(payload).eq().eq()`, each
// awaited directly. `rows` supplies what a select on a given table returns.
function makeFakeSupabase(rows: Record<string, { storage_path: string | null }[]>): {
  supabase: SupabaseClient
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []

  function builder(call: RecordedCall, data: unknown) {
    const chain = {
      eq(column: string, value: unknown) {
        call.filters[column] = value
        return chain
      },
      then(
        onFulfilled: (value: { data: unknown; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve({ data, error: null }).then(
          onFulfilled,
          onRejected,
        )
      },
    }
    return chain
  }

  const supabase = {
    from(table: string) {
      return {
        select() {
          const call: RecordedCall = { table, op: "select", filters: {} }
          calls.push(call)
          return builder(call, rows[table] ?? [])
        },
        delete() {
          const call: RecordedCall = { table, op: "delete", filters: {} }
          calls.push(call)
          return builder(call, null)
        },
        update(payload: Record<string, unknown>) {
          const call: RecordedCall = { table, op: "update", payload, filters: {} }
          calls.push(call)
          return builder(call, null)
        },
      }
    },
  } as unknown as SupabaseClient

  return { supabase, calls }
}

function makeStorage(): StorageProvider & { deleted: string[] } {
  const deleted: string[] = []
  return {
    name: "fake",
    deleted,
    deleteObject: vi.fn(async (path: string) => {
      deleted.push(path)
    }),
  } as unknown as StorageProvider & { deleted: string[] }
}

const USER_ID = "user-1"
const VIDEO_ID = "video-1"

describe("resetDeepAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("clears every deep-analysis table for that user's video", async () => {
    const { supabase, calls } = makeFakeSupabase({})

    await resetDeepAnalysis(supabase, USER_ID, VIDEO_ID, makeStorage())

    const deleted = calls.filter((call) => call.op === "delete")
    expect(deleted.map((call) => call.table).sort()).toEqual([
      "retention_window_audio",
      "retention_window_costs",
      "retention_window_event_synthesis",
      "retention_window_events",
      "retention_window_scene_cue_scans",
      "retention_window_snapshots",
      "video_scene_cues",
    ])
    for (const call of deleted) {
      expect(call.filters).toEqual({
        user_id: USER_ID,
        analysed_video_id: VIDEO_ID,
      })
    }
  })

  it("deletes every harvested snapshot and audio object before dropping the rows that name them", async () => {
    const { supabase, calls } = makeFakeSupabase({
      retention_window_snapshots: [
        { storage_path: "user-1/video-1/window-a/snapshot-0.jpg" },
        { storage_path: "user-1/video-1/window-a/snapshot-1.jpg" },
        // A snapshot whose extraction failed never got an object.
        { storage_path: null },
      ],
      retention_window_audio: [
        { storage_path: "user-1/video-1/window-a/audio.mp3" },
      ],
    })
    const storage = makeStorage()

    await resetDeepAnalysis(supabase, USER_ID, VIDEO_ID, storage)

    expect(storage.deleted.sort()).toEqual([
      "user-1/video-1/window-a/audio.mp3",
      "user-1/video-1/window-a/snapshot-0.jpg",
      "user-1/video-1/window-a/snapshot-1.jpg",
    ])
    // The rows are the only record of which objects to delete, so they have to
    // be read before the wipe removes them.
    const lastSelect = calls.findLastIndex((call) => call.op === "select")
    const firstDelete = calls.findIndex((call) => call.op === "delete")
    expect(lastSelect).toBeLessThan(firstDelete)
  })

  it("still completes the reset when a storage object can't be deleted", async () => {
    const { supabase, calls } = makeFakeSupabase({
      retention_window_audio: [
        { storage_path: "user-1/video-1/window-a/audio.mp3" },
      ],
    })
    const storage = {
      name: "fake",
      deleteObject: vi.fn(async () => {
        throw new Error("storage unreachable")
      }),
    } as unknown as StorageProvider

    await expect(
      resetDeepAnalysis(supabase, USER_ID, VIDEO_ID, storage),
    ).resolves.toBeUndefined()

    // Orphaned bytes must not cost the user their retry.
    expect(calls.some((call) => call.op === "delete")).toBe(true)
  })

  it("clears the video-wide feature baseline so the next run recomputes it", async () => {
    const { supabase, calls } = makeFakeSupabase({})

    await resetDeepAnalysis(supabase, USER_ID, VIDEO_ID, makeStorage())

    const update = calls.find(
      (call) => call.op === "update" && call.table === "analysed_videos",
    )
    expect(update?.payload).toEqual({ deep_feature_baseline: null })
    expect(update?.filters).toEqual({ id: VIDEO_ID, user_id: USER_ID })
  })

  it("leaves the source file, retention windows and transcripts alone", async () => {
    const { supabase, calls } = makeFakeSupabase({})

    await resetDeepAnalysis(supabase, USER_ID, VIDEO_ID, makeStorage())

    const touched = new Set(
      calls
        .filter((call) => call.op === "delete" || call.op === "update")
        .map((call) => call.table),
    )
    expect(touched.has("source_files")).toBe(false)
    expect(touched.has("retention_windows")).toBe(false)
    expect(touched.has("retention_window_transcripts")).toBe(false)
  })
})
