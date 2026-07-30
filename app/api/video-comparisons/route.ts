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
// re-opens it for free.
//
// This is the ONLY place either written head-to-head is generated. Both are
// written here, once, while the creator waits on the button, and stored on the
// comparison row; the report page then reads them back and never generates
// anything itself. Pressing the button on a pair that already exists is free
// and fills in any report that is missing (a pair created before these reports
// existed, or one whose generation failed), so a stale pair is repaired by the
// same action rather than silently re-written on every view.

// Writes whichever of the two head-to-heads this comparison is missing and
// stores it on the row. Best-effort and independent: the pair is already saved
// (and charged), so a generation failure must not fail the request, and one
// report failing must not cost the creator the other. Generation also heals each
// video's packaging and script taxonomies, which is what fills the deterministic
// diffs under each written report.
async function ensureComparisonReports(
  supabase: SupabaseClient,
  userId: string,
  comparisonId: string,
  videoAId: string,
  videoBId: string,
  logContext: LlmLogContext,
  missing: { script: boolean; packaging: boolean },
): Promise<void> {
  const work: Array<Promise<unknown>> = []

  if (missing.script) {
    work.push(
      buildAndStoreScriptComparisonReport(
        supabase,
        userId,
        comparisonId,
        videoAId,
        videoBId,
        logContext,
      ).catch((error) => {
        console.error("Failed to generate script comparison report", error)
      }),
    )
  }

  if (missing.packaging) {
    work.push(
      buildAndStorePackagingComparisonReport(
        supabase,
        userId,
        comparisonId,
        videoAId,
        videoBId,
        logContext,
      ).catch((error) => {
        console.error("Failed to generate packaging comparison report", error)
      }),
    )
  }

  await Promise.all(work)
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
      const stored = await getComparisonReports(
        supabase,
        user.id,
        existing.id,
      ).catch((error) => {
        console.error("Failed to read stored comparison reports", error)
        return { script: null, packaging: null }
      })
      await ensureComparisonReports(
        supabase,
        user.id,
        existing.id,
        existing.videoAId,
        existing.videoBId,
        logContext,
        {
          script: stored.script == null,
          packaging: stored.packaging == null,
        },
      )
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

    // Write both head-to-heads now, before the response, so the report is
    // complete the moment the client opens it and the report page has nothing
    // left to generate.
    await ensureComparisonReports(
      supabase,
      user.id,
      saved.id,
      videoAId,
      videoBId,
      logContext,
      { script: true, packaging: true },
    )

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
