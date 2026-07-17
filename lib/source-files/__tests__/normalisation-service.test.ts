import { afterEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { QencodeClient } from "@/lib/qencode/qencode"
import {
  applyNormalisationCallback,
  buildProxyObjectPath,
  parseQencodeCallback,
  pickCallbackVideo,
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
    analysisProxyStoragePath: null,
    analysisProxySizeBytes: null,
    normalisationStatus: "pending",
    normalisationProvider: null,
    normalisationTaskToken: null,
    normalisationError: null,
    originalDeletedAt: null,
    deepCreditsCharged: null,
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
    analysis_proxy_storage_path: base.analysisProxyStoragePath,
    analysis_proxy_size_bytes: base.analysisProxySizeBytes,
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
      // The 360p analysis proxy rides along in the same job.
      analysis_proxy_storage_path: "user-1/vid-1/sf-1/proxy-360p.mp4",
    })
    expect(result.normalisationStatus).toBe("processing")
  })

  it("submits both a tagged playback output and a tagged analysis output", async () => {
    enableNormalisation()
    const sf = makeSourceFile()
    const { supabase } = makeUpdateSupabase(sf)
    let submitted: unknown
    const deps: NormalisationDeps = {
      createClient: () =>
        ({
          submitJob: async (query: unknown) => {
            submitted = query
            return "task-xyz"
          },
        }) as unknown as QencodeClient,
    }

    await startNormalisation(supabase, fakeStorage(), sf, deps)

    const query = submitted as { format: Array<Record<string, unknown>> }
    expect(query.format).toHaveLength(2)
    // Both tag fields carry the label: Qencode echoes user_tag on the way back
    // (the one we match on), and tag is set too for accounts that echo there.
    expect(query.format[0]).toMatchObject({
      height: 1080,
      tag: "playback",
      user_tag: "playback",
    })
    expect(query.format[1]).toMatchObject({
      height: 360,
      tag: "analysis",
      user_tag: "analysis",
    })
  })

  it("skips the analysis output when disabled via height 0", async () => {
    enableNormalisation()
    vi.stubEnv("QENCODE_ANALYSIS_PROXY_HEIGHT", "0")
    const sf = makeSourceFile()
    const { supabase, updates } = makeUpdateSupabase(sf)
    let submitted: unknown
    const deps: NormalisationDeps = {
      createClient: () =>
        ({
          submitJob: async (query: unknown) => {
            submitted = query
            return "task-xyz"
          },
        }) as unknown as QencodeClient,
    }

    await startNormalisation(supabase, fakeStorage(), sf, deps)

    const query = submitted as { format: Array<Record<string, unknown>> }
    expect(query.format).toHaveLength(1)
    expect(updates[0]).toMatchObject({ analysis_proxy_storage_path: null })
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
  it("prefers our user_tag over Qencode's own system tag on each output", () => {
    // A real completed callback: Qencode stamps its own value into the system
    // `tag` field of every output and echoes the label we submitted into
    // `user_tag`. Reading `tag` first (the old behaviour) matched neither the
    // playback nor the analysis label, so the analysis proxy was never pulled.
    expect(
      parseQencodeCallback({
        task_token: "t",
        event: "saved",
        status: JSON.stringify({
          error: 0,
          videos: [
            {
              url: "https://storage.qencode.com/out.mp4",
              tag: "1080p_mp4",
              user_tag: "playback",
              height: 1080,
            },
            {
              url: "https://storage.qencode.com/out-360.mp4",
              tag: "360p_mp4",
              user_tag: "analysis",
              height: 360,
            },
          ],
        }),
      }),
    ).toEqual({
      taskToken: "t",
      outcome: "completed",
      errorMessage: undefined,
      videos: [
        {
          url: "https://storage.qencode.com/out.mp4",
          tag: "playback",
          height: 1080,
        },
        {
          url: "https://storage.qencode.com/out-360.mp4",
          tag: "analysis",
          height: 360,
        },
      ],
    })
  })

  it("falls back to the system tag when no user_tag was echoed", () => {
    const parsed = parseQencodeCallback({
      task_token: "t",
      event: "saved",
      status: JSON.stringify({
        error: 0,
        videos: [{ url: "https://storage.qencode.com/out.mp4", tag: "playback" }],
      }),
    })
    expect(parsed?.videos).toEqual([
      { url: "https://storage.qencode.com/out.mp4", tag: "playback", height: null },
    ])
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

describe("pickCallbackVideo", () => {
  const playback = { url: "p", tag: "playback", height: 1080 }
  const analysis = { url: "a", tag: "analysis", height: 360 }

  it("matches by (already user_tag-preferred) tag", () => {
    expect(pickCallbackVideo([playback, analysis], "playback")).toBe(playback)
    expect(pickCallbackVideo([playback, analysis], "analysis")).toBe(analysis)
  })

  it("falls back to height when tags are absent — tallest is playback, shortest analysis", () => {
    const p = { url: "p", tag: null, height: 1080 }
    const a = { url: "a", tag: null, height: 360 }
    // Order shuffled to prove it's height, not position, doing the work here.
    expect(pickCallbackVideo([a, p], "playback")).toBe(p)
    expect(pickCallbackVideo([a, p], "analysis")).toBe(a)
  })

  it("falls back to submission order for exactly two untagged, height-less outputs", () => {
    const first = { url: "first", tag: null, height: null }
    const second = { url: "second", tag: null, height: null }
    expect(pickCallbackVideo([first, second], "playback")).toBe(first)
    expect(pickCallbackVideo([first, second], "analysis")).toBe(second)
  })

  it("treats a lone output as playback-only, with no analysis proxy", () => {
    const only = { url: "only", tag: null, height: null }
    expect(pickCallbackVideo([only], "playback")).toBe(only)
    expect(pickCallbackVideo([only], "analysis")).toBeNull()
  })

  it("won't guess the analysis proxy from an unexpected output count", () => {
    // Three untagged, height-less outputs: trust only the required playback
    // pick, never risk pulling the wrong file as the analysis proxy.
    const vids = [
      { url: "0", tag: null, height: null },
      { url: "1", tag: null, height: null },
      { url: "2", tag: null, height: null },
    ]
    expect(pickCallbackVideo(vids, "playback")).toBe(vids[0])
    expect(pickCallbackVideo(vids, "analysis")).toBeNull()
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
      videos: [{ url: videoUrl, tag: "playback", height: 1080 }],
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

  it("also pulls the analysis proxy and records its path and size", async () => {
    const analysisPath = "user-1/vid-1/sf-1/proxy-360p.mp4"
    const analysisUrl = "https://storage.qencode.com/e207/out-360.mp4"
    const sf = makeSourceFile({
      normalisationStatus: "processing",
      proxyStoragePath: proxyPath,
      analysisProxyStoragePath: analysisPath,
    })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage(true)

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "completed",
      videos: [
        { url: videoUrl, tag: "playback", height: 1080 },
        { url: analysisUrl, tag: "analysis", height: 360 },
      ],
    })

    expect(storage.putObjectFromUrl).toHaveBeenCalledWith(
      analysisPath,
      analysisUrl,
      { contentType: "video/mp4" },
    )
    expect(updates[0]).toMatchObject({
      normalisation_status: "ready",
      analysis_proxy_storage_path: analysisPath,
      analysis_proxy_size_bytes: 2048,
    })
  })

  it("still completes normalisation when the analysis proxy pull fails, clearing its path", async () => {
    const analysisPath = "user-1/vid-1/sf-1/proxy-360p.mp4"
    const analysisUrl = "https://storage.qencode.com/e207/out-360.mp4"
    const sf = makeSourceFile({
      normalisationStatus: "processing",
      proxyStoragePath: proxyPath,
      analysisProxyStoragePath: analysisPath,
    })
    const { supabase, updates } = makeUpdateSupabase(sf)
    const storage = fakeStorage(true)
    storage.putObjectFromUrl = vi.fn(async (path: string) => {
      if (path === analysisPath) throw new Error("pull failed")
    })

    await applyNormalisationCallback(supabase, storage, sf, {
      taskToken: "task-1",
      outcome: "completed",
      videos: [
        { url: videoUrl, tag: "playback", height: 1080 },
        { url: analysisUrl, tag: "analysis", height: 360 },
      ],
    })

    // The analysis proxy is best-effort: the row still flips to ready, but
    // nothing may point at the object that never landed.
    expect(updates[0]).toMatchObject({
      normalisation_status: "ready",
      analysis_proxy_storage_path: null,
      analysis_proxy_size_bytes: null,
    })
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
      videos: [],
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
      videos: [{ url: videoUrl, tag: "playback", height: 1080 }],
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
      videos: [{ url: videoUrl, tag: "playback", height: 1080 }],
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
      videos: [{ url: videoUrl, tag: "playback", height: 1080 }],
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
      videos: [{ url: videoUrl, tag: "playback", height: 1080 }],
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
      videos: [],
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
      videos: [],
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
      videos: [],
    })

    expect(updates).toHaveLength(0)
  })
})
