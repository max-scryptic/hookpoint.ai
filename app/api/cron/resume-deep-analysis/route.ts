import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { listResumableDeepAnalysisSourceFiles } from "@/lib/deep-analysis-resume"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"

// The resumed pipelines run in this invocation's after() callback, so this
// needs the same budget as every other trigger point (see /api/analyze).
export const maxDuration = 300

// Never serve this from a cache — a sweep's whole job is to observe current
// state, and Vercel's cron hits a plain GET.
export const dynamic = "force-dynamic"

// How many videos one sweep will pick up. They are resumed sequentially inside
// a single invocation, and the first video's extraction can easily consume most
// of the budget on its own, so this is a ceiling rather than a target — a
// backlog drains over consecutive sweeps instead of being attempted at once.
// Sequential matters: these stages shell out to ffmpeg, and running several
// concurrently in one function is how a sweep would OOM itself.
const MAX_VIDEOS_PER_SWEEP = 5

// GET /api/cron/resume-deep-analysis
// Scheduled sweep (see vercel.json) that restarts deep-analysis pipelines which
// stalled with no invocation left to finish them.
//
// This exists because every other trigger for this pipeline is attached to a
// user request: the original kickoff after an upload or analysis, and the
// browser's poll on a video's own detail page. A pipeline that outlives its
// invocation therefore stayed stuck until the user happened to reopen that exact
// page — for as long as that took, the dashboard just showed "Processing…"
// forever. This is the trigger that does not need anybody to be looking.
export async function GET(request: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` whenever the env var
  // is set. Required rather than optional: without it this route is an
  // unauthenticated way for anyone to make the app start transcoding and
  // running OpenAI calls, so refusing to run is the safe failure.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("CRON_SECRET is not set; refusing to run the deep analysis sweep")
    return NextResponse.json(
      { error: "not_configured", message: "Cron secret is not configured." },
      { status: 503 },
    )
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  try {
    const admin = createAdminClient()
    const sourceFiles = await listResumableDeepAnalysisSourceFiles(admin, {
      limit: MAX_VIDEOS_PER_SWEEP,
    })

    if (sourceFiles.length > 0) {
      console.info(
        `Resuming ${sourceFiles.length} stalled deep analysis pipeline(s): ` +
          sourceFiles.map((file) => file.analysedVideoId).join(", "),
      )
      // Each trigger registers its own after() callback and each claims the
      // video's lease independently, so a video whose pipeline turns out to be
      // alive after all is a no-op rather than a duplicate run.
      for (const sourceFile of sourceFiles) {
        triggerRetentionWindowMediaExtraction(sourceFile)
      }
    }

    // The triggers above registered the after() callbacks that actually run the
    // pipelines; the response goes out now with what the sweep decided to do.
    return NextResponse.json({
      resumed: sourceFiles.length,
      analysedVideoIds: sourceFiles.map((file) => file.analysedVideoId),
    })
  } catch (error) {
    console.error("Deep analysis resume sweep failed", error)
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong." },
      { status: 500 },
    )
  }
}
