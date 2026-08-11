import { NextResponse, type NextRequest } from "next/server"

import { refreshAnalysedVideoStats } from "@/lib/analysed-video-stats"
import { createClient } from "@/lib/supabase/server"
import {
  getEntitlement,
  getUsageForWindow,
  incrementUsage,
} from "@/lib/billing/entitlements"
import { rollBackComparison } from "@/lib/comparison-cleanup"
import type { LlmLogContext } from "@/lib/llm-calls"
import { VIDEO_COMPARISON_CREDIT_COST } from "@/lib/plans"
import {
  claimComparisonRun,
  createSavedComparison,
  findSavedComparison,
  getComparisonReports,
  isPackagingReportCurrent,
  isRetentionReportCurrent,
  isScriptReportCurrent,
  releaseComparisonRun,
} from "@/lib/video-comparisons"
import { buildAndStorePackagingComparisonReport } from "@/lib/packaging-comparison-report"
import { buildAndStoreRetentionComparisonReport } from "@/lib/retention-comparison-report"
import { buildAndStoreScriptComparisonReport } from "@/lib/script-comparison-report"
import type { SupabaseClient } from "@supabase/supabase-js"

// The retention, script and packaging head-to-heads are all written by a model
// here (over both curves and their event evidence, over both full transcripts,
// and over both thumbnails plus each opening's evidence), so give the request
// the same headroom the analysis paths use rather than the default serverless
// timeout.
export const maxDuration = 300

// POST /api/video-comparisons
// Body: { videoAId: string, videoBId: string }
// Generates (and pays for) one video-vs-video comparison report. A comparison
// costs a flat VIDEO_COMPARISON_CREDIT_COST deep-dive credits, charged once per
// unordered pair: re-generating a pair that already exists (in either order)
// re-opens it for free. The request does not resolve until all three written
// head-to-heads have been generated and stored, so the client can keep its
// "generating" popup up for the whole run and only offer the way through to the
// report once there is a finished report to open. The response carries
// reportsReady so the client knows whether anything is still outstanding.
//
// This is the ONLY place any written head-to-head is generated. All three are
// written here, once, and stored on the comparison row; the report page reads
// them back and never generates anything itself, so no part of a report is ever
// re-written just because someone opened the page. Pressing the button on a
// pair that already exists is free and fills in whichever report is missing or
// out of date (a pair created before these reports existed, one whose
// generation failed, or one written against an older shape than the code now
// renders), so a stale pair is repaired by the same deliberate action.
//
// A run that never finishes is rolled back rather than left half-done. The pair
// is saved and charged for before any report can be written onto it, so a run
// that is abandoned (the creator closed the tab, the connection dropped) or that
// fails outright would otherwise leave a paid-for pair in the history that opens
// onto an empty report. Both endings undo this run's own work: the row this
// request created is deleted and its credits handed back, so the creator is left
// exactly where they were before they pressed the button. A pair that already
// existed is never touched by that rollback, since it is not this run's to
// delete. See lib/comparison-cleanup.ts.

// Which of the three head-to-heads a comparison row is carrying.
interface ReportReadiness {
  retention: boolean
  script: boolean
  packaging: boolean
}

// Writes whichever of the three head-to-heads this comparison is missing or is
// carrying against an older stored shape (present says which are current), stores
// it on the row, and reports what the row carries afterwards. Best-effort and
// independent: the pair is already saved (and charged), so a generation failure
// must not fail the request, and one report failing must not cost the creator
// the others. A report counts as ready only when it was actually written and
// stored: a rejection, or a null result (nothing to compare, or a video that has
// gone missing), leaves that section unwritten and the client says so.
// Generation also heals each video's packaging and script taxonomies, which is
// what fills the deterministic diffs under each written report.
async function ensureComparisonReports(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  videoAId: string,
  videoBId: string,
  logContext: LlmLogContext,
  present: ReportReadiness,
): Promise<ReportReadiness> {
  // A written head-to-head is generated once and read for months, so the view
  // counts it reasons about — which side won, and by how much — must not be
  // whatever the two videos had on the day they were analysed. Force a refresh
  // of both sides' stored numbers first, ignoring the usual throttle: this runs
  // once per deliberate press of the button, and a stale figure baked into the
  // prose is not something re-opening the report can fix.
  await refreshAnalysedVideoStats(supabase, userId, {
    analysedVideoIds: [videoAId, videoBId],
    force: true,
  })

  const [retention, script, packaging] = await Promise.all([
    present.retention
      ? Promise.resolve(true)
      : buildAndStoreRetentionComparisonReport(
          supabase,
          userId,
          comparisonId,
          videoAId,
          videoBId,
          logContext,
        )
          .then((report) => report != null)
          .catch((error) => {
            console.error("Failed to generate retention comparison report", error)
            return false
          }),
    present.script
      ? Promise.resolve(true)
      : buildAndStoreScriptComparisonReport(
          supabase,
          userId,
          comparisonId,
          videoAId,
          videoBId,
          logContext,
        )
          .then((report) => report != null)
          .catch((error) => {
            console.error("Failed to generate script comparison report", error)
            return false
          }),
    present.packaging
      ? Promise.resolve(true)
      : buildAndStorePackagingComparisonReport(
          supabase,
          userId,
          comparisonId,
          videoAId,
          videoBId,
          logContext,
        )
          .then((report) => report != null)
          .catch((error) => {
            console.error(
              "Failed to generate packaging comparison report",
              error,
            )
            return false
          }),
  ])

  return { retention, script, packaging }
}

// Whether a run left the row carrying every written head-to-head.
function allReportsReady(ready: ReportReadiness): boolean {
  return ready.retention && ready.script && ready.packaging
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const videoAId = readId((body as { videoAId?: unknown })?.videoAId)
  const videoBId = readId((body as { videoBId?: unknown })?.videoBId)
  if (!videoAId || !videoBId) {
    return NextResponse.json(
      { error: "Pick two videos to compare." },
      { status: 400 },
    )
  }
  if (videoAId === videoBId) {
    return NextResponse.json(
      { error: "Pick two different videos to compare." },
      { status: 400 },
    )
  }

  const logContext: LlmLogContext = {
    userId: user.id,
    userEmail: user.email ?? null,
  }

  // What this request created, so an ending that leaves the report unwritten can
  // undo exactly that and nothing else. Only ever set for a pair this request
  // saved itself: an existing pair being finished for free is not ours to
  // delete. chargedAt stays null until the credits are actually taken, so a
  // rollback never refunds a charge that did not land.
  const run: { comparisonId: string | null; chargedAt: Date | null } = {
    comparisonId: null,
    chargedAt: null,
  }
  // Set the moment we have an answer to send. Past this point the request is
  // over on our side, so a late abort (a client that hangs up while the response
  // is on the wire) must not tear down a report that was finished and stored.
  let settled = false

  // The creator closing the tab or navigating away is the common way a run is
  // abandoned, and the browser telling us so is the only notice we get. Undo the
  // run rather than leaving them charged for a report nobody will ever see. The
  // reports still in flight cannot be recalled, but they write with the row id
  // in hand, so once it is gone their writes land nowhere.
  const abandon = () => {
    if (settled || !run.comparisonId) return
    void rollBackComparison(
      supabase,
      user.id,
      run.comparisonId,
      run.chargedAt,
    ).then((rolledBack) => {
      if (rolledBack) {
        console.info("Rolled back an abandoned video comparison")
      }
    })
  }
  request.signal.addEventListener("abort", abandon)

  // Every way out of the work below goes through here, so the run counts as
  // finished the moment it has an answer and a late abort finds nothing to undo.
  const settle = (payload: unknown, init?: { status: number }) => {
    settled = true
    return NextResponse.json(payload, init)
  }

  try {
    // An already-generated pair re-opens for free: it was paid for once, so
    // there is nothing new to charge for. Any head-to-head that never made it
    // onto the row is written now, on this press of the button, so the report
    // page still has nothing left to generate when it loads.
    const existing = await findSavedComparison(
      supabase,
      user.id,
      videoAId,
      videoBId,
    )
    if (existing) {
      // The common case: a complete pair, so there is nothing to write and the
      // client can go straight through to the report.
      if (existing.reportsReady) {
        return settle({
          id: existing.id,
          charged: 0,
          reportsReady: true,
        })
      }

      // Otherwise the pair is missing a section, or carries one written against
      // an older shape than the report page now renders. Write it now, on this press,
      // using the row's own A/B order so the new report is oriented the same way
      // as the one already stored beside it.
      //
      // Take the row first. This is the press that can arrive more than once for
      // the same pair (a second tab, a reload landing on a picker that still
      // says "Finish report"), and every one of those arrivals used to run the
      // whole generation again and overwrite the last. Whoever holds the row
      // finishes it; everyone else is told to wait rather than paying for the
      // same three reports twice.
      const claim = await claimComparisonRun(supabase, user.id, existing.id)
      if (!claim.granted) {
        return settle(
          {
            error:
              "This comparison is already being written. Give it a minute, then reload the page.",
          },
          { status: 409 },
        )
      }

      try {
        const stored = await getComparisonReports(
          supabase,
          user.id,
          existing.id,
        ).catch((error) => {
          console.error("Failed to read stored comparison reports", error)
          return { script: null, packaging: null, retention: null }
        })
        const ready = await ensureComparisonReports(
          supabase,
          user.id,
          existing.id,
          existing.videoAId,
          existing.videoBId,
          logContext,
          {
            retention: isRetentionReportCurrent(stored.retention),
            script: isScriptReportCurrent(stored.script),
            packaging: isPackagingReportCurrent(stored.packaging),
          },
        )
        return settle({
          id: existing.id,
          charged: 0,
          reportsReady: allReportsReady(ready),
        })
      } finally {
        if (claim.claimedAt) {
          await releaseComparisonRun(
            supabase,
            user.id,
            existing.id,
            claim.claimedAt,
          )
        }
      }
    }

    // Comparisons ride on the same deep-dive credit budget as deep analysis;
    // plans without a budget cannot generate one.
    const entitlement = await getEntitlement(user.id)
    if (entitlement.plan.deepCreditsPerMonth <= 0) {
      return settle(
        {
          error: `Video comparison is a paid feature. Upgrade to Starter or Pro to compare two videos side by side.`,
        },
        { status: 403 },
      )
    }

    const usage = await getUsageForWindow(user.id, entitlement.periodStart)
    const remaining =
      entitlement.plan.deepCreditsPerMonth - usage.deepCreditsUsed
    if (remaining < VIDEO_COMPARISON_CREDIT_COST) {
      return settle(
        {
          error: `A comparison costs ${VIDEO_COMPARISON_CREDIT_COST} deep-dive credits and you have ${Math.max(
            0,
            remaining,
          )} left this period.`,
        },
        { status: 402 },
      )
    }

    // Insert first so ownership (RLS) and the unordered-pair unique index are
    // enforced before any credit is spent. A unique violation means a
    // concurrent request already created the pair, so re-open it for free.
    let saved
    try {
      saved = await createSavedComparison(
        supabase,
        user.id,
        videoAId,
        videoBId,
      )
    } catch (error) {
      const raced = await findSavedComparison(
        supabase,
        user.id,
        videoAId,
        videoBId,
      )
      if (raced) {
        // A concurrent request created the pair and is writing its reports; say
        // what the row carries right now rather than promising a finished one.
        return settle({
          id: raced.id,
          charged: 0,
          reportsReady: raced.reportsReady,
        })
      }
      throw error
    }

    // From here on this row is this request's to finish, and this request's to
    // take back if it cannot. Claim it too, so a press that arrives for this
    // pair while these three reports are being written is turned away rather
    // than writing its own set over the top. A row this new is never already
    // held by anybody else, so the claim is only ever recorded here, never
    // refused.
    run.comparisonId = saved.id
    const claim = await claimComparisonRun(supabase, user.id, saved.id)
    const claimedAt = claim.granted ? claim.claimedAt : null

    // Charge for the freshly saved comparison. Best-effort, matching the upload
    // path: the saved row is the record that the pair was generated, and a
    // metering hiccup must not strand a report the creator can already see.
    try {
      await incrementUsage(user.id, entitlement.periodStart, {
        deepCredits: VIDEO_COMPARISON_CREDIT_COST,
      })
      run.chargedAt = new Date()
    } catch (error) {
      console.error("Failed to charge for video comparison", error)
    }

    // Write all three head-to-heads now, before the response, so the report is
    // complete the moment the client opens it and the report page has nothing
    // left to generate.
    try {
      const ready = await ensureComparisonReports(
        supabase,
        user.id,
        saved.id,
        videoAId,
        videoBId,
        logContext,
        { retention: false, script: false, packaging: false },
      )

      // The client holds its "generating" popup until this response lands and
      // only then offers the way through to the report, so tell it whether the
      // report it is about to open is complete.
      return settle({
        id: saved.id,
        charged: VIDEO_COMPARISON_CREDIT_COST,
        reportsReady: allReportsReady(ready),
      })
    } finally {
      if (claimedAt) {
        await releaseComparisonRun(supabase, user.id, saved.id, claimedAt)
      }
    }
  } catch (error) {
    console.error("Failed to generate video comparison", error)
    // The run fell over after saving (and charging for) the pair, so the creator
    // is holding a paid-for row with nothing written on it. Put them back where
    // they started rather than leaving that in their history: a failed press
    // should cost them nothing and be safe to repeat.
    if (run.comparisonId) {
      await rollBackComparison(
        supabase,
        user.id,
        run.comparisonId,
        run.chargedAt,
      )
    }
    return settle(
      { error: "We couldn't generate that comparison right now." },
      { status: 500 },
    )
  }
}

function readId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}
