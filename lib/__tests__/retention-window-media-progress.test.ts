import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getDeepAnalysisProgress } from "@/lib/retention-window-media-progress"
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

// A minimal fake of the Supabase query builder that just serves canned rows
// for the three "select status[, analysis_status]" reads this module issues.
function makeFakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
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
    })
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

  it("reports a scene-cue scan stage failure when every window's scan failed", async () => {
    const supabase = makeFakeSupabase({
      retention_window_scene_cue_scans: [{ status: "failed" }],
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
