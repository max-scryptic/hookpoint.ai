import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  getEntitlement,
  getUsageForWindow,
  incrementUsage,
} from "@/lib/billing/entitlements"
import type { LlmLogContext } from "@/lib/llm-calls"
import { VIDEO_COMPARISON_CREDIT_COST } from "@/lib/plans"
import {
  createSavedComparison,
  findSavedComparison,
  getComparisonReports,
  isPackagingReportCurrent,
  isScriptReportCurrent,
} from "@/lib/video-comparisons"
import { buildAndStorePackagingComparisonReport } from "@/lib/packaging-comparison-report"
import { buildAndStoreScriptComparisonReport } from "@/lib/script-comparison-report"
import type { SupabaseClient } from "@supabase/supabase-js"

// The script and packaging head-to-heads are both written by a model here (over
// both full transcripts, and over both thumbnails plus each opening's
// evidence), so give the request the same headroom the analysis paths use
// rather than the default serverless timeout.
export const maxDuration = 300

// POST /api/video-comparisons
// Body: { videoAId: string, videoBId: string }
// Generates (and pays for) one video-vs-video comparison report. A comparison
// costs a flat VIDEO_COMPARISON_CREDIT_COST deep-dive credits, charged once per
// unordered pair: re-generating a pair that already exists (in either order)
// re-opens it for free. The request does not resolve until both written
// head-to-heads have been generated and stored, so the client can keep its
// "generating" popup up for the whole run and only offer the way through to the
// report once there is a finished report to open. The response carries
// reportsReady so the client knows whether anything is still outstanding.
//
// This is the ONLY place either written head-to-head is generated. Both are
// written here, once, and stored on the comparison row; the report page reads
// them back and never generates anything itself, so no part of a report is ever
// re-written just because someone opened the page. Pressing the button on a
// pair that already exists is free and fills in whichever report is missing or
// out of date (a pair created before these reports existed, one whose
// generation failed, or one written against an older shape than the code now
// renders), so a stale pair is repaired by the same deliberate action.

// Which of the two head-to-heads a comparison row is carrying.
interface ReportReadiness {
  script: boolean
  packaging: boolean
}

// Writes whichever of the two head-to-heads this comparison is missing or is
// carrying against an older stored shape (present says which are current), stores
// it on the row, and reports what the row carries afterwards. Best-effort and
// independent: the pair is already saved (and charged), so a generation failure
// must not fail the request, and one report failing must not cost the creator
// the other. A report counts as ready only when it was actually written and
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
  const [script, packaging] = await Promise.all([
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

  return { script, packaging }
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
        return NextResponse.json({
          id: existing.id,
          charged: 0,
          reportsReady: true,
        })
      }

      // Otherwise the pair is missing a section, or carries one written against
      // an older shape than the report page now renders. Write it now, on this press,
      // using the row's own A/B order so the new report is oriented the same way
      // as the one already stored beside it.
      const stored = await getComparisonReports(
        supabase,
        user.id,
        existing.id,
      ).catch((error) => {
        console.error("Failed to read stored comparison reports", error)
        return { script: null, packaging: null }
      })
      const ready = await ensureComparisonReports(
        supabase,
        user.id,
        existing.id,
        existing.videoAId,
        existing.videoBId,
        logContext,
        {
          script: isScriptReportCurrent(stored.script),
          packaging: isPackagingReportCurrent(stored.packaging),
        },
      )
      return NextResponse.json({
        id: existing.id,
        charged: 0,
        reportsReady: ready.script && ready.packaging,
      })
    }

    // Comparisons ride on the same deep-dive credit budget as deep analysis;
    // plans without a budget cannot generate one.
    const entitlement = await getEntitlement(user.id)
    if (entitlement.plan.deepCreditsPerMonth <= 0) {
      return NextResponse.json(
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
      return NextResponse.json(
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
        return NextResponse.json({
          id: raced.id,
          charged: 0,
          reportsReady: raced.reportsReady,
        })
      }
      throw error
    }

    // Charge for the freshly saved comparison. Best-effort, matching the upload
    // path: the saved row is the record that the pair was generated, and a
    // metering hiccup must not strand a report the creator can already see.
    try {
      await incrementUsage(user.id, entitlement.periodStart, {
        deepCredits: VIDEO_COMPARISON_CREDIT_COST,
      })
    } catch (error) {
      console.error("Failed to charge for video comparison", error)
    }

    // Write both head-to-heads now, before the response, so the report is
    // complete the moment the client opens it and the report page has nothing
    // left to generate.
    const ready = await ensureComparisonReports(
      supabase,
      user.id,
      saved.id,
      videoAId,
      videoBId,
      logContext,
      { script: false, packaging: false },
    )

    // The client holds its "generating" popup until this response lands and
    // only then offers the way through to the report, so tell it whether the
    // report it is about to open is complete.
    return NextResponse.json({
      id: saved.id,
      charged: VIDEO_COMPARISON_CREDIT_COST,
      reportsReady: ready.script && ready.packaging,
    })
  } catch (error) {
    console.error("Failed to generate video comparison", error)
    return NextResponse.json(
      { error: "We couldn't generate that comparison right now." },
      { status: 500 },
    )
  }
}

function readId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}
