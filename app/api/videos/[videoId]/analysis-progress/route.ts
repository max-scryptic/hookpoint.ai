import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getAnalysedVideo } from "@/lib/analysed-videos"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import { getSourceFileForVideo } from "@/lib/source-files/source-files"
import {
  getDeepAnalysisProgress,
  shouldResumeDeepAnalysis,
  type DeepAnalysisProgress,
} from "@/lib/retention-window-media-progress"
import { getLatestDeepAnalysisPipelineRun } from "@/lib/deep-analysis-pipeline-runs"

// A poll that finds the pipeline stalled re-kicks it via after(), and that
// resumed work (extraction/analysis/synthesis) runs within this invocation's
// budget — so give it the same headroom as every other trigger point for this
// pipeline (see /api/analyze, /api/videos/:id/retry-deep-analysis).
export const maxDuration = 300

// GET /api/videos/:videoId/analysis-progress
// Polled by the source-file card while a raw upload's transcode/snapshot/audio
// harvest is in flight, so it can show live per-stage status instead of a
// single opaque spinner.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const [analysedVideo, sourceFile] = await Promise.all([
      getAnalysedVideo(supabase, user.id, videoId),
      getSourceFileForVideo(supabase, user.id, videoId),
    ])

    // Nothing to report until there's a fully-uploaded source file to run the
    // pipeline against.
    if (!analysedVideo || !sourceFile || sourceFile.uploadStatus !== "ready") {
      const idle: DeepAnalysisProgress = {
        active: false,
        complete: true,
        stages: null,
      }
      return NextResponse.json(idle)
    }

    // The pipeline-run summary is the card's failure signal, so read it up
    // front and independently of the per-stage breakdown: even if computing the
    // stages throws (a transient DB error, or code that reads a column a
    // migration hasn't added yet), the card can still surface a failed run and
    // prompt a retry instead of a silent green check.
    const pipelineRun = await getLatestDeepAnalysisPipelineRun(
      supabase,
      user.id,
      analysedVideo.id,
    ).catch(() => null)

    let progress: DeepAnalysisProgress
    try {
      progress = await getDeepAnalysisProgress(
        supabase,
        user.id,
        analysedVideo.id,
        sourceFile,
      )
    } catch (error) {
      // A ready source file whose stage breakdown we can't compute is still
      // being (or meant to be) analysed. Return a degraded-but-active read so
      // the card shows a generic "analysing" spinner rather than nothing at
      // all — the blank-card failure mode that used to hide a broken pipeline.
      // Skip the resume kick: without the breakdown we can't tell what stalled,
      // and whatever broke the read would likely break the resumed stage too.
      console.error("Failed to compute deep analysis stages", error)
      const degraded: DeepAnalysisProgress & { degraded: true } = {
        active: true,
        complete: false,
        stages: null,
        degraded: true,
      }
      return NextResponse.json({ ...degraded, pipelineRun })
    }

    // The original pipeline kickoff is a long best-effort after() callback.
    // Large source files can exhaust that invocation partway through — stalling
    // at extraction (snapshots/audio), AI analysis, or the final event
    // synthesis. The server finishes those on its own now (the pass hands over
    // to a fresh invocation, and the watchdog sweep catches whatever stalls
    // anyway), so this is no longer what rescues an analysis — it's the fast
    // path for the reader who happens to be watching, resuming within seconds
    // of a stall instead of on the sweep's cadence. Re-triggering is
    // idempotent: the pipeline-run lease makes an overlapping kick a no-op
    // while a run is genuinely in flight, and every stage only claims rows that
    // are still pending, so overlapping polls are harmless. See
    // shouldResumeDeepAnalysis for the full rationale.
    if (shouldResumeDeepAnalysis(progress)) {
      triggerRetentionWindowMediaExtraction(sourceFile)
    }
    return NextResponse.json({ ...progress, pipelineRun })
  } catch (error) {
    console.error("Failed to load analysis progress", error)
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong." },
      { status: 500 },
    )
  }
}
