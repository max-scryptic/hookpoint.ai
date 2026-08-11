// Undoing an analysis the user walked away from.
//
// Analysing a video is a long run of work that saves as it goes: the curve and
// the transcript are persisted early so nothing is fetched from YouTube twice,
// the monthly allowance is charged the moment that row lands, and the retention
// windows, pacing read and surface extras are written on top of it over the
// following minute. That is the right shape for a run that finishes. For a run
// the user leaves part-way through it is the wrong shape entirely: they are
// charged for an analysis, and left with a video in their library that reads as
// analysed while missing most of what makes it worth opening.
//
// So a run that is abandoned is undone rather than left standing. The analysed
// video the run created is deleted (every table hung off it cascades away with
// it) and the analysis it charged for is handed back, which puts the user
// exactly where they were before they pressed the button, free to press it again
// whenever they want the video analysed for real.
//
// Only ever this run's own work. Re-opening a video that was analysed before is
// served from that stored analysis and creates nothing, so there is nothing for
// an abandonment to undo: the rollback is limited to the row this run inserted
// itself.

import type { SupabaseClient } from "@supabase/supabase-js"

import { deleteAnalysedVideo } from "@/lib/analysed-videos"
import { refundUsage } from "@/lib/billing/entitlements"

// What one analysis run has created so far, filled in as it goes so that
// whatever the run has reached when the user leaves can be undone. Both fields
// stay null for a run served from a stored analysis, which spends nothing and
// creates nothing.
export interface AnalysisRunRecord {
  // The analysed video this run inserted, as opposed to one it found already
  // there. Null until the row lands.
  createdAnalysedVideoId: string | null
  // The usage window this run's analysis was charged to, or null when it was
  // never charged.
  chargedPeriodStart: Date | null
}

export function createAnalysisRunRecord(): AnalysisRunRecord {
  return { createdAnalysedVideoId: null, chargedPeriodStart: null }
}

// Rolls the run back. The refund follows the delete rather than accompanying it:
// only a rollback that actually removed the analysis hands the charge back, so
// a rollback that runs twice (the connection dropping and the run noticing can
// both trigger it) never credits an analysis twice. Best-effort, since this
// always runs on the way out of a request that is already over: a failure here
// is logged rather than raised at a user who has left.
export async function rollBackAnalysis(
  supabase: SupabaseClient,
  userId: string,
  run: AnalysisRunRecord,
): Promise<boolean> {
  if (!run.createdAnalysedVideoId) return false

  try {
    const deleted = await deleteAnalysedVideo(
      supabase,
      userId,
      run.createdAnalysedVideoId,
    )
    if (!deleted) return false
    run.createdAnalysedVideoId = null

    if (run.chargedPeriodStart) {
      await refundUsage(userId, run.chargedPeriodStart, { videoAnalyses: 1 })
      run.chargedPeriodStart = null
    }
    return true
  } catch (error) {
    console.error("Failed to roll back an abandoned video analysis", error)
    return false
  }
}
