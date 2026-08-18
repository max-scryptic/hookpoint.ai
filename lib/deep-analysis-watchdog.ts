// The server-side answer to "who finishes a deep analysis nobody is watching?"
//
// A pipeline pass runs inside one serverless invocation. When that invocation
// is killed mid-stage (a large video's extraction routinely outlives its
// budget) the run row is left 'running' until the staleness sweep reclaims it,
// and its unfinished rows sit 'pending' with nothing left to claim them. The
// only thing that ever picked them back up was a browser polling
// /api/videos/:id/analysis-progress — so an analysis finished only if its owner
// happened to sit on (or come back to) the report page. Production runs show
// exactly that: a run dying in `extraction`, no activity for eight minutes, then
// a 19-second run — the one the returning user's poll kicked off — finishing
// everything.
//
// This module is the sweep that replaces that user. It answers two questions
// against the same tables the report page's progress checklist reads:
//   • which videos still have unsettled deep-analysis work, and
//   • which of those have nothing working on them right now,
// so a caller (the cron endpoint, /api/cron/resume-deep-analysis) can resume
// them. It also decides when to stop: a video whose last few passes each left
// exactly the same amount of work behind isn't stalled any more, it's stuck, and
// silently re-running it forever would burn money to no effect.

import type { SupabaseClient } from "@supabase/supabase-js"

import { DEEP_ANALYSIS_STALE_RUN_MS } from "@/lib/deep-analysis-pipeline-runs"

// Don't re-kick a video whose pass started moments ago. A pass claims the
// pipeline lease as its first act, so an overlapping kick is already a no-op —
// this just keeps the sweep from generating pointless invocations while a
// continuation chain is mid-hand-over.
export const DEEP_ANALYSIS_RESUME_COOLDOWN_MS = 90_000

// How many consecutive settled passes may leave exactly the same amount of work
// behind before the sweep gives up on the video. Two identical readings could be
// a pass that was paused before it reached the stuck stage; three in a row means
// the remaining rows aren't ones any stage can claim (a deleted source file, a
// window whose media never materialised), and no amount of re-running changes
// that.
export const DEEP_ANALYSIS_NO_PROGRESS_RUNS = 3

// Recorded on the run the sweep gives up on, so the report page shows its retry
// prompt (the same one a genuinely failed pipeline gets) instead of a spinner
// that would now never resolve.
export const DEEP_ANALYSIS_GIVE_UP_ERROR =
  "Deep analysis stopped making progress and was abandoned"

// How many videos one sweep may act on. Each becomes its own invocation, so
// this caps the fan-out of a single tick rather than the total backlog — a
// deeper backlog is worked off over successive ticks.
export const DEEP_ANALYSIS_SWEEP_LIMIT = 5

// How many rows per table one sweep pulls while looking for unsettled work.
// Ordered newest-first, so a large backlog of long-abandoned rows can't crowd
// out the video that stalled a minute ago.
const CANDIDATE_ROW_LIMIT = 1000

// A snapshot row is unsettled while its extraction is in flight, and also while
// an extracted row still has AI analysis to come. Expressed as a PostgREST `or`
// filter so the count happens in the database rather than by pulling rows.
const MEDIA_UNSETTLED_FILTER =
  "status.in.(pending,processing),and(status.eq.ready,analysis_status.in.(pending,processing))"

interface CandidateSource {
  table: string
  // Applied as `.or(...)` when set, otherwise the plain status filter below.
  or?: string
  column?: string
  states?: string[]
}

// Every table the pipeline leaves rows in, with what "not settled yet" means in
// each. Deliberately the same set of stages the report page's checklist derives
// its per-stage statuses from (see getDeepAnalysisProgress), so the sweep's idea
// of "unfinished" and the user's idea of "still processing" cannot drift apart.
const CANDIDATE_SOURCES: CandidateSource[] = [
  { table: "retention_window_snapshots", or: MEDIA_UNSETTLED_FILTER },
  { table: "retention_window_audio", or: MEDIA_UNSETTLED_FILTER },
  {
    table: "retention_window_scene_cue_scans",
    column: "status",
    states: ["pending", "processing"],
  },
  {
    table: "retention_window_event_synthesis",
    column: "status",
    states: ["pending", "processing"],
  },
  {
    table: "retention_window_transcripts",
    column: "taxonomy_status",
    states: ["pending", "processing"],
  },
]

export interface StalledDeepAnalysis {
  userId: string
  analysedVideoId: string
  // Rows still waiting on a stage, across every deep-analysis table.
  unsettledRows: number
  // When the most recent pass for this video started, or null if none ever ran
  // — a video whose trigger never fired at all, which the sweep also rescues.
  lastRunStartedAt: string | null
}

export interface DeepAnalysisSweep {
  // Videos to resume now, oldest stall first.
  resume: StalledDeepAnalysis[]
  // Videos whose recent passes made no progress at all: nothing left to try, so
  // they're marked failed for the owner to retry by hand.
  abandon: StalledDeepAnalysis[]
  // Candidates deliberately left alone this tick (a live lease, the cooldown, or
  // an earlier give-up). Reported so the endpoint's log says why a stuck-looking
  // video wasn't touched.
  skipped: number
}

interface PipelineRunRow {
  analysed_video_id: string
  status: string
  error: string | null
  started_at: string
  updated_at: string
  unsettled_after: number | null
}

// Counts the rows still waiting on some stage of this video's deep analysis.
// Zero means the pipeline has genuinely finished (every row settled, ready or
// failed) — the same condition the report page reads as a complete checklist.
export async function countUnsettledDeepAnalysisWork(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<number> {
  const counts = await Promise.all(
    CANDIDATE_SOURCES.map(async (source) => {
      let query = supabase
        .from(source.table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("analysed_video_id", analysedVideoId)
      query = source.or
        ? query.or(source.or)
        : query.in(source.column as string, source.states as string[])
      const { count, error } = await query
      if (error) {
        throw new Error(
          `Failed to count unsettled ${source.table} rows: ${error.message}`,
        )
      }
      return count ?? 0
    }),
  )
  return counts.reduce((total, count) => total + count, 0)
}

// Every video with deep-analysis rows still waiting on a stage, paired with the
// user who owns it. Service-role only: the whole point is to see across users,
// none of whom is present to ask.
async function listVideosWithUnsettledWork(
  admin: SupabaseClient,
): Promise<Map<string, { userId: string; unsettledRows: number }>> {
  const videos = new Map<string, { userId: string; unsettledRows: number }>()

  for (const source of CANDIDATE_SOURCES) {
    let query = admin
      .from(source.table)
      .select("user_id, analysed_video_id")
      .order("updated_at", { ascending: false })
      .limit(CANDIDATE_ROW_LIMIT)
    query = source.or
      ? query.or(source.or)
      : query.in(source.column as string, source.states as string[])
    const { data, error } = await query
    if (error) {
      throw new Error(
        `Failed to list unsettled ${source.table} rows: ${error.message}`,
      )
    }
    for (const row of (data ?? []) as {
      user_id: string
      analysed_video_id: string
    }[]) {
      const existing = videos.get(row.analysed_video_id)
      if (existing) existing.unsettledRows += 1
      else
        videos.set(row.analysed_video_id, {
          userId: row.user_id,
          unsettledRows: 1,
        })
    }
  }

  return videos
}

// The most recent runs per video, newest first, for the candidates in play.
async function listRecentRunsByVideo(
  admin: SupabaseClient,
  analysedVideoIds: string[],
): Promise<Map<string, PipelineRunRow[]>> {
  const runsByVideo = new Map<string, PipelineRunRow[]>()
  if (analysedVideoIds.length === 0) return runsByVideo

  const columns = "analysed_video_id, status, error, started_at, updated_at"
  const select = (selection: string) =>
    admin
      .from("deep_analysis_pipeline_runs")
      .select(selection)
      .in("analysed_video_id", analysedVideoIds)
      .order("started_at", { ascending: false })
      .limit(analysedVideoIds.length * 20)

  let result = await select(`${columns}, unsettled_after`)
  // unsettled_after arrives with the autonomous-completion migration, and code
  // and schema don't deploy in lockstep. Without it the sweep simply can't tell
  // a stuck video from a slow one, so it keeps resuming rather than giving up —
  // the same behaviour as before this column existed.
  if (
    result.error &&
    (result.error.code === "42703" || result.error.code === "PGRST200")
  ) {
    result = await select(columns)
  }
  if (result.error) {
    throw new Error(`Failed to list deep analysis runs: ${result.error.message}`)
  }

  for (const run of (result.data ?? []) as unknown as PipelineRunRow[]) {
    const runs = runsByVideo.get(run.analysed_video_id)
    if (runs) runs.push(run)
    else runsByVideo.set(run.analysed_video_id, [run])
  }
  return runsByVideo
}

// Whether the last few settled passes each left exactly the same amount of work
// behind. A pass records what it couldn't finish (`unsettled_after`), so equal
// readings across consecutive passes mean the remaining rows are ones no stage
// can claim — re-running is pure cost. Passes that recorded nothing (killed
// before they could) say nothing either way and are ignored rather than counted
// as no-progress.
function hasStoppedMakingProgress(runs: PipelineRunRow[]): boolean {
  const readings: number[] = []
  for (const run of runs) {
    if (run.status === "running") continue
    if (run.unsettled_after == null) continue
    readings.push(run.unsettled_after)
    if (readings.length === DEEP_ANALYSIS_NO_PROGRESS_RUNS) break
  }
  if (readings.length < DEEP_ANALYSIS_NO_PROGRESS_RUNS) return false
  return readings.every((reading) => reading > 0 && reading === readings[0])
}

// Finds every video whose deep analysis is unfinished and unattended, and sorts
// them into the ones worth resuming and the ones worth giving up on.
//
// Left alone: a video with a live pipeline lease (something is working on it), a
// video whose pass started within the cooldown, and one already given up on —
// that last one waits for its owner's explicit retry rather than being ground
// through the same failure every five minutes.
export async function planDeepAnalysisSweep(
  admin: SupabaseClient,
  options: { limit?: number; now?: number } = {},
): Promise<DeepAnalysisSweep> {
  const limit = options.limit ?? DEEP_ANALYSIS_SWEEP_LIMIT
  const now = options.now ?? Date.now()

  const unsettled = await listVideosWithUnsettledWork(admin)
  if (unsettled.size === 0) return { resume: [], abandon: [], skipped: 0 }

  const analysedVideoIds = [...unsettled.keys()]
  // Only videos whose raw file actually landed can be deep-analysed at all;
  // rows for a video whose upload never completed are waiting on the upload,
  // not on us.
  const { data: files, error: filesError } = await admin
    .from("source_files")
    .select("analysed_video_id, normalisation_status")
    .eq("upload_status", "ready")
    .in("analysed_video_id", analysedVideoIds)
  if (filesError) {
    throw new Error(
      `Failed to list source files for the deep analysis sweep: ${filesError.message}`,
    )
  }
  const readyFiles = new Map(
    (
      (files ?? []) as {
        analysed_video_id: string
        normalisation_status: string
      }[]
    ).map((file) => [file.analysed_video_id, file.normalisation_status]),
  )
  const readyVideoIds = new Set(readyFiles.keys())

  const runsByVideo = await listRecentRunsByVideo(admin, [...readyVideoIds])

  const resume: StalledDeepAnalysis[] = []
  const abandon: StalledDeepAnalysis[] = []
  let skipped = 0

  for (const [analysedVideoId, { userId, unsettledRows }] of unsettled) {
    if (!readyVideoIds.has(analysedVideoId)) continue

    const runs = runsByVideo.get(analysedVideoId) ?? []
    const latest = runs[0] ?? null
    const candidate: StalledDeepAnalysis = {
      userId,
      analysedVideoId,
      unsettledRows,
      lastRunStartedAt: latest?.started_at ?? null,
    }

    if (latest) {
      const leaseAlive =
        latest.status === "running" &&
        now - new Date(latest.updated_at).getTime() < DEEP_ANALYSIS_STALE_RUN_MS
      const withinCooldown =
        now - new Date(latest.started_at).getTime() <
        DEEP_ANALYSIS_RESUME_COOLDOWN_MS
      const alreadyAbandoned =
        latest.status === "failed" && latest.error === DEEP_ANALYSIS_GIVE_UP_ERROR
      if (leaseAlive || withinCooldown || alreadyAbandoned) {
        skipped++
        continue
      }
      // A video still being transcoded is a special case of "no progress": a
      // large master's extraction deliberately waits for the 360p proxy, so
      // every pass until the transcode lands leaves exactly the same work
      // behind. That's the pipeline doing the right thing, not a stuck video —
      // giving up on it would fail an analysis that was always going to start
      // late.
      const transcodeInFlight =
        readyFiles.get(analysedVideoId) === "pending" ||
        readyFiles.get(analysedVideoId) === "processing"
      if (!transcodeInFlight && hasStoppedMakingProgress(runs)) {
        abandon.push(candidate)
        continue
      }
    }

    resume.push(candidate)
  }

  // Oldest stall first: a video nothing has touched for an hour matters more
  // than one whose pass ended two minutes ago, and a video that never ran at
  // all (no run timestamp) matters most.
  resume.sort((a, b) => runRank(a) - runRank(b))

  return { resume: resume.slice(0, limit), abandon, skipped }
}

function runRank(candidate: StalledDeepAnalysis): number {
  return candidate.lastRunStartedAt
    ? new Date(candidate.lastRunStartedAt).getTime()
    : 0
}
