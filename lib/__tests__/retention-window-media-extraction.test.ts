import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  extractPendingRetentionWindowMedia,
  isSourceFileReady,
  type RetentionWindowMediaExtractionDeps,
} from "@/lib/retention-window-media-extraction"
import type { SourceFile } from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"
import type { VideoExtractor } from "@/lib/media/video-extraction"

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

describe("isSourceFileReady", () => {
  it("is true once the proxy is ready", () => {
    expect(isSourceFileReady(makeSourceFile())).toBe(true)
  })

  it("is true for the original while normalisation is still in flight", () => {
    expect(
      isSourceFileReady(
        makeSourceFile({ normalisationStatus: "processing", proxyStoragePath: null }),
      ),
    ).toBe(true)
  })

  it("is false when there's no source file", () => {
    expect(isSourceFileReady(null)).toBe(false)
  })

  it("is false when the upload itself hasn't finished", () => {
    expect(
      isSourceFileReady(makeSourceFile({ uploadStatus: "uploading" })),
    ).toBe(false)
  })
})

// A fake Supabase client that serves canned rows for the two "pending" reads
// this module issues and records every status-update payload.
function makeFakeSupabase(
  snapshots: Record<string, unknown>[],
  audio: Record<string, unknown>[],
) {
  const updates: { table: string; id: string; payload: Record<string, unknown> }[] =
    []

  const supabase = {
    from(table: string) {
      let pendingId: string | undefined
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          builder._payload = payload
          return builder
        },
        eq: (column: string, value: string) => {
          if (column === "id") pendingId = value
          return builder
        },
        order: () => builder,
        then: (resolve: (v: unknown) => unknown) => {
          if (builder._payload) {
            updates.push({
              table,
              id: pendingId as string,
              payload: builder._payload as Record<string, unknown>,
            })
            return Promise.resolve({ error: null }).then(resolve)
          }
          const rows = table === "retention_window_snapshots" ? snapshots : audio
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, updates }
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

describe("extractPendingRetentionWindowMedia", () => {
  it("does nothing (and mints no signed URL) when nothing is pending", async () => {
    const { supabase } = makeFakeSupabase([], [])
    const storage = fakeStorage()
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(),
      extractAudioSegment: vi.fn(),
    }
    const deps: RetentionWindowMediaExtractionDeps = {
      extractor,
      mediaStorage: fakeStorage(),
    }

    await extractPendingRetentionWindowMedia(
      supabase,
      storage,
      makeSourceFile(),
      deps,
    )

    expect(storage.createSignedReadUrl).not.toHaveBeenCalled()
    expect(extractor.extractThumbnail).not.toHaveBeenCalled()
  })

  it("extracts each pending snapshot and audio clip and marks them ready", async () => {
    const { supabase, updates } = makeFakeSupabase(
      [
        {
          id: "snap-1",
          retention_window_id: "rw-1",
          chunk_index: 0,
          timestamp_seconds: 0,
          storage_path: null,
          status: "pending",
          error: null,
        },
      ],
      [
        {
          id: "aud-1",
          retention_window_id: "rw-1",
          from_seconds: 0,
          to_seconds: 30,
          storage_path: null,
          status: "pending",
          error: null,
        },
      ],
    )
    const storage = fakeStorage()
    const mediaStorage = fakeStorage()
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(async () => Buffer.from("aac-bytes")),
    }

    await extractPendingRetentionWindowMedia(supabase, storage, makeSourceFile(), {
      extractor,
      mediaStorage,
    })

    expect(storage.createSignedReadUrl).toHaveBeenCalledWith(
      "user-1/vid-1/sf-1/proxy-1080p.mp4",
      expect.any(Number),
    )
    expect(extractor.extractThumbnail).toHaveBeenCalledWith(
      "https://signed.example/video.mp4",
      0,
    )
    expect(extractor.extractAudioSegment).toHaveBeenCalledWith(
      "https://signed.example/video.mp4",
      0,
      30,
    )
    expect(mediaStorage.putObject).toHaveBeenCalledTimes(2)

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_snapshots",
        id: "snap-1",
        payload: expect.objectContaining({ status: "ready" }),
      }),
    )
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_audio",
        id: "aud-1",
        payload: expect.objectContaining({ status: "ready" }),
      }),
    )
  })

  it("records a failure on one row and still processes the rest", async () => {
    const { supabase, updates } = makeFakeSupabase(
      [
        {
          id: "snap-1",
          retention_window_id: "rw-1",
          chunk_index: 0,
          timestamp_seconds: 0,
          storage_path: null,
          status: "pending",
          error: null,
        },
        {
          id: "snap-2",
          retention_window_id: "rw-1",
          chunk_index: 1,
          timestamp_seconds: 5,
          storage_path: null,
          status: "pending",
          error: null,
        },
      ],
      [],
    )
    const extractor: VideoExtractor = {
      extractThumbnail: vi
        .fn()
        .mockRejectedValueOnce(new Error("seek failed"))
        .mockResolvedValueOnce(Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(),
    }

    await extractPendingRetentionWindowMedia(
      supabase,
      fakeStorage(),
      makeSourceFile(),
      { extractor, mediaStorage: fakeStorage() },
    )

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_snapshots",
        id: "snap-1",
        payload: expect.objectContaining({
          status: "failed",
          error: "seek failed",
        }),
      }),
    )
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_snapshots",
        id: "snap-2",
        payload: expect.objectContaining({ status: "ready" }),
      }),
    )
  })
})
