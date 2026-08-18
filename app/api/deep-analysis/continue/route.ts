import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getSourceFileForAnalysedVideo } from "@/lib/source-files/source-files"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import {
  DEEP_ANALYSIS_MAX_CONTINUATION_ATTEMPTS,
  DEEP_ANALYSIS_WORKER_SECRET_HEADER,
  isAuthorisedDeepAnalysisWorkerSecret,
} from "@/lib/deep-analysis-continuation"

// The pipeline runs in after() once this response is sent, but still inside
// this invocation's budget — the same headroom every other trigger point gets.
export const maxDuration = 300

// POST /api/deep-analysis/continue
// The worker end of the pipeline's continuation chain: it starts one more
// deep-analysis pass, with a full invocation budget, for a video whose previous
// pass ran out of time (or which the watchdog sweep found stalled).
//
// Server-to-server only — no user is present, by design: the whole point is to
// finish an analysis whose owner has closed the tab. Callers authenticate with
// the shared worker secret; without it this would be an unauthenticated way to
// make the deployment do expensive work for any video id a stranger guessed.
export async function POST(request: NextRequest) {
  if (
    !isAuthorisedDeepAnalysisWorkerSecret(
      request.headers.get(DEEP_ANALYSIS_WORKER_SECRET_HEADER),
    )
  ) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 })
  }

  let body: { analysedVideoId?: unknown; attempt?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }

  const analysedVideoId =
    typeof body.analysedVideoId === "string" ? body.analysedVideoId : null
  if (!analysedVideoId) {
    return NextResponse.json(
      { error: "invalid_body", message: "analysedVideoId is required." },
      { status: 400 },
    )
  }

  const attempt =
    typeof body.attempt === "number" && Number.isFinite(body.attempt)
      ? Math.max(0, Math.trunc(body.attempt))
      : 0
  // The chain is bounded here as well as at the dispatch end, so a stray or
  // replayed request can't keep a video looping past its ceiling. Beyond it the
  // watchdog sweep — which paces its retries and gives up out loud — takes over.
  if (attempt > DEEP_ANALYSIS_MAX_CONTINUATION_ATTEMPTS) {
    return NextResponse.json({ ok: true, started: false, reason: "max_attempts" })
  }

  try {
    const admin = createAdminClient()
    const sourceFile = await getSourceFileForAnalysedVideo(admin, analysedVideoId)
    if (!sourceFile) {
      return NextResponse.json(
        { error: "not_found", message: "No source file for that video." },
        { status: 404 },
      )
    }

    // No-ops when the file isn't ready, and no-ops harmlessly when another pass
    // already holds the video's pipeline lease.
    triggerRetentionWindowMediaExtraction(sourceFile, { attempt })
    return NextResponse.json({ ok: true, started: true, attempt })
  } catch (error) {
    console.error("Failed to continue deep analysis", error)
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong." },
      { status: 500 },
    )
  }
}
