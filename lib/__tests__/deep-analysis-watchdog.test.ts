import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  DEEP_ANALYSIS_GIVE_UP_ERROR,
  countUnsettledDeepAnalysisWork,
  planDeepAnalysisSweep,
} from "@/lib/deep-analysis-watchdog"

const NOW = Date.parse("2026-08-18T12:00:00.000Z")
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString()

// A stand-in for the service-role client that answers each table with whatever
// rows the test hands it. The PostgREST filters themselves aren't re-executed
// here — they're the database's job, and the schema they run against is the one
// thing a unit test can't stand in for — so each table's rows are given as the
// filtered set: "these are the rows still waiting on a stage".
function createAdminStub(
  tables: Record<string, Record<string, unknown>[]>,
): SupabaseClient {
  return {
    from(table: string) {
      const rows = tables[table] ?? []
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      Object.assign(builder, {
        select: chain,
        eq: chain,
        in: chain,
        or: chain,
        order: chain,
        limit: chain,
        then: (
          resolve: (result: {
            data: Record<string, unknown>[]
            count: number
            error: null
          }) => unknown,
        ) => Promise.resolve(resolve({ data: rows, count: rows.length, error: null })),
      })
      return builder
    },
  } as unknown as SupabaseClient
}

function unsettledSnapshotRows(
  videos: { userId: string; analysedVideoId: string }[],
) {
  return videos.map((video) => ({
    user_id: video.userId,
    analysed_video_id: video.analysedVideoId,
  }))
}

function sweepInput(params: {
  videos: { userId: string; analysedVideoId: string }[]
  readyVideoIds?: string[]
  normalisationStatus?: string
  runs?: Record<string, unknown>[]
}) {
  const readyVideoIds =
    params.readyVideoIds ?? params.videos.map((video) => video.analysedVideoId)
  return createAdminStub({
    retention_window_snapshots: unsettledSnapshotRows(params.videos),
    source_files: readyVideoIds.map((id) => ({
      analysed_video_id: id,
      normalisation_status: params.normalisationStatus ?? "ready",
    })),
    deep_analysis_pipeline_runs: params.runs ?? [],
  })
}

function run(overrides: Record<string, unknown>) {
  return {
    analysed_video_id: "video-1",
    status: "ready",
    error: null,
    started_at: minutesAgo(30),
    updated_at: minutesAgo(30),
    unsettled_after: null,
    ...overrides,
  }
}

describe("countUnsettledDeepAnalysisWork", () => {
  it("adds up the rows still waiting across every deep-analysis table", async () => {
    const admin = createAdminStub({
      retention_window_snapshots: [{}, {}],
      retention_window_audio: [{}],
      retention_window_scene_cue_scans: [],
      retention_window_event_synthesis: [{}, {}, {}],
      retention_window_transcripts: [{}],
    })

    await expect(
      countUnsettledDeepAnalysisWork(admin, "user-1", "video-1"),
    ).resolves.toBe(7)
  })
})

describe("planDeepAnalysisSweep", () => {
  it("resumes a video whose pass died and left its rows behind", async () => {
    // The production shape of the bug: a run killed mid-extraction, its lease
    // long since stale, and nothing on the server to pick the work back up.
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      runs: [
        run({
          status: "running",
          started_at: minutesAgo(20),
          updated_at: minutesAgo(19),
        }),
      ],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.resume.map((video) => video.analysedVideoId)).toEqual([
      "video-1",
    ])
    expect(sweep.abandon).toEqual([])
  })

  it("resumes a video no pass has ever run for", async () => {
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      runs: [],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.resume).toHaveLength(1)
    expect(sweep.resume[0]?.lastRunStartedAt).toBeNull()
  })

  it("leaves a video alone while a pass is genuinely working on it", async () => {
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      runs: [
        run({
          status: "running",
          started_at: minutesAgo(4),
          // A live pass bumps its lease on a heartbeat, so a fresh updated_at
          // means someone is still working — not a stall.
          updated_at: minutesAgo(0),
        }),
      ],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.resume).toEqual([])
    expect(sweep.skipped).toBe(1)
  })

  it("leaves a video alone in the moments after a hand-over", async () => {
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      runs: [run({ status: "paused", started_at: minutesAgo(0.5) })],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.resume).toEqual([])
    expect(sweep.skipped).toBe(1)
  })

  it("gives up on a video whose passes keep leaving the same work behind", async () => {
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      runs: [
        run({ started_at: minutesAgo(10), unsettled_after: 3 }),
        run({ started_at: minutesAgo(20), unsettled_after: 3 }),
        run({ started_at: minutesAgo(30), unsettled_after: 3 }),
      ],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.resume).toEqual([])
    expect(sweep.abandon.map((video) => video.analysedVideoId)).toEqual([
      "video-1",
    ])
  })

  it("keeps resuming a video that is still inching forward", async () => {
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      runs: [
        run({ started_at: minutesAgo(10), unsettled_after: 3 }),
        run({ started_at: minutesAgo(20), unsettled_after: 8 }),
        run({ started_at: minutesAgo(30), unsettled_after: 14 }),
      ],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.resume).toHaveLength(1)
    expect(sweep.abandon).toEqual([])
  })

  it("does not read killed passes as a lack of progress", async () => {
    // A pass killed mid-stage records nothing, so it says nothing either way —
    // counting it as a repeat reading would abandon a video that is simply
    // taking several invocations.
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      runs: [
        run({ started_at: minutesAgo(10), unsettled_after: null }),
        run({ started_at: minutesAgo(20), unsettled_after: null }),
        run({ started_at: minutesAgo(30), unsettled_after: 5 }),
      ],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.resume).toHaveLength(1)
    expect(sweep.abandon).toEqual([])
  })

  it("does not give up on a video that is still being transcoded", async () => {
    // A large master's extraction waits for the 360p proxy on purpose, so every
    // pass until the transcode lands leaves the same work behind. That's the
    // pipeline being patient, not a stuck video.
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      normalisationStatus: "processing",
      runs: [
        run({ started_at: minutesAgo(10), unsettled_after: 3 }),
        run({ started_at: minutesAgo(20), unsettled_after: 3 }),
        run({ started_at: minutesAgo(30), unsettled_after: 3 }),
      ],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.abandon).toEqual([])
    expect(sweep.resume).toHaveLength(1)
  })

  it("stops touching a video it has already given up on", async () => {
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      runs: [
        run({
          status: "failed",
          error: DEEP_ANALYSIS_GIVE_UP_ERROR,
          started_at: minutesAgo(15),
        }),
      ],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.resume).toEqual([])
    expect(sweep.abandon).toEqual([])
    expect(sweep.skipped).toBe(1)
  })

  it("ignores videos whose raw upload never landed", async () => {
    const admin = sweepInput({
      videos: [{ userId: "user-1", analysedVideoId: "video-1" }],
      readyVideoIds: [],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW })

    expect(sweep.resume).toEqual([])
  })

  it("takes the longest-stalled videos first, up to the tick's limit", async () => {
    const admin = sweepInput({
      videos: [
        { userId: "user-1", analysedVideoId: "video-recent" },
        { userId: "user-1", analysedVideoId: "video-old" },
      ],
      runs: [
        run({ analysed_video_id: "video-recent", started_at: minutesAgo(6) }),
        run({ analysed_video_id: "video-old", started_at: minutesAgo(90) }),
      ],
    })

    const sweep = await planDeepAnalysisSweep(admin, { now: NOW, limit: 1 })

    expect(sweep.resume.map((video) => video.analysedVideoId)).toEqual([
      "video-old",
    ])
  })
})
