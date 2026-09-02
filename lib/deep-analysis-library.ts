import type { SupabaseClient } from "@supabase/supabase-js"

import type { OnboardingHint } from "@/lib/onboarding-hints"

// The size of an account's deep-analysis library, and the thresholds the
// features built on top of it open at. Both are all-or-nothing: the feature is
// shut, with a meter counting toward it, until the library is big enough to
// carry it, and then it opens whole.
//
// A video counts as deeply analysed once its event synthesis has completed for
// at least one window. That is the same signal Channel Trends grows its library
// from (loadLibrarySize in lib/channel-trends.ts) and the compare picker filters
// on (listComparableVideos in lib/retention-comparison.ts), so all three agree
// on what "in the library" means.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments included).
// Hyphens are fine.

// How many deeply analysed videos Channel Trends needs before it opens. One
// threshold, not a ladder: a trend read off three videos is one upload
// speaking for the whole channel, and a page that hedges its own findings as
// "leads, not verdicts" teaches a creator to discount everything on it. Six is
// where the band-split views stop being a rounding exercise, since six covered
// videos put three above the median and three below it, so the top band, the
// bottom band and the middle line each have real shape. Below it the page
// shows the meter counting up and nothing else.
export const CHANNEL_TRENDS_VIDEO_THRESHOLD = 6

// How many deeply analysed videos the Video Planner needs before it opens. A
// plan reads an unpublished cut against the channel it is going out on, so the
// verdicts it gives are only as good as the library underneath them: with a
// handful of videos, "your hooks tend to" is one upload speaking for the whole
// channel. Ten is where the packaging and retention patterns the plan is
// grounded in carry real weight.
//
// Deliberately higher than CHANNEL_TRENDS_VIDEO_THRESHOLD above: trends lay
// out what recurs and leave the creator to weigh it against the video in front
// of them, a plan answers one question with one verdict and has no such room.
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

// What an account's plan lets it reach, for each library-gated feature. A gate
// has not opened for an account whose plan does not carry what is behind it,
// whatever its library says: Channel Trends rides on the deep credits budget
// (see app/(app)/channel-trends/page.tsx) and a plan needs uploads to be made
// at all (see app/(app)/video-planner/page.tsx).
export interface LibraryFeatureReach {
  canReadTrends: boolean
  canPlanVideos: boolean
}

// The gates this library has opened, as the one-time hints that announce them,
// earliest gate first.
//
// Says what has opened, not what is worth saying: a gate crossed long ago is
// returned here every time, and it is the hint's own record of having been met
// that stops it being announced twice (see app/(app)/layout.tsx).
export function earnedLibraryUnlocks(
  libraryVideoCount: number,
  reach: LibraryFeatureReach,
): OnboardingHint[] {
  const earned: OnboardingHint[] = []
  if (reach.canReadTrends && libraryVideoCount >= CHANNEL_TRENDS_VIDEO_THRESHOLD) {
    earned.push("channel_trends_unlocked")
  }
  if (reach.canPlanVideos && libraryVideoCount >= VIDEO_PLANNER_VIDEO_THRESHOLD) {
    earned.push("video_planner_unlocked")
  }
  return earned
}
