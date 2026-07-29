import { createAdminClient } from "@/lib/supabase/admin"
import {
  analysisCostBucket,
  type CostType,
  type LlmCallType,
} from "@/lib/llm-call-types"
import { listProcessingAnalysedVideoIds } from "@/lib/retention-window-media-progress"
import type { NormalisationStatus } from "@/lib/source-files/source-files"
import type { VideoDetails } from "@/lib/youtube/youtube"

// Read-side helper for the admin user-detail "Video analysis" tab. Uses the
// service-role client (bypassing RLS) and MUST only be called from server code
// that has already verified the caller is an admin (see requireAdminUser).

export type AdminVideoAnalysis = {
  // analysed_videos row id.
  id: string
  // YouTube video id, so the row can link out to the source video.
  videoId: string
  title: string
  dateAnalysed: string
  // When the user uploaded the raw source file for this video (the prerequisite
  // for deep analysis), or null when no raw file has been uploaded yet.
  rawFileUploadedAt: string | null
  // Whether the deep-analysis pipeline is still running for this video — the raw
  // file has landed but the deeper analysis hasn't finished. Drives the admin
  // table's "Processing…" spinner.
  processing: boolean
  // Retention-window events synthesized for this video (0 when it has only had
  // light analysis, or deep analysis hasn't produced events yet).
  eventCount: number
  // What serving this video has cost (USD), split into the initial light
  // analysis and the opt-in deep dive. 0 when nothing has been logged against
  // the video for that bucket yet.
  lightCostUsd: number
  deepCostUsd: number
}

// Lists a user's analysed videos (most recently analysed first), each annotated
// with how many retention-window events its deep analysis produced. Event
// counts are resolved in one query and tallied per video in memory, so the
// listing stays a single round-trip regardless of how many videos there are.
export async function getUserVideoAnalyses(
  userId: string,
): Promise<AdminVideoAnalysis[]> {
  const supabase = createAdminClient()

  const [videos, events, costs, sourceFiles] = await Promise.all([
    supabase
      .from("analysed_videos")
      .select("id, video_id, video_title, date_analysed")
      .eq("user_id", userId)
      .order("date_analysed", { ascending: false }),
    supabase
      .from("retention_window_events")
      .select("analysed_video_id")
      .eq("user_id", userId),
    supabase
      .from("cost_logs")
      .select("analysed_video_id, cost_type, call_type, cost_usd")
      .eq("user_id", userId),
    supabase
      .from("source_files")
      .select("analysed_video_id, created_at, upload_status, normalisation_status")
      .eq("user_id", userId),
  ])

  if (videos.error) {
    throw new Error(`Failed to load analysed videos: ${videos.error.message}`)
  }
  if (events.error) {
    // Events are an optional enrichment — a failure there should still let the
    // video list render (with zero counts) rather than sink the tab.
    console.error("Failed to load retention events for user", events.error)
  }
  if (costs.error) {
    // Costs are likewise an enrichment — a failure leaves the list rendering
    // with zero spend rather than sinking the tab.
    console.error("Failed to load video costs for user", costs.error)
  }
  if (sourceFiles.error) {
    // Raw-file upload dates are an enrichment too — a failure leaves the list
    // rendering with blank upload dates rather than sinking the tab.
    console.error("Failed to load source files for user", sourceFiles.error)
  }

  const eventCounts = new Map<string, number>()
  for (const row of (events.error ? [] : (events.data ?? [])) as {
    analysed_video_id: string | null
  }[]) {
    if (!row.analysed_video_id) continue
    eventCounts.set(
      row.analysed_video_id,
      (eventCounts.get(row.analysed_video_id) ?? 0) + 1,
    )
  }

  // Tally each video's spend into its light/deep buckets in one pass. Rows with
  // no analysed_video_id (costs we couldn't attribute to a specific video) are
  // skipped rather than mis-assigned.
  const costTotals = new Map<string, { light: number; deep: number }>()
  for (const row of (costs.error ? [] : (costs.data ?? [])) as {
    analysed_video_id: string | null
    cost_type: CostType
    call_type: LlmCallType | null
    cost_usd: number | string
  }[]) {
    if (!row.analysed_video_id) continue
    const totals = costTotals.get(row.analysed_video_id) ?? {
      light: 0,
      deep: 0,
    }
    totals[analysisCostBucket(row.cost_type, row.call_type)] += Number(
      row.cost_usd,
    )
    costTotals.set(row.analysed_video_id, totals)
  }

  // Map each video to when its raw source file was uploaded. There's one source
  // file per analysed video, so the created_at doubles as the upload timestamp.
  // Ready source files are also collected so their deep-analysis progress can be
  // resolved in one bulk query below.
  const rawFileUploads = new Map<string, string>()
  const readyFiles: {
    analysedVideoId: string
    normalisationStatus: NormalisationStatus
  }[] = []
  for (const row of (sourceFiles.error ? [] : (sourceFiles.data ?? [])) as {
    analysed_video_id: string | null
    created_at: string
    upload_status: string
    normalisation_status: NormalisationStatus
  }[]) {
    if (!row.analysed_video_id) continue
    rawFileUploads.set(row.analysed_video_id, row.created_at)
    if (row.upload_status === "ready") {
      readyFiles.push({
        analysedVideoId: row.analysed_video_id,
        normalisationStatus: row.normalisation_status,
      })
    }
  }

  // Which of the ready-file videos are still being deep-analysed. Best-effort —
  // a failure here just leaves every row un-flagged rather than sinking the tab.
  let processingIds = new Set<string>()
  try {
    processingIds = await listProcessingAnalysedVideoIds(
      supabase,
      userId,
      readyFiles,
    )
  } catch (error) {
    console.error("Failed to load deep-analysis processing status", error)
  }

  return ((videos.data ?? []) as {
    id: string
    video_id: string
    video_title: string
    date_analysed: string
  }[]).map((row) => {
    const totals = costTotals.get(row.id)
    return {
      id: row.id,
      videoId: row.video_id,
      title: row.video_title,
      dateAnalysed: row.date_analysed,
      rawFileUploadedAt: rawFileUploads.get(row.id) ?? null,
      processing: processingIds.has(row.id),
      eventCount: eventCounts.get(row.id) ?? 0,
      lightCostUsd: totals?.light ?? 0,
      deepCostUsd: totals?.deep ?? 0,
    }
  })
}

// A single analysed video, keyed on its analysed_videos row UUID and scoped to
// the owning user, for the admin video detail page. `durationSeconds` comes
// from the stored YouTube video details and is used to derive the one-time
// transcoding cost of the video's proxies; it's null for legacy rows saved
// before those details were persisted.
export type AdminAnalysedVideo = {
  id: string
  videoId: string
  title: string
  dateAnalysed: string
  durationSeconds: number | null
}

// Loads one of a user's analysed videos by its row id, or null when no such row
// belongs to that user. The user_id predicate keeps the lookup scoped to the
// account the admin is viewing, so a mistyped/foreign id resolves to null (a
// 404) rather than surfacing another user's video.
export async function getUserAnalysedVideoById(
  userId: string,
  analysedVideoId: string,
): Promise<AdminAnalysedVideo | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("analysed_videos")
    .select("id, video_id, video_title, date_analysed, video_details")
    .eq("user_id", userId)
    .eq("id", analysedVideoId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load analysed video: ${error.message}`)
  }
  if (!data) return null

  const row = data as {
    id: string
    video_id: string
    video_title: string
    date_analysed: string
    video_details: VideoDetails | null
  }

  return {
    id: row.id,
    videoId: row.video_id,
    title: row.video_title,
    dateAnalysed: row.date_analysed,
    durationSeconds: row.video_details?.durationSeconds ?? null,
  }
}
