import { afterEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  analyzeRetentionWindowMedia,
  computeSpeechRate,
  openAiRetentionWindowMediaAnalyzer,
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
  delete process.env.OPENAI_API_KEY
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
    ocr_text: null,
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
    storage_path: "user-1/av-1/rw-1/audio.mp3",
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

  it("batches a window's chunks into one call, with each chunk's OCR text, and marks them ready", async () => {
    const { supabase, updates } = makeFakeSupabase({
      retention_window_snapshots: [
        snapshotRow({ id: "snap-1", chunk_index: 0, ocr_text: "SALE 50% OFF" }),
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
        ocrText: "SALE 50% OFF",
      },
      {
        chunkIndex: 1,
        imageUrl: "https://signed.example/user-1/av-1/rw-1/snapshot-1.jpg",
        ocrText: null,
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

// Regression coverage for the real OpenAI-backed analyzer: audio has no
// input_audio content type on the Responses API, and audio-capable Chat
// Completions models don't support response_format at all (not even plain
// json_object), so this exercises the actual HTTP call/parse instead of
// stopping at the fake analyzer boundary the tests above use.
describe("openAiRetentionWindowMediaAnalyzer.analyzeAudio", () => {
  it("calls Chat Completions (not Responses) with an input_audio content part and no response_format", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  music: true,
                  music_description: "Light background synth",
                  speakers: 2,
                  tone: "upbeat",
                  energy: "high",
                  notable_events: ["laughter"],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await openAiRetentionWindowMediaAnalyzer.analyzeAudio({
      base64: "AAAA",
      format: "mp3",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.modalities).toEqual(["text"])
    expect(body.response_format).toBeUndefined()
    expect(body.messages).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: [
          { type: "input_audio", input_audio: { data: "AAAA", format: "mp3" } },
        ],
      }),
    )
    expect(result).toEqual({
      music: true,
      music_description: "Light background synth",
      speakers: 2,
      tone: "upbeat",
      energy: "high",
      notable_events: ["laughter"],
    })
  })

  it("throws when the model's JSON doesn't match the expected shape", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ music: true }) } }],
          }),
          { status: 200 },
        ),
      ),
    )

    await expect(
      openAiRetentionWindowMediaAnalyzer.analyzeAudio({ base64: "AAAA", format: "mp3" }),
    ).rejects.toThrow(/unexpected shape/)
  })
})
