// Read/write helpers for the `analysed_videos` table. Analysing a video spends
// YouTube API quota, so we persist the full result here and replay it instead
// of re-fetching. All calls go through a user-scoped Supabase client, so Row
// Level Security guarantees a user only ever touches their own rows.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  cleanTranscriptCues,
  type RetentionPoint,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"

// A persisted analysis. The JSONB payloads mirror the YouTube/Analytics shapes
// we fetch; they are typed loosely-but-usefully here and will grow over time.
export interface AnalysedVideo {
  id: string
  userId: string
  videoId: string
  videoTitle: string
  dateAnalysed: string
  videoDetails: VideoDetails | null
  retention: RetentionPoint[] | null
  transcript: TranscriptCue[] | null
  rawAnalytics: Record<string, unknown> | null
}

// Raw row shape as returned by Supabase (snake_case columns).
interface AnalysedVideoRow {
  id: string
  user_id: string
  video_id: string
  video_title: string
  date_analysed: string
  video_details: VideoDetails | null
  retention: RetentionPoint[] | null
  transcript: TranscriptCue[] | null
  raw_analytics: Record<string, unknown> | null
}

const COLUMNS =
  "id, user_id, video_id, video_title, date_analysed, video_details, retention, transcript, raw_analytics"

function mapRow(row: AnalysedVideoRow): AnalysedVideo {
  return {
    id: row.id,
    userId: row.user_id,
    videoId: row.video_id,
    videoTitle: row.video_title,
    dateAnalysed: row.date_analysed,
    videoDetails: row.video_details,
    retention: row.retention,
    transcript: row.transcript,
    rawAnalytics: row.raw_analytics,
  }
}

export interface SaveAnalysedVideoInput {
  userId: string
  video: VideoDetails
  retention: RetentionPoint[]
  // Timestamped caption cues; omitted when the video has no captions.
  transcript?: TranscriptCue[]
  // Anything else we fetched that doesn't yet have a dedicated column.
  rawAnalytics?: Record<string, unknown>
}

// Upserts an analysis, keyed on (user_id, video_id) so re-analysing the same
// video refreshes the stored data and bumps `date_analysed`.
export async function saveAnalysedVideo(
  supabase: SupabaseClient,
  input: SaveAnalysedVideoInput,
): Promise<AnalysedVideo | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .upsert(
      {
        user_id: input.userId,
        video_id: input.video.id,
        video_title: input.video.title,
        date_analysed: new Date().toISOString(),
        video_details: input.video,
        retention: input.retention,
        // Keep the persistence boundary canonical even if a transcript comes
        // from a source that did not pass through the WebVTT parser.
        transcript: input.transcript
          ? cleanTranscriptCues(input.transcript)
          : null,
        raw_analytics: input.rawAnalytics ?? null,
      },
      { onConflict: "user_id,video_id" },
    )
    .select(COLUMNS)
    .single()

  if (error) {
    throw new Error(`Failed to save analysed video: ${error.message}`)
  }

  return data ? mapRow(data as AnalysedVideoRow) : null
}

// Lists a user's analysed videos, most recently analysed first.
export async function listAnalysedVideos(
  supabase: SupabaseClient,
  userId: string,
): Promise<AnalysedVideo[]> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("date_analysed", { ascending: false })

  if (error) {
    throw new Error(`Failed to load analysed videos: ${error.message}`)
  }

  return (data as AnalysedVideoRow[] | null)?.map(mapRow) ?? []
}

// Returns the set of video IDs the user has already analysed. Kept deliberately
// lightweight (IDs only) so the video list can flag analysed uploads across
// every page without pulling down the full payloads.
export async function listAnalysedVideoIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select("video_id")
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to load analysed video ids: ${error.message}`)
  }

  return (data as { video_id: string }[] | null)?.map((r) => r.video_id) ?? []
}

// Returns a cached transcript with the YouTube auto-caption rolling-window
// duplication collapsed and profanity bleep markers ("[ __ ]") replaced with
// "****".
// Rows analysed before either cleanup was added still hold the raw cues, so we
// heal them on read and persist the result back (best-effort) — fixing legacy
// analyses permanently without re-spending the YouTube quota a full re-analysis
// would cost. Only the transcript column is touched, so `date_analysed` and
// list ordering stay put.
export async function healCachedTranscript(
  supabase: SupabaseClient,
  userId: string,
  videoId: string,
  stored: TranscriptCue[] | null,
): Promise<TranscriptCue[]> {
  const cleaned = cleanTranscriptCues(stored ?? [])

  const before = (stored ?? []).map((cue) => cue.text).join("\n")
  const after = cleaned.map((cue) => cue.text).join("\n")
  if (before !== after) {
    const { error } = await supabase
      .from("analysed_videos")
      .update({ transcript: cleaned })
      .eq("user_id", userId)
      .eq("video_id", videoId)
    if (error) {
      // Healing is best-effort — never block serving the (cleaned) transcript
      // on a write failure; we'll simply re-clean it on the next read.
      console.error("Failed to persist healed transcript", error)
    }
  }

  return cleaned
}

// Fetches a single previously-analysed video, or null if it hasn't been
// analysed yet. Used to serve cached results without re-spending API quota.
export async function getAnalysedVideo(
  supabase: SupabaseClient,
  userId: string,
  videoId: string,
): Promise<AnalysedVideo | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("video_id", videoId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load analysed video: ${error.message}`)
  }

  return data ? mapRow(data as AnalysedVideoRow) : null
}
