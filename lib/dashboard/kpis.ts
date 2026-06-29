// Aggregates the headline numbers shown on the dashboard index. Everything is
// scoped to a single user through their RLS-enforced Supabase client, so the
// counts only ever reflect that user's own data.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  detectRetentionGains,
  type DropOff,
  type RetentionPoint,
} from "@/lib/youtube/youtube"

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
  // Total detected drop-off points across every saved video analysis.
  dropOffsDetected: number
  // Total rising retention regions across every saved video analysis.
  retentionGainsDetected: number
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
  // Pull the duration and retention insight payloads used by the headline
  // totals. Deep-analysis length is recorded separately against source files.
  const [analysed, deep] = await Promise.all([
    supabase
      .from("analysed_videos")
      .select("duration:video_details->durationSeconds, drop_offs, retention")
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
  // Deep analysis is an optional enhancement. In particular, deployments can
  // briefly have analysed-video data before the source-files migration has
  // been applied. Do not hide the core KPIs in that case; report zero for the
  // deep-analysis duration and keep the full error visible in server logs.
  if (deep.error) {
    console.error("Failed to load deep-analysis KPIs", deep.error)
  }

  const analysedRows = (analysed.data ?? []) as {
    duration: number | null
    drop_offs: DropOff[] | null
    retention: RetentionPoint[] | null
  }[]
  const deepRows = (deep.error ? [] : (deep.data ?? [])) as {
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
    dropOffsDetected: analysedRows.reduce(
      (sum, row) => sum + (Array.isArray(row.drop_offs) ? row.drop_offs.length : 0),
      0,
    ),
    retentionGainsDetected: analysedRows.reduce(
      (sum, row) =>
        sum +
        (Array.isArray(row.retention)
          ? detectRetentionGains(row.retention).length
          : 0),
      0,
    ),
  }
}
