// Aggregates the headline numbers shown on the dashboard index. Everything is
// scoped to a single user through their RLS-enforced Supabase client, so the
// counts only ever reflect that user's own data.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface DashboardKpis {
  // How many videos the user has analysed (rows in `analysed_videos`).
  videosAnalysed: number
  // Total length, in seconds, of every analysed video. Summed from the duration
  // captured at analyse time; rendered as minutes in the UI.
  secondsAnalysed: number
  // Total length, in seconds, of the videos the user has deeply analysed by
  // uploading a source file. Same video length, but only counted once a raw file
  // has actually landed in storage for that video.
  secondsDeeplyAnalysed: number
}

// Upload states where the raw bytes have genuinely landed in storage — i.e. the
// user really did upload a source file for deep analysis. "pending"/"uploading"
// haven't landed yet and "failed" never will, so none of those count.
const DEEP_ANALYSIS_UPLOAD_STATES = ["uploaded", "processing", "ready"]

// Treats a missing/garbage duration as zero so it neither inflates nor breaks
// the running total.
function toSeconds(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0
}

export async function getDashboardKpis(
  supabase: SupabaseClient,
  userId: string,
): Promise<DashboardKpis> {
  // Pull just the durations we need rather than the full payload rows: the
  // analysed-video length lives inside the `video_details` JSONB, and the deeply
  // analysed length is the YouTube duration recorded against each source file.
  const [analysed, deep] = await Promise.all([
    supabase
      .from("analysed_videos")
      .select("duration:video_details->durationSeconds")
      .eq("user_id", userId),
    supabase
      .from("source_files")
      .select("youtube_duration_seconds")
      .eq("user_id", userId)
      .in("upload_status", DEEP_ANALYSIS_UPLOAD_STATES),
  ])

  if (analysed.error) {
    throw new Error(
      `Failed to load analysed-video KPIs: ${analysed.error.message}`,
    )
  }
  if (deep.error) {
    throw new Error(`Failed to load deep-analysis KPIs: ${deep.error.message}`)
  }

  const analysedRows = (analysed.data ?? []) as { duration: number | null }[]
  const deepRows = (deep.data ?? []) as {
    youtube_duration_seconds: number | null
  }[]

  return {
    videosAnalysed: analysedRows.length,
    secondsAnalysed: analysedRows.reduce(
      (sum, row) => sum + toSeconds(row.duration),
      0,
    ),
    secondsDeeplyAnalysed: deepRows.reduce(
      (sum, row) => sum + toSeconds(row.youtube_duration_seconds),
      0,
    ),
  }
}
