// Undoing an abandoned comparison run.
//
// Generating a head-to-head charges the creator up front and saves the pair
// before a word of it is written: the row has to exist for the three reports to
// be written onto, and the charge has to be taken before the work starts so a
// pair cannot be generated for free. That trade is only fair while the run
// finishes. If the creator closes the tab or navigates away mid-run, the work
// stops where it stands and they are left with a paid-for pair in their history
// that opens onto an empty report, which is worse than having pressed nothing at
// all.
//
// So an abandoned run is rolled back to exactly the state the creator was in
// before they pressed the button: the row this run created is deleted, and the
// credits it charged are handed back. Whatever it charged, which for a paid
// creator's first ever comparison is nothing at all: that one is free, so
// undoing it hands back nothing and leaves the free one unspent, which is
// exactly where they were. Only this run's own row is ever touched.
// Pressing the button on a pair that already existed (which is free, and fills
// in a missing section) leaves that pair alone, because that pair is what the
// creator had before they pressed.
//
// Three things can report an abandonment, and they overlap on purpose:
//
//   1. The creator's browser, on its way out of the page (see the picker).
//   2. The generate endpoint itself, when it notices the connection has gone.
//   3. A sweep on the next page load, for the runs neither of the above got to
//      report: a browser that was killed outright, or a deploy that went away
//      mid-write.
//
// Overlapping is safe because the delete is what decides. Only the report that
// actually removes a row hands the credits back, so an abandonment reported
// twice refunds once.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import { getEntitlement, refundUsage } from "@/lib/billing/entitlements"
import { comparisonRefundCredits } from "@/lib/plans"
import {
  deleteAbandonedComparisons,
  deleteComparison,
  deleteComparisonCreatedSince,
} from "@/lib/video-comparisons"

// Hands back the credits one abandoned comparison was charged. The charge went
// against whichever usage window was current when the row was created: for a run
// abandoned moments ago that is simply the window that is current now. A row
// created in a window that has since rolled over is left unrefunded, since its
// tally no longer gates anything the creator can spend.
//
// The amount is whatever that run actually paid, never a flat assumption. A paid
// creator's first ever comparison is free (see comparisonCreditCost), and a run
// that spent nothing must get nothing back: refunding the flat cost for it would
// mint credits out of a button press, over and over, since the rolled-back row
// is deleted and the next press is free again.
async function refundComparisonCredits(
  userId: string,
  chargedAt: Date,
  credits: number,
): Promise<void> {
  if (credits <= 0) return
  const entitlement = await getEntitlement(userId)
  if (chargedAt.getTime() < entitlement.periodStart.getTime()) return
  await refundUsage(userId, entitlement.periodStart, {
    deepCredits: credits,
  })
}

// Rolls back a run that this server started and is giving up on: the row it
// created goes, and the credits it charged go back. Returns whether it undid
// anything, so the caller can tell a rollback from a no-op (someone else got
// there first). Best-effort by design: this runs on the way out of a request
// that has already gone wrong, so a failure here is logged rather than raised
// over whatever the caller is already dealing with.
export async function rollBackComparison(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  // What the run charged for this pair and when, or null when it never charged:
  // a pair that already existed re-opens for free, the first comparison a paid
  // creator generates is free, and a metering hiccup is deliberately not fatal
  // to a generate. Nothing to refund in any of those cases.
  charge: ComparisonCharge | null,
): Promise<boolean> {
  try {
    const deleted = await deleteComparison(supabase, userId, comparisonId)
    if (!deleted) return false
    if (charge) {
      await refundComparisonCredits(userId, charge.at, charge.credits)
    }
    return true
  } catch (error) {
    console.error("Failed to roll back abandoned comparison", error)
    return false
  }
}

// What a run spent, as the run itself knows it: the moment the credits were
// taken and how many. Only the generate endpoint can hand this over, since it is
// the only caller that was there when the charge happened.
export interface ComparisonCharge {
  at: Date
  credits: number
}

// The same rollback, addressed the only way the creator's browser can address
// it: by the pair it picked, plus the moment it pressed the button. Nothing
// created before that moment is this run's to delete.
export async function rollBackComparisonForPair(
  supabase: SupabaseClient,
  userId: string,
  videoAId: string,
  videoBId: string,
  startedAt: Date,
): Promise<boolean> {
  try {
    // The row itself is the only record of what this run paid, so read it off
    // the delete: the browser reporting the abandonment was never told the
    // price, and it is not the browser's to say.
    const removed = await deleteComparisonCreatedSince(
      supabase,
      userId,
      videoAId,
      videoBId,
      startedAt,
    )
    if (!removed.deleted) return false
    await refundComparisonCredits(
      userId,
      startedAt,
      comparisonRefundCredits(removed.deepCreditsCharged),
    )
    return true
  } catch (error) {
    console.error("Failed to roll back abandoned comparison", error)
    return false
  }
}

// Clears out the abandoned runs nobody reported, and refunds each one. Runs on
// the way into the Video Comparator, so a creator who lost a run to a crashed
// browser finds their history clean and their credits back the next time they
// look at it, instead of a row that opens onto an empty report. Best-effort: a
// failure here must not take the page down with it.
export async function sweepAbandonedComparisons(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  try {
    const abandoned = await deleteAbandonedComparisons(supabase, userId)
    for (const comparison of abandoned) {
      await refundComparisonCredits(
        userId,
        new Date(comparison.createdAt),
        comparisonRefundCredits(comparison.deepCreditsCharged),
      )
    }
    return abandoned.length
  } catch (error) {
    console.error("Failed to sweep abandoned comparisons", error)
    return 0
  }
}
