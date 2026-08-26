import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  getDeepAnalysisProgress,
  getVideoProcessingStatus,
  listProcessingAnalysedVideoIds,
  shouldResumeDeepAnalysis,
} from "@/lib/retention-window-media-progress"
import type { SourceFile } from "@/lib/source-files/source-files"

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
    deepCreditsCharged: null,
    createdAt: "2026-06-30T00:00:00Z",
    updatedAt: "2026-06-30T00:00:00Z",
    ...overrides,
  }
}

// A minimal fake of the Supabase query builder that just serves canned rows
// per table, whatever filters the module under test chains onto the select.
function makeFakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe("getDeepAnalysisProgress", () => {
  it("reports every stage ready when there was nothing to harvest", async () => {
    const supabase = makeFakeSupabase({})
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      sceneCueScan: "ready",
      snapshots: "ready",
      snapshotAnalysis: "ready",
      audio: "ready",
      audioAnalysis: "ready",
      eventSynthesis: "ready",
    })
    expect(progress.complete).toBe(true)
  })

  it("reports the event synthesis stage in progress while a job is still pending", async () => {
    const supabase = makeFakeSupabase({
      retention_window_event_synthesis: [{ status: "pending" }],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({ eventSynthesis: "in_progress" })
    expect(progress.complete).toBe(false)
  })

  it("reports the event synthesis stage in progress while a worker holds the claim", async () => {
    const supabase = makeFakeSupabase({
      retention_window_event_synthesis: [{ status: "processing" }],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({ eventSynthesis: "in_progress" })
    expect(progress.complete).toBe(false)
  })

  it("reports an event synthesis stage failure when every job failed", async () => {
    const supabase = makeFakeSupabase({
      retention_window_event_synthesis: [{ status: "failed" }],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({ eventSynthesis: "failed" })
    expect(progress.complete).toBe(true)
  })

  it("reports snapshots as in-progress while its scene-cue scan is still pending, even though no snapshot rows exist yet", async () => {
    const supabase = makeFakeSupabase({
      retention_window_scene_cue_scans: [{ status: "pending" }],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      sceneCueScan: "in_progress",
      snapshots: "in_progress",
    })
    expect(progress.complete).toBe(false)
  })

  it("reports snapshot analysis as in-progress while its scene-cue scan is still pending, even though no snapshot rows exist yet", async () => {
    const supabase = makeFakeSupabase({
      retention_window_scene_cue_scans: [{ status: "pending" }],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      sceneCueScan: "in_progress",
      snapshots: "in_progress",
      snapshotAnalysis: "in_progress",
    })
    expect(progress.complete).toBe(false)
  })

  it("defers to the actual snapshot rows once every window's scene-cue scan has settled", async () => {
    const supabase = makeFakeSupabase({
      retention_window_scene_cue_scans: [{ status: "ready" }, { status: "ready" }],
      retention_window_snapshots: [
        { status: "ready", analysis_status: "pending" },
      ],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      sceneCueScan: "ready",
      snapshots: "ready",
    })
  })

  it("reports a scene-cue scan stage failure once every window's scan has been failed past its own retry grace period", async () => {
    const supabase = makeFakeSupabase({
      retention_window_scene_cue_scans: [
        { status: "failed", updated_at: "2020-01-01T00:00:00Z" },
      ],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      sceneCueScan: "failed",
      // The scan settled (as a failure), so a genuinely empty snapshot set
      // is read at face value rather than assumed still in flight.
      snapshots: "ready",
    })
  })

  it("reports the scene-cue scan stage as still in progress right after a fresh failure, not a settled X", async () => {
    const supabase = makeFakeSupabase({
      retention_window_scene_cue_scans: [
        { status: "failed", updated_at: new Date().toISOString() },
      ],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    // A scan that just failed is still eligible for its own automatic retry
    // (see SCAN_RETRY_STALE_MS) - the system hasn't given up on it yet, so
    // the checklist shouldn't show a red X for it before that grace period
    // has actually elapsed.
    expect(progress.stages).toMatchObject({
      sceneCueScan: "in_progress",
      snapshots: "in_progress",
    })
    expect(progress.complete).toBe(false)
  })

  it("shows the analysis stage in progress once extraction is ready but analysis hasn't run", async () => {
    const supabase = makeFakeSupabase({
      retention_window_snapshots: [
        { status: "ready", analysis_status: "pending" },
      ],
      retention_window_audio: [{ status: "ready", analysis_status: "pending" }],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      snapshots: "ready",
      snapshotAnalysis: "in_progress",
      audio: "ready",
      audioAnalysis: "in_progress",
    })
    expect(progress.complete).toBe(false)
  })

  it("shows the analysis stage still in progress while extraction itself is still pending", async () => {
    const supabase = makeFakeSupabase({
      retention_window_snapshots: [
        { status: "pending", analysis_status: "pending" },
      ],
      retention_window_audio: [],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      snapshots: "in_progress",
      snapshotAnalysis: "in_progress",
    })
  })

  it("fails the analysis stage for a row whose extraction failed, instead of leaving it pending forever", async () => {
    const supabase = makeFakeSupabase({
      retention_window_snapshots: [{ status: "failed", analysis_status: "pending" }],
      retention_window_audio: [],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      snapshots: "failed",
      snapshotAnalysis: "failed",
    })
    expect(progress.complete).toBe(true)
  })

  it("keeps the analysis stage in progress while a row is claimed ('processing') mid-LLM-call", async () => {
    const supabase = makeFakeSupabase({
      retention_window_snapshots: [
        { status: "ready", analysis_status: "processing" },
      ],
      retention_window_audio: [],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      snapshotAnalysis: "in_progress",
    })
    expect(progress.complete).toBe(false)
  })

  it("marks the analysis stage ready once every extracted row has been analysed", async () => {
    const supabase = makeFakeSupabase({
      retention_window_snapshots: [
        { status: "ready", analysis_status: "ready" },
        { status: "ready", analysis_status: "ready" },
      ],
      retention_window_audio: [{ status: "ready", analysis_status: "ready" }],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.stages).toMatchObject({
      snapshotAnalysis: "ready",
      audioAnalysis: "ready",
    })
    expect(progress.complete).toBe(true)
  })
})

// A fake that serves canned event-synthesis rows for the single
// "select ... .eq(user).in(analysed_video_id)" read this helper issues.
function makeProcessingFakeSupabase(rows: Record<string, unknown>[]) {
  return {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe("listProcessingAnalysedVideoIds", () => {
  it("returns an empty set (and issues no query) when there are no ready files", async () => {
    // A builder that throws if touched proves the short-circuit skips the query.
    const supabase = {
      from() {
        throw new Error("should not query when there are no ready files")
      },
    } as unknown as SupabaseClient

    const result = await listProcessingAnalysedVideoIds(supabase, "user-1", [])
    expect(result.size).toBe(0)
  })

  it("flags a video whose transcoding hasn't settled, regardless of synthesis rows", async () => {
    const supabase = makeProcessingFakeSupabase([
      { analysed_video_id: "av-1", status: "ready" },
    ])

    const result = await listProcessingAnalysedVideoIds(supabase, "user-1", [
      { analysedVideoId: "av-1", normalisationStatus: "processing" },
    ])
    expect(result.has("av-1")).toBe(true)
  })

  it("flags a video with a pending or processing synthesis row", async () => {
    const supabase = makeProcessingFakeSupabase([
      { analysed_video_id: "av-1", status: "ready" },
      { analysed_video_id: "av-1", status: "pending" },
      { analysed_video_id: "av-2", status: "processing" },
    ])

    const result = await listProcessingAnalysedVideoIds(supabase, "user-1", [
      { analysedVideoId: "av-1", normalisationStatus: "ready" },
      { analysedVideoId: "av-2", normalisationStatus: "ready" },
    ])
    expect(result.has("av-1")).toBe(true)
    expect(result.has("av-2")).toBe(true)
  })

  it("does not flag a video whose transcoding and synthesis have all settled", async () => {
    const supabase = makeProcessingFakeSupabase([
      { analysed_video_id: "av-1", status: "ready" },
      { analysed_video_id: "av-1", status: "failed" },
    ])

    const result = await listProcessingAnalysedVideoIds(supabase, "user-1", [
      { analysedVideoId: "av-1", normalisationStatus: "ready" },
    ])
    expect(result.has("av-1")).toBe(false)
  })

  it("does not flag a ready file with no synthesis rows at all", async () => {
    const supabase = makeProcessingFakeSupabase([])

    const result = await listProcessingAnalysedVideoIds(supabase, "user-1", [
      { analysedVideoId: "av-1", normalisationStatus: "skipped" },
    ])
    expect(result.has("av-1")).toBe(false)
  })
})

describe("shouldResumeDeepAnalysis", () => {
  it("resumes a pipeline stalled at snapshot extraction, not just at final synthesis", async () => {
    const supabase = makeFakeSupabase({
      retention_window_scene_cue_scans: [{ status: "ready" }],
      retention_window_snapshots: [
        { status: "pending", analysis_status: "pending" },
      ],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    // The stall the user hits: scene changes done, snapshots hung 'pending'.
    expect(progress.stages).toMatchObject({
      sceneCueScan: "ready",
      snapshots: "in_progress",
    })
    expect(shouldResumeDeepAnalysis(progress)).toBe(true)
  })

  it("resumes a pipeline whose only unsettled stage is event synthesis", async () => {
    const supabase = makeFakeSupabase({
      retention_window_event_synthesis: [{ status: "pending" }],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(shouldResumeDeepAnalysis(progress)).toBe(true)
  })

  it("does not resume once every stage has settled", async () => {
    const supabase = makeFakeSupabase({
      retention_window_snapshots: [
        { status: "ready", analysis_status: "ready" },
      ],
      retention_window_audio: [{ status: "ready", analysis_status: "ready" }],
    })
    const progress = await getDeepAnalysisProgress(
      supabase,
      "user-1",
      "av-1",
      makeSourceFile(),
    )

    expect(progress.complete).toBe(true)
    expect(shouldResumeDeepAnalysis(progress)).toBe(false)
  })

  it("does not resume when there is nothing to poll about yet", () => {
    expect(
      shouldResumeDeepAnalysis({ active: false, complete: true, stages: null }),
    ).toBe(false)
  })
})

describe("getVideoProcessingStatus", () => {
  it("flags every ready raw file and the subset still being deep-analysed", async () => {
    const supabase = makeFakeSupabase({
      source_files: [
        {
          analysed_video_id: "av-1",
          youtube_video_id: "vid-1",
          normalisation_status: "ready",
        },
        {
          analysed_video_id: "av-2",
          youtube_video_id: "vid-2",
          normalisation_status: "ready",
        },
        {
          analysed_video_id: "av-3",
          youtube_video_id: "vid-3",
          normalisation_status: "processing",
        },
      ],
      // av-1 has settled; av-2 is still synthesizing. av-3 is caught by its
      // unsettled transcoding instead.
      retention_window_event_synthesis: [
        { analysed_video_id: "av-1", status: "ready" },
        { analysed_video_id: "av-2", status: "pending" },
      ],
    })

    const status = await getVideoProcessingStatus(supabase, "user-1")

    // Every uploaded file earns the tick; only the unsettled ones spin.
    expect(status.rawFileVideoIds).toEqual(["vid-1", "vid-2", "vid-3"])
    expect(status.processingVideoIds).toEqual(["vid-2", "vid-3"])
  })

  it("reports nothing when the user has no ready raw files", async () => {
    const status = await getVideoProcessingStatus(makeFakeSupabase({}), "user-1")

    expect(status.rawFileVideoIds).toEqual([])
    expect(status.processingVideoIds).toEqual([])
  })
})
