import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { listResumableDeepAnalysisSourceFiles } from "@/lib/deep-analysis-resume"

interface SynthesisRow {
  analysed_video_id: string
  user_id: string
  status: string
}

interface RunRow {
  analysed_video_id: string
  status: string
  started_at: string
  updated_at: string
}

const MINUTE = 60 * 1000

function agoIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

// Fake covering the three reads the sweeper makes, each a flat
// `from(table).select(...)` chain with `.in`/`.eq`/`.limit` filters applied in
// memory. Records which analysed-video ids the final source_files lookup was
// asked for — that set is the sweeper's actual decision.
function makeFakeClient({
  synthesis,
  runs,
  readyVideoIds,
}: {
  synthesis: SynthesisRow[]
  runs: RunRow[]
  readyVideoIds: string[]
}): { client: SupabaseClient; requestedIds: string[] } {
  const requestedIds: string[] = []

  const client = {
    from(table: string) {
      const filters: { in?: string[]; eq: Record<string, unknown> } = { eq: {} }
      const builder = {
        select() {
          return builder
        },
        in(_col: string, values: string[]) {
          filters.in = values
          return builder
        },
        eq(col: string, val: unknown) {
          filters.eq[col] = val
          return builder
        },
        limit() {
          return builder
        },
        then(
          onFulfilled: (v: { data: unknown; error: null }) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) {
          let data: unknown = []
          if (table === "retention_window_event_synthesis") {
            data = synthesis
              .filter((row) =>
                filters.eq.user_id ? row.user_id === filters.eq.user_id : true,
              )
              .filter((row) => (filters.in ?? ["pending", "processing"]).includes(row.status))
              .map((row) => ({ analysed_video_id: row.analysed_video_id }))
          } else if (table === "deep_analysis_pipeline_runs") {
            data = runs.filter((row) =>
              (filters.in ?? []).includes(row.analysed_video_id),
            )
          } else if (table === "source_files") {
            const asked = filters.in ?? []
            requestedIds.push(...asked)
            data = asked
              .filter((id) => readyVideoIds.includes(id))
              .map((id) => ({
                id: `sf-${id}`,
                user_id: "user-1",
                analysed_video_id: id,
                youtube_video_id: `yt-${id}`,
                upload_status: "ready",
                normalisation_status: "ready",
              }))
          }
          return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { client, requestedIds }
}

describe("listResumableDeepAnalysisSourceFiles", () => {
  it("resumes a video whose lease went quiet mid-stage", async () => {
    // The production shape: extraction was killed by the invocation budget, so
    // the row still says 'running' but nothing has heartbeat it in hours.
    const { client, requestedIds } = makeFakeClient({
      synthesis: [{ analysed_video_id: "av-1", user_id: "user-1", status: "pending" }],
      runs: [
        {
          analysed_video_id: "av-1",
          status: "running",
          started_at: agoIso(180 * MINUTE),
          updated_at: agoIso(176 * MINUTE),
        },
      ],
      readyVideoIds: ["av-1"],
    })

    const files = await listResumableDeepAnalysisSourceFiles(client, { limit: 5 })

    expect(requestedIds).toEqual(["av-1"])
    expect(files.map((f) => f.analysedVideoId)).toEqual(["av-1"])
  })

  it("leaves a genuinely live pipeline alone", async () => {
    const { client, requestedIds } = makeFakeClient({
      synthesis: [{ analysed_video_id: "av-1", user_id: "user-1", status: "pending" }],
      runs: [
        {
          analysed_video_id: "av-1",
          status: "running",
          started_at: agoIso(2 * MINUTE),
          updated_at: agoIso(10 * 1000),
        },
      ],
      readyVideoIds: ["av-1"],
    })

    const files = await listResumableDeepAnalysisSourceFiles(client, { limit: 5 })

    expect(requestedIds).toEqual([])
    expect(files).toEqual([])
  })

  it("holds off on a video whose newest run is still within the cooldown", async () => {
    // Dead lease, but only just — re-kicking this fast races a pipeline that
    // may simply not have reached its first heartbeat.
    const { client } = makeFakeClient({
      synthesis: [{ analysed_video_id: "av-1", user_id: "user-1", status: "pending" }],
      runs: [
        {
          analysed_video_id: "av-1",
          status: "failed",
          started_at: agoIso(30 * 1000),
          updated_at: agoIso(30 * 1000),
        },
      ],
      readyVideoIds: ["av-1"],
    })

    expect(
      await listResumableDeepAnalysisSourceFiles(client, { limit: 5 }),
    ).toEqual([])
  })

  it("gives up on a video that has already been run into the ground", async () => {
    const runs: RunRow[] = Array.from({ length: 12 }, () => ({
      analysed_video_id: "av-1",
      status: "failed",
      started_at: agoIso(60 * MINUTE),
      updated_at: agoIso(60 * MINUTE),
    }))
    const { client } = makeFakeClient({
      synthesis: [{ analysed_video_id: "av-1", user_id: "user-1", status: "pending" }],
      runs,
      readyVideoIds: ["av-1"],
    })

    expect(
      await listResumableDeepAnalysisSourceFiles(client, { limit: 5 }),
    ).toEqual([])
  })

  it("resumes a video whose kickoff never claimed a lease at all", async () => {
    const { client } = makeFakeClient({
      synthesis: [{ analysed_video_id: "av-1", user_id: "user-1", status: "pending" }],
      runs: [],
      readyVideoIds: ["av-1"],
    })

    const files = await listResumableDeepAnalysisSourceFiles(client, { limit: 5 })

    expect(files.map((f) => f.analysedVideoId)).toEqual(["av-1"])
  })

  it("skips videos with no fully-uploaded source file to run against", async () => {
    const { client } = makeFakeClient({
      synthesis: [{ analysed_video_id: "av-1", user_id: "user-1", status: "pending" }],
      runs: [],
      readyVideoIds: [],
    })

    expect(
      await listResumableDeepAnalysisSourceFiles(client, { limit: 5 }),
    ).toEqual([])
  })

  it("caps how many videos one sweep takes on", async () => {
    const ids = ["av-1", "av-2", "av-3", "av-4"]
    const { client } = makeFakeClient({
      synthesis: ids.map((id) => ({
        analysed_video_id: id,
        user_id: "user-1",
        status: "pending",
      })),
      runs: [],
      readyVideoIds: ids,
    })

    const files = await listResumableDeepAnalysisSourceFiles(client, { limit: 2 })

    expect(files).toHaveLength(2)
  })

  it("narrows to one account when a user id is given", async () => {
    const { client } = makeFakeClient({
      synthesis: [
        { analysed_video_id: "av-1", user_id: "user-1", status: "pending" },
        { analysed_video_id: "av-2", user_id: "user-2", status: "pending" },
      ],
      runs: [],
      readyVideoIds: ["av-1", "av-2"],
    })

    const files = await listResumableDeepAnalysisSourceFiles(client, {
      userId: "user-1",
      limit: 5,
    })

    expect(files.map((f) => f.analysedVideoId)).toEqual(["av-1"])
  })

  it("does nothing when no synthesis job is outstanding", async () => {
    const { client } = makeFakeClient({
      synthesis: [{ analysed_video_id: "av-1", user_id: "user-1", status: "ready" }],
      runs: [],
      readyVideoIds: ["av-1"],
    })

    expect(
      await listResumableDeepAnalysisSourceFiles(client, { limit: 5 }),
    ).toEqual([])
  })
})
