import type { SupabaseClient } from "@supabase/supabase-js"

// The size of an account's deep-analysis library, and the thresholds the
// features built on top of it open at.
//
// A video counts as deeply analysed once its event synthesis has completed for
// at least one window. That is the same signal Channel Trends grows its library
// from (loadLibrarySize in lib/channel-trends.ts) and the compare picker filters
// on (listComparableVideos in lib/retention-comparison.ts), so all three agree
// on what "in the library" means.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments included).
// Hyphens are fine.

// How many deeply analysed videos the Video Planner needs before it opens. A
// plan reads an unpublished cut against the channel it is going out on, so the
// verdicts it gives are only as good as the library underneath them: with a
// handful of videos, "your hooks tend to" is one upload speaking for the whole
// channel. Ten is where the packaging and retention patterns the plan is
// grounded in carry real weight.
//
// Deliberately higher than the Channel Trends thresholds
// (EARLY_TRENDS_VIDEO_THRESHOLD, ESTABLISHED_TRENDS_VIDEO_THRESHOLD in
// lib/channel-trends.ts): trends can show a thin read labelled as an early
// signal and let the creator weigh it, a plan answers one question with one
// verdict and has no such room.
export const VIDEO_PLANNER_VIDEO_THRESHOLD = 10

// How many distinct videos this account has deeply analysed. Counted from the
// synthesis jobs rather than the events, so a video whose windows produced no
// events still counts: the analysis ran, and the library grew.
export async function countDeeplyAnalysedVideos(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("retention_window_event_synthesis")
    .select("analysed_video_id")
    .eq("user_id", userId)
    .eq("status", "ready")

  if (error) {
    throw new Error(`Failed to count deeply analysed videos: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as { analysed_video_id: string }[]
  return new Set(rows.map((row) => row.analysed_video_id)).size
}
