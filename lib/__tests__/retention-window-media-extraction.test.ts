import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  extractPendingRetentionWindowMedia,
  isSourceFileReady,
  mergeScanSpans,
  shouldDeferExtractionUntilAnalysisProxy,
  sliceSceneCues,
  type RetentionWindowMediaExtractionDeps,
  type SceneCueScanner,
} from "@/lib/retention-window-media-extraction"
import type { RetentionWindowSceneCueScan } from "@/lib/video-scene-cues"
import type { SourceFile } from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"
import type { VideoExtractor } from "@/lib/media/video-extraction"
import type { OcrEngine } from "@/lib/media/ocr"

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
    analysisProxyStoragePath: null,
    analysisProxySizeBytes: null,
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

describe("shouldDeferExtractionUntilAnalysisProxy", () => {
  const CACHE_BUDGET = 400 * 1024 * 1024

  it("defers a master too big to cache locally while the proxy is transcoding", () => {
    expect(
      shouldDeferExtractionUntilAnalysisProxy(
        makeSourceFile({ normalisationStatus: "processing" }),
        2_000_000_000,
        CACHE_BUDGET,
      ),
    ).toBe(true)
  })

  it("defers when the source size is unknown while the proxy is transcoding", () => {
    expect(
      shouldDeferExtractionUntilAnalysisProxy(
        makeSourceFile({ normalisationStatus: "pending" }),
        null,
        CACHE_BUDGET,
      ),
    ).toBe(true)
  })

  it("keeps the parallel head start for a master small enough to decode locally", () => {
    expect(
      shouldDeferExtractionUntilAnalysisProxy(
        makeSourceFile({ normalisationStatus: "processing" }),
        100 * 1024 * 1024,
        CACHE_BUDGET,
      ),
    ).toBe(false)
  })

  it("never defers once normalisation has settled — no proxy is coming", () => {
    for (const normalisationStatus of ["ready", "failed", "skipped"] as const) {
      expect(
        shouldDeferExtractionUntilAnalysisProxy(
          makeSourceFile({ normalisationStatus }),
          2_000_000_000,
          CACHE_BUDGET,
        ),
      ).toBe(false)
    }
  })
})

const SELECT_TABLES = new Set([
  "retention_window_snapshots",
  "retention_window_audio",
  "retention_window_scene_cue_scans",
])

let nextGeneratedId = 0

// A fake Supabase client that serves canned rows for the three "pending"
// reads this module issues, and records every status-update/insert/delete it
// makes in response. Stateful for retention_window_snapshots: rows an upsert
// adds to that table show up in a later select on it, since
// createRetentionWindowSnapshotsFromSceneCues creates rows mid-run (one batch
// per window) that the snapshot-extraction loop right after it has to see.
function makeFakeSupabase(
  snapshots: Record<string, unknown>[],
  audio: Record<string, unknown>[],
  sceneCueScans: Record<string, unknown>[] = [],
) {
  const updates: { table: string; id: string; payload: Record<string, unknown> }[] =
    []
  const inserts: { table: string; rows: Record<string, unknown>[] }[] = []
  const deletes: { table: string }[] = []

  const rowsByTable: Record<string, Record<string, unknown>[]> = {
    retention_window_snapshots: snapshots,
    retention_window_audio: audio,
    retention_window_scene_cue_scans: sceneCueScans,
  }

  const supabase = {
    from(table: string) {
      let pendingId: string | undefined
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          builder._payload = payload
          return builder
        },
        delete: () => {
          builder._delete = true
          return builder
        },
        upsert: (rows: Record<string, unknown>[]) => {
          if (table === "retention_window_snapshots") {
            rowsByTable[table] = [
              ...rowsByTable[table],
              ...rows.map((row) => ({
                id: `generated-${nextGeneratedId++}`,
                status: "pending",
                error: null,
                ...row,
              })),
            ]
          }
          return Promise.resolve({ error: null })
        },
        insert: (rows: Record<string, unknown>[]) => {
          inserts.push({ table, rows })
          return Promise.resolve({ error: null })
        },
        eq: (column: string, value: string) => {
          if (column === "id") pendingId = value
          return builder
        },
        gte: () => builder,
        order: () => builder,
        or: () => builder,
        then: (resolve: (v: unknown) => unknown) => {
          if (builder._payload) {
            updates.push({
              table,
              id: pendingId as string,
              payload: builder._payload as Record<string, unknown>,
            })
            return Promise.resolve({ error: null }).then(resolve)
          }
          if (builder._delete) {
            deletes.push({ table })
            return Promise.resolve({ error: null }).then(resolve)
          }
          const rows = SELECT_TABLES.has(table) ? rowsByTable[table] : []
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, updates, inserts, deletes }
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

function fakeSceneCueScanner(): SceneCueScanner & { scan: ReturnType<typeof vi.fn> } {
  return {
    scan: vi.fn(async () => ({ cuts: [], freezes: [], blacks: [] })),
  }
}

function fakeOcrEngine(): OcrEngine & {
  recognize: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
} {
  return {
    recognize: vi.fn(async () => ({ text: null, confidence: 0 })),
    terminate: vi.fn(async () => {}),
  }
}

describe("extractPendingRetentionWindowMedia", () => {
  it("does nothing (and mints no signed URL) when nothing is pending", async () => {
    const { supabase } = makeFakeSupabase([], [])
    const storage = fakeStorage()
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(),
      extractAudioSegment: vi.fn(),
    }
    const createOcrEngineSpy = vi.fn(async () => fakeOcrEngine())
    const deps: RetentionWindowMediaExtractionDeps = {
      extractor,
      mediaStorage: fakeStorage(),
      sceneCueScanner: fakeSceneCueScanner(),
      createOcrEngine: createOcrEngineSpy,
      acquireLocalSource: async () => null,
    }

    await extractPendingRetentionWindowMedia(
      supabase,
      storage,
      makeSourceFile(),
      deps,
    )

    expect(storage.createSignedReadUrl).not.toHaveBeenCalled()
    expect(extractor.extractThumbnail).not.toHaveBeenCalled()
    // No pending snapshots at all — never worth paying for a worker/model
    // load that would go completely unused.
    expect(createOcrEngineSpy).not.toHaveBeenCalled()
  })

  it("defers the whole run (rows stay pending) for a heavy master still being transcoded", async () => {
    const { supabase, updates } = makeFakeSupabase(
      [],
      [],
      [
        {
          id: "scan-1",
          retention_window_id: "rw-1",
          from_seconds: 0,
          to_seconds: 240,
          status: "pending",
          error: null,
        },
      ],
    )
    const storage = fakeStorage()
    const scanner = fakeSceneCueScanner()

    await extractPendingRetentionWindowMedia(
      supabase,
      storage,
      // A ~52Mbps 4K master, far past the local-cache budget, with the 360p
      // analysis proxy still minutes away at Qencode.
      makeSourceFile({
        normalisationStatus: "processing",
        proxyStoragePath: null,
        fileSizeBytes: 2_000_000_000,
      }),
      {
        extractor: {
          extractThumbnail: vi.fn(),
          extractAudioSegment: vi.fn(),
        },
        mediaStorage: fakeStorage(),
        sceneCueScanner: scanner,
        createOcrEngine: async () => fakeOcrEngine(),
        acquireLocalSource: async () => null,
      },
    )

    // Nothing decoded, nothing failed: the pending rows wait for the
    // normalisation callback to re-trigger extraction against the proxy.
    expect(storage.createSignedReadUrl).not.toHaveBeenCalled()
    expect(scanner.scan).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it("runs against a heavy master once normalisation has failed (no proxy coming)", async () => {
    const { supabase } = makeFakeSupabase(
      [],
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

    await extractPendingRetentionWindowMedia(
      supabase,
      storage,
      makeSourceFile({
        normalisationStatus: "failed",
        proxyStoragePath: null,
        fileSizeBytes: 2_000_000_000,
      }),
      {
        extractor: {
          extractThumbnail: vi.fn(),
          extractAudioSegment: vi.fn(async () => Buffer.from("mp3-bytes")),
        },
        mediaStorage: fakeStorage(),
        sceneCueScanner: fakeSceneCueScanner(),
        createOcrEngine: async () => fakeOcrEngine(),
        acquireLocalSource: async () => null,
      },
    )

    expect(storage.createSignedReadUrl).toHaveBeenCalledWith(
      "user-1/vid-1/sf-1/clip.mp4",
      expect.any(Number),
    )
  })

  it("extracts a pre-existing pending snapshot and audio clip and marks them ready", async () => {
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
      extractAudioSegment: vi.fn(async () => Buffer.from("mp3-bytes")),
    }
    const ocrEngine = fakeOcrEngine()
    ocrEngine.recognize.mockResolvedValueOnce({ text: "SALE 50% OFF", confidence: 90 })

    await extractPendingRetentionWindowMedia(supabase, storage, makeSourceFile(), {
      extractor,
      mediaStorage,
      sceneCueScanner: fakeSceneCueScanner(),
      createOcrEngine: async () => ocrEngine,
      acquireLocalSource: async () => null,
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
    // One worker for the whole run, reused across snapshots and torn down
    // once extraction finishes — not recreated per frame.
    expect(ocrEngine.recognize).toHaveBeenCalledWith(Buffer.from("jpeg-bytes"))
    expect(ocrEngine.terminate).toHaveBeenCalledTimes(1)

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_snapshots",
        id: "snap-1",
        payload: expect.objectContaining({
          status: "ready",
          ocr_text: "SALE 50% OFF",
        }),
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

  it("treats an OCR failure as best-effort — the snapshot still succeeds with a null ocrText", async () => {
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
      [],
    )
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(),
    }
    const ocrEngine = fakeOcrEngine()
    ocrEngine.recognize.mockRejectedValueOnce(new Error("tesseract crashed"))

    await extractPendingRetentionWindowMedia(supabase, fakeStorage(), makeSourceFile(), {
      extractor,
      mediaStorage: fakeStorage(),
      sceneCueScanner: fakeSceneCueScanner(),
      createOcrEngine: async () => ocrEngine,
      acquireLocalSource: async () => null,
    })

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_snapshots",
        id: "snap-1",
        payload: expect.objectContaining({ status: "ready", ocr_text: null }),
      }),
    )
    expect(ocrEngine.terminate).toHaveBeenCalledTimes(1)
  })

  it("treats OCR engine setup itself failing as best-effort — snapshots and audio still extract", async () => {
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
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(async () => Buffer.from("mp3-bytes")),
    }

    await extractPendingRetentionWindowMedia(supabase, fakeStorage(), makeSourceFile(), {
      extractor,
      mediaStorage: fakeStorage(),
      sceneCueScanner: fakeSceneCueScanner(),
      createOcrEngine: async () => {
        throw new Error("worker-script not found")
      },
      acquireLocalSource: async () => null,
    })

    // A broken OCR runtime (e.g. a bundling issue that leaves the worker
    // script missing in production) must not strand every pending snapshot
    // and audio clip 'pending' forever — only OCR itself is skipped.
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_snapshots",
        id: "snap-1",
        payload: expect.objectContaining({ status: "ready", ocr_text: null }),
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
      {
        extractor,
        mediaStorage: fakeStorage(),
        sceneCueScanner: fakeSceneCueScanner(),
        createOcrEngine: async () => fakeOcrEngine(),
        acquireLocalSource: async () => null,
      },
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

  it("scans a window's scene cues first, derives snapshots from the detected cut, and extracts them in the same run", async () => {
    const { supabase, updates, inserts } = makeFakeSupabase(
      [],
      [],
      [
        {
          id: "scan-1",
          retention_window_id: "rw-1",
          from_seconds: 0,
          to_seconds: 30,
          status: "pending",
          error: null,
        },
      ],
    )
    const sceneCueScanner = fakeSceneCueScanner()
    sceneCueScanner.scan.mockResolvedValueOnce({
      cuts: [{ atSeconds: 15 }],
      freezes: [],
      blacks: [],
    })
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(),
    }

    await extractPendingRetentionWindowMedia(supabase, fakeStorage(), makeSourceFile(), {
      extractor,
      mediaStorage: fakeStorage(),
      sceneCueScanner,
      createOcrEngine: async () => fakeOcrEngine(),
      acquireLocalSource: async () => null,
    })

    expect(sceneCueScanner.scan).toHaveBeenCalledWith(
      "https://signed.example/video.mp4",
      0,
      30,
    )
    expect(inserts).toContainEqual({
      table: "video_scene_cues",
      rows: [
        expect.objectContaining({
          retention_window_id: "rw-1",
          kind: "cut",
          from_seconds: 15,
        }),
      ],
    })

    // The cut at 15s => flanking snapshots at 14s and 16s, extracted in this
    // same run rather than waiting for a second trigger.
    expect(extractor.extractThumbnail).toHaveBeenCalledWith(
      "https://signed.example/video.mp4",
      14,
    )
    expect(extractor.extractThumbnail).toHaveBeenCalledWith(
      "https://signed.example/video.mp4",
      16,
    )
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_scene_cue_scans",
        id: "scan-1",
        payload: expect.objectContaining({ status: "ready" }),
      }),
    )
    expect(
      updates.filter(
        (update) =>
          update.table === "retention_window_snapshots" &&
          (update.payload as Record<string, unknown>).status === "ready",
      ),
    ).toHaveLength(2)
  })

  it("samples a single frame at the window start for a window whose scan ran and found no cuts", async () => {
    const { supabase, updates } = makeFakeSupabase(
      [],
      [],
      [
        {
          id: "scan-1",
          retention_window_id: "rw-1",
          from_seconds: 0,
          to_seconds: 30,
          status: "pending",
          error: null,
        },
      ],
    )
    // Default scanner resolves with zero cuts: a confirmed-static shot.
    const sceneCueScanner = fakeSceneCueScanner()
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(),
    }

    await extractPendingRetentionWindowMedia(supabase, fakeStorage(), makeSourceFile(), {
      extractor,
      mediaStorage: fakeStorage(),
      sceneCueScanner,
      createOcrEngine: async () => fakeOcrEngine(),
      acquireLocalSource: async () => null,
    })

    // Confirmed static => a single frame at the window start (0), not the
    // dense 5s grid a failed scan would fall back to.
    const grabbedTimestamps = (extractor.extractThumbnail as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[1])
      .sort((a, b) => a - b)
    expect(grabbedTimestamps).toEqual([0])
    expect(
      updates.filter(
        (update) =>
          update.table === "retention_window_snapshots" &&
          (update.payload as Record<string, unknown>).status === "ready",
      ),
    ).toHaveLength(1)
  })

  it("still derives fallback-grid snapshots when a window's scene-cue scan fails, but marks the scan itself failed", async () => {
    const { supabase, updates, inserts } = makeFakeSupabase(
      [],
      [],
      [
        {
          id: "scan-1",
          retention_window_id: "rw-1",
          from_seconds: 0,
          to_seconds: 10,
          status: "pending",
          error: null,
        },
      ],
    )
    const sceneCueScanner = fakeSceneCueScanner()
    sceneCueScanner.scan.mockRejectedValueOnce(new Error("ffmpeg failed"))
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(),
    }

    await extractPendingRetentionWindowMedia(supabase, fakeStorage(), makeSourceFile(), {
      extractor,
      mediaStorage: fakeStorage(),
      sceneCueScanner,
      createOcrEngine: async () => fakeOcrEngine(),
      acquireLocalSource: async () => null,
    })

    // No cue data to store — the scan itself never produced any.
    expect(inserts.filter((i) => i.table === "video_scene_cues")).toHaveLength(0)

    // [0,10] with no cut data falls back to the fixed 5s grid: 0, 5, 10.
    for (const timestamp of [0, 5, 10]) {
      expect(extractor.extractThumbnail).toHaveBeenCalledWith(
        "https://signed.example/video.mp4",
        timestamp,
      )
    }

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "retention_window_scene_cue_scans",
        id: "scan-1",
        payload: expect.objectContaining({
          status: "failed",
          error: "ffmpeg failed",
        }),
      }),
    )
    expect(
      updates.filter(
        (update) =>
          update.table === "retention_window_snapshots" &&
          (update.payload as Record<string, unknown>).status === "ready",
      ),
    ).toHaveLength(3)
  })
})

function makeScan(
  overrides: Partial<RetentionWindowSceneCueScan> = {},
): RetentionWindowSceneCueScan {
  return {
    id: "scan-1",
    retentionWindowId: "rw-1",
    fromSeconds: 0,
    toSeconds: 30,
    status: "pending",
    error: null,
    ...overrides,
  }
}

describe("mergeScanSpans", () => {
  it("coalesces overlapping and nearly-adjacent ranges into one span", () => {
    const spans = mergeScanSpans([
      makeScan({ id: "a", fromSeconds: 0, toSeconds: 20 }),
      makeScan({ id: "b", fromSeconds: 18, toSeconds: 35 }),
      makeScan({ id: "c", fromSeconds: 38, toSeconds: 55 }),
      makeScan({ id: "d", fromSeconds: 200, toSeconds: 240 }),
    ])

    expect(spans).toHaveLength(2)
    expect(spans[0]).toMatchObject({ fromSeconds: 0, toSeconds: 55 })
    expect(spans[0].scans.map((scan) => scan.id)).toEqual(["a", "b", "c"])
    expect(spans[1]).toMatchObject({ fromSeconds: 200, toSeconds: 240 })
  })

  it("never lets a contained range shrink the span", () => {
    const spans = mergeScanSpans([
      makeScan({ id: "a", fromSeconds: 0, toSeconds: 60 }),
      makeScan({ id: "b", fromSeconds: 10, toSeconds: 20 }),
    ])

    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ fromSeconds: 0, toSeconds: 60 })
  })

  it("stops merging once a span would grow past the max length", () => {
    // These four all overlap/adjoin, so the old unbounded merge coalesced them
    // into a single ~83s decode that blew the scan timeout and failed every
    // window at once. Capped at 60s, the run splits into bounded spans so a
    // timeout can only take out the windows in one span, not all of them.
    const spans = mergeScanSpans(
      [
        makeScan({ id: "hook", fromSeconds: 0, toSeconds: 30 }),
        makeScan({ id: "gain", fromSeconds: 0, toSeconds: 27.475 }),
        makeScan({ id: "drop-a", fromSeconds: 7.375, toSeconds: 47.375 }),
        makeScan({ id: "drop-b", fromSeconds: 43.255, toSeconds: 83.255 }),
      ],
      10,
      60,
    )

    expect(spans.every((span) => span.toSeconds - span.fromSeconds <= 60)).toBe(
      true,
    )
    expect(spans).toHaveLength(2)
    expect(spans[0]).toMatchObject({ fromSeconds: 0, toSeconds: 47.375 })
    expect(spans[0].scans.map((scan) => scan.id)).toEqual([
      "hook",
      "gain",
      "drop-a",
    ])
    expect(spans[1]).toMatchObject({ fromSeconds: 43.255, toSeconds: 83.255 })
  })

  it("still gives an over-length lone scan its own span (the cap only blocks merging)", () => {
    const spans = mergeScanSpans(
      [makeScan({ id: "a", fromSeconds: 0, toSeconds: 90 })],
      10,
      60,
    )

    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ fromSeconds: 0, toSeconds: 90 })
  })
})

describe("sliceSceneCues", () => {
  it("keeps cuts inside the window and clips freeze/black spans to it", () => {
    const sliced = sliceSceneCues(
      {
        cuts: [{ atSeconds: 5 }, { atSeconds: 35 }, { atSeconds: 70 }],
        freezes: [{ fromSeconds: 25, toSeconds: 45 }],
        blacks: [{ fromSeconds: 0, toSeconds: 10 }],
      },
      30,
      60,
    )

    expect(sliced.cuts).toEqual([{ atSeconds: 35 }])
    expect(sliced.freezes).toEqual([{ fromSeconds: 30, toSeconds: 45 }])
    expect(sliced.blacks).toEqual([])
  })
})

describe("extractPendingRetentionWindowMedia — merged scans and shared frames", () => {
  it("decodes overlapping windows' scans as one span and slices cues per window", async () => {
    const { supabase, updates, inserts } = makeFakeSupabase(
      [],
      [],
      [
        {
          id: "scan-1",
          retention_window_id: "rw-1",
          from_seconds: 0,
          to_seconds: 30,
          status: "pending",
          error: null,
        },
        {
          id: "scan-2",
          retention_window_id: "rw-2",
          from_seconds: 25,
          to_seconds: 60,
          status: "pending",
          error: null,
        },
      ],
    )
    const sceneCueScanner = fakeSceneCueScanner()
    sceneCueScanner.scan.mockResolvedValueOnce({
      cuts: [{ atSeconds: 15 }, { atSeconds: 40 }],
      freezes: [],
      blacks: [],
    })
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(),
    }

    await extractPendingRetentionWindowMedia(supabase, fakeStorage(), makeSourceFile(), {
      extractor,
      mediaStorage: fakeStorage(),
      sceneCueScanner,
      createOcrEngine: async () => fakeOcrEngine(),
      acquireLocalSource: async () => null,
    })

    // One decode covering both windows, not one per window.
    expect(sceneCueScanner.scan).toHaveBeenCalledTimes(1)
    expect(sceneCueScanner.scan).toHaveBeenCalledWith(
      "https://signed.example/video.mp4",
      0,
      60,
    )

    // Each window stores only its own slice of the master cue list.
    expect(inserts).toContainEqual({
      table: "video_scene_cues",
      rows: [
        expect.objectContaining({
          retention_window_id: "rw-1",
          kind: "cut",
          from_seconds: 15,
        }),
      ],
    })
    expect(inserts).toContainEqual({
      table: "video_scene_cues",
      rows: [
        expect.objectContaining({
          retention_window_id: "rw-2",
          kind: "cut",
          from_seconds: 40,
        }),
      ],
    })

    // Both scans settle ready off the single decode.
    for (const id of ["scan-1", "scan-2"]) {
      expect(updates).toContainEqual(
        expect.objectContaining({
          table: "retention_window_scene_cue_scans",
          id,
          payload: expect.objectContaining({ status: "ready" }),
        }),
      )
    }
  })

  it("extracts and OCRs a timestamp shared by two windows once, but stores both rows", async () => {
    const { supabase, updates } = makeFakeSupabase(
      [
        {
          id: "snap-1",
          retention_window_id: "rw-1",
          chunk_index: 0,
          timestamp_seconds: 12,
          storage_path: null,
          status: "pending",
          error: null,
        },
        {
          id: "snap-2",
          retention_window_id: "rw-2",
          chunk_index: 3,
          timestamp_seconds: 12,
          storage_path: null,
          status: "pending",
          error: null,
        },
      ],
      [],
    )
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(),
    }
    const ocrEngine = fakeOcrEngine()
    const mediaStorage = fakeStorage()

    await extractPendingRetentionWindowMedia(supabase, fakeStorage(), makeSourceFile(), {
      extractor,
      mediaStorage,
      sceneCueScanner: fakeSceneCueScanner(),
      createOcrEngine: async () => ocrEngine,
      acquireLocalSource: async () => null,
    })

    // The expensive work (decode + OCR) happens once for the shared
    // timestamp; only the cheap per-row object writes repeat.
    expect(extractor.extractThumbnail).toHaveBeenCalledTimes(1)
    expect(ocrEngine.recognize).toHaveBeenCalledTimes(1)
    expect(mediaStorage.putObject).toHaveBeenCalledTimes(2)
    for (const id of ["snap-1", "snap-2"]) {
      expect(updates).toContainEqual(
        expect.objectContaining({
          table: "retention_window_snapshots",
          id,
          payload: expect.objectContaining({ status: "ready" }),
        }),
      )
    }
  })

  it("reads the 360p analysis proxy when normalisation produced one", async () => {
    const { supabase } = makeFakeSupabase(
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
      [],
    )
    const storage = fakeStorage()
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(),
    }

    await extractPendingRetentionWindowMedia(
      supabase,
      storage,
      makeSourceFile({
        analysisProxyStoragePath: "user-1/vid-1/sf-1/proxy-360p.mp4",
        analysisProxySizeBytes: 512,
      }),
      {
        extractor,
        mediaStorage: fakeStorage(),
        sceneCueScanner: fakeSceneCueScanner(),
        createOcrEngine: async () => fakeOcrEngine(),
        acquireLocalSource: async () => null,
      },
    )

    expect(storage.createSignedReadUrl).toHaveBeenCalledWith(
      "user-1/vid-1/sf-1/proxy-360p.mp4",
      expect.any(Number),
    )
  })

  it("decodes from the locally cached copy when one is available, and cleans it up", async () => {
    const { supabase } = makeFakeSupabase(
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
    const extractor: VideoExtractor = {
      extractThumbnail: vi.fn(async () => Buffer.from("jpeg-bytes")),
      extractAudioSegment: vi.fn(async () => Buffer.from("mp3-bytes")),
    }
    const cleanup = vi.fn(async () => {})

    await extractPendingRetentionWindowMedia(supabase, fakeStorage(), makeSourceFile(), {
      extractor,
      mediaStorage: fakeStorage(),
      sceneCueScanner: fakeSceneCueScanner(),
      createOcrEngine: async () => fakeOcrEngine(),
      acquireLocalSource: async () => ({
        path: "/tmp/cache/source.mp4",
        cleanup,
      }),
    })

    expect(extractor.extractThumbnail).toHaveBeenCalledWith(
      "/tmp/cache/source.mp4",
      0,
    )
    expect(extractor.extractAudioSegment).toHaveBeenCalledWith(
      "/tmp/cache/source.mp4",
      0,
      30,
    )
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
