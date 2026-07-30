import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  getEntitlement,
  getUsageForWindow,
  incrementUsage,
} from "@/lib/billing/entitlements"
import { VIDEO_COMPARISON_CREDIT_COST } from "@/lib/plans"
import {
  createSavedComparison,
  findSavedComparison,
} from "@/lib/video-comparisons"
import { buildAndStorePackagingComparisonReport } from "@/lib/packaging-comparison-report"
import { buildAndStoreScriptComparisonReport } from "@/lib/script-comparison-report"

// The script and packaging head-to-heads are both written by a model at
// creation time (over both full transcripts, and over both thumbnails plus each
// opening's evidence), so give the request the same headroom the analysis paths
// use rather than the default serverless timeout.
export const maxDuration = 300

// POST /api/video-comparisons
// Body: { videoAId: string, videoBId: string }
// Generates (and pays for) one video-vs-video comparison report. A comparison
// costs a flat VIDEO_COMPARISON_CREDIT_COST deep-dive credits, charged once per
// unordered pair: re-generating a pair that already exists (in either order)
// re-opens it for free. On success the pair is saved and the client navigates
// to the comparison, which renders from the two videos' stored deep analysis.
// The written script report is generated once here and stored on the row; the
// retention and packaging comparisons are still recomputed live on the page.

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

  try {
    // An already-generated pair re-opens for free: it was paid for once and the
    // report is recomputed live, so there is nothing new to charge for.
    const existing = await findSavedComparison(
      supabase,
      user.id,
      videoAId,
      videoBId,
    )
    if (existing) {
      return NextResponse.json({ id: existing.id, charged: 0 })
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
      if (raced) return NextResponse.json({ id: raced.id, charged: 0 })
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

    // Write both head-to-heads now so the report is ready when the client opens
    // it. Best-effort and independent: the pair is already saved and charged, so
    // a generation failure must not fail the request, and one report failing
    // must not cost the user the other. The report page regenerates a missing
    // report lazily on open.
    const logContext = { userId: user.id, userEmail: user.email ?? null }
    const [scriptResult, packagingResult] = await Promise.allSettled([
      buildAndStoreScriptComparisonReport(
        supabase,
        user.id,
        saved.id,
        videoAId,
        videoBId,
        logContext,
      ),
      buildAndStorePackagingComparisonReport(
        supabase,
        user.id,
        saved.id,
        videoAId,
        videoBId,
        logContext,
      ),
    ])
    if (scriptResult.status === "rejected") {
      console.error(
        "Failed to generate script comparison report",
        scriptResult.reason,
      )
    }
    if (packagingResult.status === "rejected") {
      console.error(
        "Failed to generate packaging comparison report",
        packagingResult.reason,
      )
    }

    return NextResponse.json({
      id: saved.id,
      charged: VIDEO_COMPARISON_CREDIT_COST,
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
