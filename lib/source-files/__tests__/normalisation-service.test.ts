import { afterEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { QencodeClient } from "@/lib/qencode/qencode"
import {
  applyNormalisationCallback,
  buildProxyObjectPath,
  parseQencodeCallback,
  startNormalisation,
  type NormalisationDeps,
} from "@/lib/source-files/normalisation-service"
import {
  resolvePlaybackStoragePath,
  type SourceFile,
} from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"

// A full domain SourceFile with sensible defaults, overridable per test.
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
    proxyStoragePath: null,
    proxySizeBytes: null,
    normalisationStatus: "pending",
    normalisationProvider: null,
    normalisationTaskToken: null,
    normalisationError: null,
    originalDeletedAt: null,
    createdAt: "2026-06-30T00:00:00Z",
    updatedAt: "2026-06-30T00:00:00Z",
    ...overrides,
  }
}

// A Supabase fake that records the update payload and echoes a row back so
// updateSourceFile resolves. Returns the merged row so callers see their writes.
function makeUpdateSupabase(base: SourceFile) {
  const updates: Record<string, unknown>[] = []
  const supabase = {
    from() {
      const state: { payload?: Record<string, unknown> } = {}
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          state.payload = payload
          updates.push(payload)
          return builder
        },
        eq: () => builder,
        single: () =>
          Promise.resolve({ data: rowFor(base, state.payload), error: null }),
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { supabase, updates }
}

// Builds the snake_case row updateSourceFile re-selects, applying the payload so
// the returned domain object reflects the write.
function rowFor(base: SourceFile, payload: Record<string, unknown> = {}) {
  return {
    id: base.id,
    user_id: base.userId,
    analysed_video_id: base.analysedVideoId,
    youtube_video_id: base.youtubeVideoId,
    original_filename: base.originalFilename,
    storage_provider: base.storageProvider,
    storage_path: base.storagePath,
    file_size_bytes: base.fileSizeBytes,
    mime_type: base.mimeType,
    uploaded_duration_seconds: base.uploadedDurationSeconds,
    youtube_duration_seconds: base.youtubeDurationSeconds,
    duration_difference_seconds: base.durationDifferenceSeconds,
    duration_validation_status: base.durationValidationStatus,
    filename_validation_status: base.filenameValidationStatus,
    filename_similarity_score: base.filenameSimilarityScore,
    validation_status: base.validationStatus,
    upload_status: base.uploadStatus,
    failure_reason: base.failureReason,
    delete_after: base.deleteAfter,
    proxy_storage_path: base.proxyStoragePath,
    proxy_size_bytes: base.proxySizeBytes,
    normalisation_status: base.normalisationStatus,
    normalisation_provider: base.normalisationProvider,
    normalisation_task_token: base.normalisationTaskToken,
    normalisation_error: base.normalisationError,
    original_deleted_at: base.originalDeletedAt,
    created_at: base.createdAt,
    updated_at: base.updatedAt,
    ...payload,
  }
}

function fakeStorage(
  proxyExists: boolean = true,
  sizeBytes: number | null = proxyExists ? 2048 : null,
): StorageProvider {
  return {
    name: "fake",
    createSignedUpload: vi.fn(),
    statObject: vi.fn(async () => ({
      exists: proxyExists,
      sizeBytes,
      contentType: proxyExists ? "video/mp4" : null,
    })),
    createSignedReadUrl: vi.fn(async () => "https://signed.example/read"),
    deleteObject: vi.fn(async () => {}),
    putObjectFromUrl: vi.fn(async () => {}),
  } as unknown as StorageProvider
}

// Stubs every env var isNormalisationEnabled() requires, so startNormalisation
// takes the enabled path.
function enableNormalisation() {
  vi.stubEnv("QENCODE_API_KEY", "api-key")
  vi.stubEnv("APP_BASE_URL", "https://app.test")
  vi.stubEnv(
    "SOURCE_FILE_S3_ENDPOINT",
    "https://proj.storage.supabase.co/storage/v1/s3",
  )
  vi.stubEnv("SOURCE_FILE_S3_REGION", "us-east-1")
  vi.stubEnv("SOURCE_FILE_S3_ACCESS_KEY_ID", "akid")
  vi.stubEnv("SOURCE_FILE_S3_SECRET_ACCESS_KEY", "secret")
}

function fakeDeps(submit: () => Promise<string>): NormalisationDeps {
  return {
    createClient: () =>
      ({ submitJob: vi.fn(submit) }) as unknown as QencodeClient,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("buildProxyObjectPath", () => {
  it("places the proxy beside the original with a height-tagged name", () => {
    expect(buildProxyObjectPath("user-1/vid-1/sf-1/clip.mp4", 1080)).toBe(
      "user-1/vid-1/sf-1/proxy-1080p.mp4",
    )
  })
})

describe("resolvePlaybackStoragePath", () => {
  it("uses the proxy only once normalisation is ready", () => {
    expect(
      resolvePlaybackStoragePath(
        makeSourceFile({
          normalisationStatus: "ready",
          proxyStoragePath: "p/proxy.mp4",
        }),
      ),
    ).toBe("p/proxy.mp4")
  })

  it("falls back to the original while a job is in flight", () => {
    expect(
      resolvePlaybackStoragePath(
        makeSourceFile({
          normalisationStatus: "processing",
          proxyStoragePath: "p/proxy.mp4",
          storagePath: "p/original.mp4",
        }),
      ),
    ).toBe("p/original.mp4")
  })
})

describe("startNormalisation", () => {
  it("is a no-op when normalisation is disabled", async () => {
    const sf = makeSourceFile()
    const submit = vi.fn(async () => "task-1")
    const { supabase, updates } = makeUpdateSupabase(sf)

    const result = await startNormalisation(
      supabase,
      fakeStorage(),
      sf,
      fakeDeps(submit),
    )

    expect(result).toBe(sf)
    expect(submit).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it("submits a job and records the in-flight state when enabled", async () => {
    enableNormalisation()
    const sf = makeSourceFile()
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage()

    const result = await startNormalisation(
      supabase,
      storage,
      sf,
      fakeDeps(async () => "task-xyz"),
    )

    expect(storage.createSignedReadUrl).toHaveBeenCalledWith(
      "user-1/vid-1/sf-1/clip.mp4",
      expect.any(Number),
    )
    expect(updates[0]).toMatchObject({
      normalisation_status: "processing",
      normalisation_provider: "qencode",
      normalisation_task_token: "task-xyz",
      proxy_storage_path: "user-1/vid-1/sf-1/proxy-1080p.mp4",
    })
    expect(result.normalisationStatus).toBe("processing")
  })

  it("records 'failed' (and keeps the original) when the transcoder errors", async () => {
    enableNormalisation()
    const sf = makeSourceFile()
    const { supabase, updates } = makeUpdateSupabase(sf)

    const result = await startNormalisation(
      supabase,
      fakeStorage(),
      sf,
      fakeDeps(async () => {
        throw new Error("qencode down")
      }),
    )

    expect(updates[0]).toMatchObject({
      normalisation_status: "failed",
      normalisation_error: "qencode down",
    })
    expect(result.normalisationStatus).toBe("failed")
  })
})

describe("parseQencodeCallback", () => {
  // Qencode POSTs application/x-www-form-urlencoded fields, with the bulk of
  // the payload nested in a JSON-encoded `status` string — not a JSON body.
  it("maps a completed event and extracts the output URL", () => {
    expect(
      parseQencodeCallback({
        task_token: "t",
        event: "saved",
        status: JSON.stringify({
          error: 0,
          videos: [{ url: "https://storage.qencode.com/out.mp4" }],
        }),
      }),
    ).toEqual({
      taskToken: "t",
      outcome: "completed",
      errorMessage: undefined,
      videoUrl: "https://storage.qencode.com/out.mp4",
    })
  })

  it("also treats a 'completed' event as completed", () => {
    expect(
      parseQencodeCallback({
        task_token: "t",
        event: "completed",
        status: JSON.stringify({ error: 0 }),
      }),
    ).toMatchObject({ outcome: "completed" })
  })

  it("maps an error event and its message", () => {
    expect(
      parseQencodeCallback({
        task_token: "t",
        event: "error",
        status: JSON.stringify({ error: 1, message: "boom" }),
      }),
    ).toMatchObject({ taskToken: "t", outcome: "error", errorMessage: "boom" })
  })

  it("treats a non-zero error field in status as a failure", () => {
    expect(
      parseQencodeCallback({
        task_token: "t",
        status: JSON.stringify({ error: 5 }),
      }),
    ).toMatchObject({ outcome: "error" })
  })

  it("tolerates a missing or malformed status field", () => {
    expect(
      parseQencodeCallback({ task_token: "t", event: "progress" }),
    ).toMatchObject({ outcome: "progress" })
    expect(
      parseQencodeCallback({ task_token: "t", status: "not json" }),
    ).toMatchObject({ outcome: "progress" })
  })

  it("returns null without a task token", () => {
    expect(parseQencodeCallback({ event: "completed" })).toBeNull()
    expect(parseQencodeCallback({})).toBeNull()
  })
})

describe("applyNormalisationCallback", () => {
  const proxyPath = "user-1/vid-1/sf-1/proxy-1080p.mp4"
  const videoUrl = "https://storage.qencode.com/e207/out.mp4"

  it("on completion: pulls the output, marks ready, and deletes the original", async () => {
    const sf = makeSourceFile({
      normalisationStatus: "processing",
      proxyStoragePath: proxyPath,
    })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage(true)

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "completed",
      videoUrl,
    })

    expect(storage.putObjectFromUrl).toHaveBeenCalledWith(proxyPath, videoUrl, {
      contentType: "video/mp4",
    })
    expect(updates[0]).toMatchObject({
      normalisation_status: "ready",
      proxy_size_bytes: 2048,
      storage_path: null,
    })
    expect(updates[0].original_deleted_at).toBeTruthy()
    expect(storage.deleteObject).toHaveBeenCalledWith(
      "user-1/vid-1/sf-1/clip.mp4",
    )
  })

  it("fails (and keeps the original) when a completed callback has no output URL", async () => {
    const sf = makeSourceFile({
      normalisationStatus: "processing",
      proxyStoragePath: proxyPath,
    })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage(true)

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "completed",
    })

    expect(storage.putObjectFromUrl).not.toHaveBeenCalled()
    expect(updates[0]).toMatchObject({
      normalisation_status: "failed",
      normalisation_error: "Completed callback had no output to pull",
    })
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("fails (and keeps the original) when the storage provider can't pull a URL", async () => {
    const sf = makeSourceFile({
      normalisationStatus: "processing",
      proxyStoragePath: proxyPath,
    })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage(true)
    delete (storage as { putObjectFromUrl?: unknown }).putObjectFromUrl

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "completed",
      videoUrl,
    })

    expect(updates[0]).toMatchObject({
      normalisation_status: "failed",
      normalisation_error: "Storage provider can't pull the transcoder output",
    })
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("fails (and keeps the original) when pulling the output throws", async () => {
    const sf = makeSourceFile({
      normalisationStatus: "processing",
      proxyStoragePath: proxyPath,
    })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage(true)
    storage.putObjectFromUrl = vi.fn(async () => {
      throw new Error("fetch failed")
    })

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "completed",
      videoUrl,
    })

    expect(updates[0]).toMatchObject({
      normalisation_status: "failed",
      normalisation_error: "fetch failed",
    })
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("fails (and keeps the original) when the pulled proxy is missing", async () => {
    const sf = makeSourceFile({
      normalisationStatus: "processing",
      proxyStoragePath: proxyPath,
    })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage(false)

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "completed",
      videoUrl,
    })

    expect(updates[0]).toMatchObject({ normalisation_status: "failed" })
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("fails (and keeps the original) when the pulled proxy is 0 bytes", async () => {
    const sf = makeSourceFile({
      normalisationStatus: "processing",
      proxyStoragePath: proxyPath,
    })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage(true, 0)

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "completed",
      videoUrl,
    })

    expect(updates[0]).toMatchObject({
      normalisation_status: "failed",
      normalisation_error: "Pulled proxy landed empty (0 bytes)",
    })
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("records a failure on an error callback", async () => {
    const sf = makeSourceFile({ normalisationStatus: "processing" })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage()

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "error",
      errorMessage: "encode failed",
    })

    expect(updates[0]).toMatchObject({
      normalisation_status: "failed",
      normalisation_error: "encode failed",
    })
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("is idempotent for an already-ready row", async () => {
    const sf = makeSourceFile({ normalisationStatus: "ready" })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage()

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "completed",
    })

    expect(updates).toHaveLength(0)
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("ignores interim progress events", async () => {
    const sf = makeSourceFile({ normalisationStatus: "processing" })
    const { supabase, updates } = makeUpdateSupabase(sf)

    await applyNormalisationCallback(supabase, fakeStorage(), sf, {
      taskToken: "task-1",
      outcome: "progress",
    })

    expect(updates).toHaveLength(0)
  })
})
