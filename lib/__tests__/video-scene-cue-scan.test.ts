import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { SourceFile } from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"
import { scanPendingVideoSceneCues } from "@/lib/video-scene-cue-scan"

const { scanVideoSceneCues } = vi.hoisted(() => ({
  scanVideoSceneCues: vi.fn(),
}))

vi.mock("@/lib/media/scene-detection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/media/scene-detection")>()
  return { ...actual, scanVideoSceneCues }
})

function makeSourceFile(overrides: Partial<SourceFile> = {}): SourceFile {
  return {
    id: "sf-1",
    userId: "user-1",
    analysedVideoId: "av-1",
    youtubeVideoId: "vid-1",
    originalFilename: "clip.mp4",
    storageProvider: "fake",
    storagePath: "user-1/vid-1/sf-1/clip.mp4",
    fileSizeBytes: 1000,
    mimeType: "video/mp4",
    uploadedDurationSeconds: 600,
    youtubeDurationSeconds: 600,
    durationDifferenceSeconds: 0,
    durationValidationStatus: "passed",
    filenameValidationStatus: "passed",
    filenameSimilarityScore: 1,
    validationStatus: "passed",
    uploadStatus: "ready",
    failureReason: null,
    deleteAfter: null,
    proxyStoragePath: "user-1/vid-1/sf-1/proxy-1080p.mp4",
    proxySizeBytes: 2048,
    normalisationStatus: "ready",
    normalisationProvider: "qencode",
    normalisationTaskToken: "task-1",
    normalisationError: null,
    originalDeletedAt: "2026-07-01T00:00:00Z",
    createdAt: "2026-06-30T00:00:00Z",
    updatedAt: "2026-06-30T00:00:00Z",
    ...overrides,
  }
}

function fakeStorage(): StorageProvider {
  return {
    name: "fake",
    createSignedUpload: vi.fn(),
    statObject: vi.fn(),
    createSignedReadUrl: vi.fn(async () => "https://signed.example/video.mp4"),
    deleteObject: vi.fn(),
    putObject: vi.fn(async () => {}),
  } as unknown as StorageProvider
}

// Fake covering exactly the query shapes this module issues: a claim
// (update+select on analysed_videos), a plain status update (update only, no
// select) for markReady/markFailed, and delete+insert on video_scene_cues.
function makeFakeSupabase(options: { claimSucceeds: boolean }) {
  const calls: { table: string; op: string; payload?: Record<string, unknown> }[] =
    []
  let insertedRows: Record<string, unknown>[] | null = null

  const supabase = {
    from(table: string) {
      const builder: Record<string, unknown> & {
        _op?: string
        _payload?: Record<string, unknown>
        _select?: boolean
      } = {
        update: (payload: Record<string, unknown>) => {
          builder._op = "update"
          builder._payload = payload
          return builder
        },
        delete: () => {
          builder._op = "delete"
          return builder
        },
        insert: (rows: Record<string, unknown>[]) => {
          insertedRows = rows
          calls.push({ table, op: "insert", payload: { rows } as unknown as Record<string, unknown> })
          return Promise.resolve({ error: null })
        },
        eq: () => builder,
        or: () => builder,
        select: () => {
          builder._select = true
          return builder
        },
        then: (resolve: (value: unknown) => unknown) => {
          calls.push({ table, op: builder._op ?? "unknown", payload: builder._payload })
          if (table === "analysed_videos" && builder._op === "update" && builder._select) {
            return Promise.resolve({
              data: options.claimSucceeds ? [{ id: "av-1" }] : [],
              error: null,
            }).then(resolve)
          }
          return Promise.resolve({ error: null }).then(resolve)
        },
      }
      return builder
    },
  }

  return {
    supabase: supabase as unknown as SupabaseClient,
    calls,
    getInsertedRows: () => insertedRows,
  }
}

describe("scanPendingVideoSceneCues", () => {
  it("does nothing when the video's duration isn't known yet", async () => {
    const { supabase, calls } = makeFakeSupabase({ claimSucceeds: true })
    const storage = fakeStorage()

    await scanPendingVideoSceneCues(supabase, storage, makeSourceFile(), null)

    expect(calls).toHaveLength(0)
    expect(storage.createSignedReadUrl).not.toHaveBeenCalled()
    expect(scanVideoSceneCues).not.toHaveBeenCalled()
  })

  it("does not scan when another trigger already holds or finished the claim", async () => {
    const { supabase, calls } = makeFakeSupabase({ claimSucceeds: false })
    const storage = fakeStorage()

    await scanPendingVideoSceneCues(supabase, storage, makeSourceFile(), 600)

    expect(calls).toHaveLength(1)
    expect(storage.createSignedReadUrl).not.toHaveBeenCalled()
    expect(scanVideoSceneCues).not.toHaveBeenCalled()
  })

  it("claims, scans, stores the cues, and marks the scan ready", async () => {
    scanVideoSceneCues.mockResolvedValueOnce({
      cuts: [{ atSeconds: 12.3 }],
      freezes: [{ fromSeconds: 5, toSeconds: 7 }],
      blacks: [],
    })
    const { supabase, calls, getInsertedRows } = makeFakeSupabase({
      claimSucceeds: true,
    })
    const storage = fakeStorage()

    await scanPendingVideoSceneCues(supabase, storage, makeSourceFile(), 600)

    expect(storage.createSignedReadUrl).toHaveBeenCalledWith(
      "user-1/vid-1/sf-1/proxy-1080p.mp4",
      expect.any(Number),
    )
    expect(scanVideoSceneCues).toHaveBeenCalledWith(
      "https://signed.example/video.mp4",
      600,
    )
    expect(getInsertedRows()).toEqual([
      expect.objectContaining({ kind: "cut", from_seconds: 12.3, to_seconds: 12.3 }),
      expect.objectContaining({ kind: "freeze", from_seconds: 5, to_seconds: 7 }),
    ])
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: "analysed_videos",
        op: "update",
        payload: expect.objectContaining({ scene_cue_scan_status: "ready" }),
      }),
    )
  })

  it("marks the scan failed when the ffmpeg pass throws", async () => {
    scanVideoSceneCues.mockRejectedValueOnce(new Error("ffmpeg timed out"))
    const { supabase, calls } = makeFakeSupabase({ claimSucceeds: true })

    await scanPendingVideoSceneCues(supabase, fakeStorage(), makeSourceFile(), 600)

    expect(calls).toContainEqual(
      expect.objectContaining({
        table: "analysed_videos",
        op: "update",
        payload: expect.objectContaining({
          scene_cue_scan_status: "failed",
          scene_cue_scan_error: "ffmpeg timed out",
        }),
      }),
    )
  })
})
