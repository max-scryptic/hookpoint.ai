import { afterEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  analyzeRetentionWindowMedia,
  computeSpeechRate,
  type AudioAnalysis,
  type RetentionWindowMediaAnalyzer,
  type SnapshotAnalysis,
} from "@/lib/retention-window-media-analysis"
import type { StorageProvider } from "@/lib/storage"

vi.mock("@/lib/media/video-extraction", () => ({
  measureAudioClipStats: vi.fn(async () => ({
    averageVolumeDb: -18,
    silenceRatio: 0.05,
  })),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("computeSpeechRate", () => {
  it("computes words per minute across the window's span", () => {
    const transcript = new Array(60).fill("word").join(" ")
    expect(computeSpeechRate(transcript, 0, 30)).toBe(120)
  })

  it("is null when there's no transcript row", () => {
    expect(computeSpeechRate(null, 0, 30)).toBeNull()
  })

  it("is null for a zero-length window", () => {
    expect(computeSpeechRate("some words", 10, 10)).toBeNull()
  })
})

function fakeStorage(): StorageProvider {
  return {
    name: "fake",
    createSignedUpload: vi.fn(),
    statObject: vi.fn(),
    createSignedReadUrl: vi.fn(
      async (path: string) => `https://signed.example/${path}`,
    ),
    deleteObject: vi.fn(),
    putObject: vi.fn(async () => {}),
  } as unknown as StorageProvider
}

const SNAPSHOT_RESULT: SnapshotAnalysis = {
  scene: "talking_head",
  face_visible: true,
  contains_text: false,
  contains_code: false,
  motion: "low",
  people_count: 1,
  camera_movement: "static",
  on_screen_text: null,
  notable_event: null,
  description: "A person talking to camera.",
}

function fakeAnalyzer(
  overrides: Partial<RetentionWindowMediaAnalyzer> = {},
): RetentionWindowMediaAnalyzer {
  return {
    analyzeSnapshots: vi.fn(async (images) => {
      const map = new Map<number, SnapshotAnalysis>()
      for (const image of images) map.set(image.chunkIndex, SNAPSHOT_RESULT)
      return map
    }),
    analyzeAudio: vi.fn(async () => ({
      music: false,
      music_description: null,
      speakers: 1,
      tone: "calm and conversational",
      energy: "moderate" as const,
      notable_events: [],
    })),
    ...overrides,
  }
}

// A fake Supabase client that serves canned rows per table for the reads this
// module issues (claiming snapshots/audio pending analysis, transcripts) and
// records every update payload, the same pattern
// retention-window-media-extraction.test.ts uses for the extraction side.
//
// Claiming does an update().select(), which this fake treats as "claimed
// every canned row for that table" (it doesn't model the real WHERE clause) —
// good enough since these tests care about what analyzeRetentionWindowMedia
// does with claimed rows, not the claim's own row-locking semantics (that's
// exercised for real by Postgres, not this fake).
function makeFakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  const updates: {
    table: string
    id: string
    payload: Record<string, unknown>
  }[] = []

  const supabase = {
    from(table: string) {
      let pendingId: string | undefined
      let selectCalled = false
      const builder: Record<string, unknown> = {
        select: () => {
          selectCalled = true
          return builder
        },
        update: (payload: Record<string, unknown>) => {
          builder._payload = payload
          return builder
        },
        eq: (column: string, value: string) => {
          if (column === "id") pendingId = value
          return builder
        },
        or: () => builder,
        order: () => builder,
        then: (resolve: (v: unknown) => unknown) => {
          if (builder._payload) {
            updates.push({
              table,
              id: pendingId as string,
              payload: builder._payload as Record<string, unknown>,
            })
            // A claim (update followed by select()) returns the canned rows
            // as the claimed set; a terminal status write (update with no
            // select()) just resolves with no data, as it does for real.
            return Promise.resolve(
              selectCalled
                ? { data: tables[table] ?? [], error: null }
                : { error: null },
            ).then(resolve)
          }
          return Promise.resolve({ data: tables[table] ?? [], error: null }).then(
            resolve,
          )
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, updates }
}

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap-1",
    retention_window_id: "rw-1",
    chunk_index: 0,
    timestamp_seconds: 0,
    storage_path: "user-1/av-1/rw-1/snapshot-0.jpg",
    status: "ready",
    error: null,
    analysis_status: "pending",
    analysis: null,
    analysis_error: null,
    ...overrides,
  }
}

function audioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aud-1",
    retention_window_id: "rw-1",
    from_seconds: 0,
    to_seconds: 30,
    storage_path: "user-1/av-1/rw-1/audio.aac",
    status: "ready",
    error: null,
    analysis_status: "pending",
    analysis: null,
    analysis_error: null,
    ...overrides,
  }
}

function transcriptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    retention_window_id: "rw-1",
    from_seconds: 0,
    to_seconds: 30,
    transcript: new Array(60).fill("word").join(" "), // 120 wpm over 30s
    ...overrides,
  }
}

describe("analyzeRetentionWindowMedia", () => {
  it("does nothing when nothing is pending analysis", async () => {
    const { supabase } = makeFakeSupabase({})
    const analyzer = fakeAnalyzer()
    const storage = fakeStorage()

    await analyzeRetentionWindowMedia(supabase, "user-1", "av-1", {
      mediaStorage: storage,
      analyzer,
    })

    expect(storage.createSignedReadUrl).not.toHaveBeenCalled()
    expect(analyzer.analyzeSnapshots).not.toHaveBeenCalled()
    expect(analyzer.analyzeAudio).not.toHaveBeenCalled()
  })

  it("batches a window's chunks into one call and marks them ready", async () => {
    const { supabase, updates } = makeFakeSupabase({
      retention_window_snapshots: [
        snapshotRow({ id: "snap-1", chunk_index: 0 }),
        snapshotRow({
          id: "snap-2",
          chunk_index: 1,
          storage_path: "user-1/av-1/rw-1/snapshot-1.jpg",
        }),
      ],
      retention_window_audio: [],
    })
    const analyzer = fakeAnalyzer()
    const storage = fakeStorage()

    await analyzeRetentionWindowMedia(supabase, "user-1", "av-1", {
      mediaStorage: storage,
      analyzer,
    })

    expect(analyzer.analyzeSnapshots).toHaveBeenCalledTimes(1)
    expect(analyzer.analyzeSnapshots).toHaveBeenCalledWith([
      {
        chunkIndex: 0,
        imageUrl: "https://signed.example/user-1/av-1/rw-1/snapshot-0.jpg",
      },
      {
        chunkIndex: 1,
        imageUrl: "https://signed.example/user-1/av-1/rw-1/snapshot-1.jpg",
      },
    ])

    for (const id of ["snap-1", "snap-2"]) {
      expect(updates).toContainEqual(
        expect.objectContaining({
          table: "retention_window_snapshots",
          id,
          payload: expect.objectContaining({
            analysis_status: "ready",
            analysis: SNAPSHOT_RESULT,
          }),
        }),
      )
    }
  })

  it("marks every chunk in a window failed when the vision call throws", async () => {
    const { supabase, updates } = makeFakeSupabase({
      retention_window_snapshots: [snapshotRow()],
      retention_window_audio: [],
    })
    const analyzer = fakeAnalyzer({
      analyzeSnapshots: vi.fn(async () => {
        throw new Error("vision call failed")
      }),
    })

    await analyzeRetentionWindowMedia(supabase, "user-1", "av-1", {
      mediaStorage: fakeStorage(),
      analyzer,
    })

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_snapshots",
        id: "snap-1",
        payload: expect.objectContaining({
          analysis_status: "failed",
          analysis_error: "vision call failed",
        }),
      }),
    )
  })

  it("merges the audio model's output with deterministic transcript/ffmpeg stats", async () => {
    const { supabase, updates } = makeFakeSupabase({
      retention_window_snapshots: [],
      retention_window_audio: [audioRow()],
      retention_window_transcripts: [transcriptRow()],
    })
    const analyzer = fakeAnalyzer()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })),
    )

    await analyzeRetentionWindowMedia(supabase, "user-1", "av-1", {
      mediaStorage: fakeStorage(),
      analyzer,
    })

    const expected: AudioAnalysis = {
      music: false,
      music_description: null,
      speakers: 1,
      tone: "calm and conversational",
      energy: "moderate",
      notable_events: [],
      speech_rate: 120,
      average_volume: -18,
      silence: 0.05,
    }

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_audio",
        id: "aud-1",
        payload: expect.objectContaining({
          analysis_status: "ready",
          analysis: expected,
        }),
      }),
    )
  })

  it("marks the audio row failed when the model call throws, without needing ffmpeg stats to fail too", async () => {
    const { supabase, updates } = makeFakeSupabase({
      retention_window_snapshots: [],
      retention_window_audio: [audioRow()],
      retention_window_transcripts: [transcriptRow()],
    })
    const analyzer = fakeAnalyzer({
      analyzeAudio: vi.fn(async () => {
        throw new Error("audio model failed")
      }),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })),
    )

    await analyzeRetentionWindowMedia(supabase, "user-1", "av-1", {
      mediaStorage: fakeStorage(),
      analyzer,
    })

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_audio",
        id: "aud-1",
        payload: expect.objectContaining({
          analysis_status: "failed",
          analysis_error: "audio model failed",
        }),
      }),
    )
  })
})
