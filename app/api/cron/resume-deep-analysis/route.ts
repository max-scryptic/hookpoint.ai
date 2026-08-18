import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getSourceFileForAnalysedVideo } from "@/lib/source-files/source-files"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import { recordAbandonedDeepAnalysisRun } from "@/lib/deep-analysis-pipeline-runs"
import {
  DEEP_ANALYSIS_WORKER_SECRET_HEADER,
  dispatchDeepAnalysisContinuation,
  isAuthorisedDeepAnalysisWorkerSecret,
} from "@/lib/deep-analysis-continuation"
import {
  DEEP_ANALYSIS_GIVE_UP_ERROR,
  planDeepAnalysisSweep,
} from "@/lib/deep-analysis-watchdog"

// The fallback path runs a pass inline via after() when a video's work can't be
// handed to a worker invocation, so this needs the same headroom as every other
// trigger point for the pipeline.
export const maxDuration = 300

// A sweep must read live state every time it runs.
export const dynamic = "force-dynamic"

// GET /api/cron/resume-deep-analysis
// The scheduled watchdog: finds deep analyses that stalled with nothing working
// on them and starts them again. This is what makes a deep analysis finish on
// its own — before it existed, a pipeline whose invocation was killed mid-stage
// (routine for a long video) waited for its owner to reopen the report page,
// because that page's progress poll was the only thing that ever re-kicked it.
//
// Called on a schedule by the database (a pg_cron job invoking pg_net — see
// supabase/migrations/20260818120000_deep_analysis_autonomous_completion.sql),
// which authenticates with the shared secret as a bearer token. Any scheduler
// that can present that secret works the same way.
export async function GET(request: NextRequest) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  const presented =
    bearer || request.headers.get(DEEP_ANALYSIS_WORKER_SECRET_HEADER)
  if (!isAuthorisedDeepAnalysisWorkerSecret(presented ?? null)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const sweep = await planDeepAnalysisSweep(admin)

    // Videos whose last few passes each left exactly the same work behind:
    // nothing further to try, so record the failure that turns the report's
    // permanent spinner into a retry the owner can actually act on.
    for (const candidate of sweep.abandon) {
      await recordAbandonedDeepAnalysisRun(
        admin,
        candidate.userId,
        candidate.analysedVideoId,
        DEEP_ANALYSIS_GIVE_UP_ERROR,
      ).catch((error) => {
        console.error("Failed to abandon stalled deep analysis", {
          analysedVideoId: candidate.analysedVideoId,
          error,
        })
      })
    }

    // Each resumed video gets its own invocation, so they're dispatched
    // together rather than one after another.
    const dispatched = await Promise.all(
      sweep.resume.map((candidate) =>
        dispatchDeepAnalysisContinuation({
          analysedVideoId: candidate.analysedVideoId,
          attempt: 0,
        }),
      ),
    )

    // A deployment with no way to reach its own worker endpoint (no base URL,
    // no secret, or a transient failure) still self-heals, just one video per
    // tick: run the first undispatched video's pass in this invocation.
    let ranInline = false
    for (const [index, candidate] of sweep.resume.entries()) {
      if (dispatched[index] || ranInline) continue
      const sourceFile = await getSourceFileForAnalysedVideo(
        admin,
        candidate.analysedVideoId,
      ).catch(() => null)
      if (!sourceFile) continue
      triggerRetentionWindowMediaExtraction(sourceFile)
      ranInline = true
    }

    const summary = {
      resumed: dispatched.filter(Boolean).length,
      ranInline,
      abandoned: sweep.abandon.length,
      skipped: sweep.skipped,
    }
    if (summary.resumed > 0 || summary.abandoned > 0 || ranInline) {
      console.info("Deep analysis watchdog swept stalled videos", summary)
    }
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    console.error("Deep analysis watchdog sweep failed", error)
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong." },
      { status: 500 },
    )
  }
}
