import { NextResponse, type NextRequest } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/server"
import {
  checkVideoAnalysisAllowed,
  incrementUsage,
} from "@/lib/billing/entitlements"
import {
  getAnalysedVideo,
  healCachedTranscript,
  saveAnalysedVideo,
} from "@/lib/analysed-videos"
import {
  ANALYSIS_STREAM_CONTENT_TYPE,
  CACHED_ANALYSIS_STAGES,
  createAnalysisProgressReporter,
  encodeAnalysisStreamEvent,
  type AnalysisProgressReporter,
  type AnalysisStreamEvent,
} from "@/lib/analysis-progress-stream"
import { getOrGeneratePacingAnalysis } from "@/lib/pacing-analyses"
import {
  buildRetentionWindows,
  saveRetentionWindows,
} from "@/lib/retention-windows"
import { loadSurfaceExtras } from "@/lib/surface-extras"
import { createPendingRetentionWindowAudio } from "@/lib/retention-window-media"
import { saveRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import { getSourceFileForVideo } from "@/lib/source-files/source-files"
import { createPendingRetentionWindowSceneCueScans } from "@/lib/video-scene-cues"
import { createPendingRetentionWindowEventSynthesis } from "@/lib/retention-window-events"
import {
  generatePacingAnalysis,
  type PacingAnalysis,
} from "@/lib/pacing-analysis"
import {
  getGoogleAccessToken,
  ReconsentRequiredError,
} from "@/lib/youtube/google-auth"
import {
  detectDropOffs,
  detectRetentionGains,
  getAudienceRetention,
  getVideoDetails,
  getVideoTranscript,
  parseVideoId,
  type TranscriptCue,
} from "@/lib/youtube/youtube"

// Extraction runs in the background via after() once the response is sent, but
// still within this invocation's time budget — give it room beyond the default.
export const maxDuration = 300

// Thrown to unwind the analysis to the stream writer with the status/copy the
// non-streaming route would have returned as an HTTP error. Once we've started
// streaming, the response is already a 200, so failures travel as an "error"
// event instead of a status code.
class AnalysisFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly userMessage?: string,
  ) {
    super(userMessage ?? code)
  }
}

// POST /api/analyze  { url: string }
// Resolves the pasted YouTube URL, confirms the signed-in user owns the video,
// fetches its audience retention curve, and returns the curve plus the steepest
// drop-off points.
//
// The response is a stream of newline-delimited JSON events (see
// lib/analysis-progress-stream.ts): a "stage" event each time the analysis
// enters or advances through a step, then exactly one terminal "result" or
// "error" event. The client drives its progress bar off those stage events, so
// the bar tracks the actual work — most of which is LLM calls at the tail —
// instead of a timer that races to the end and waits. Failures we can detect
// before any work starts (no session, unusable body) are still plain JSON error
// responses with a real status code.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const videoId = body.url ? parseVideoId(body.url) : null
  if (!videoId) {
    return NextResponse.json(
      { error: "Could not find a YouTube video ID in that URL" },
      { status: 400 },
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (event: AnalysisStreamEvent) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(encodeAnalysisStreamEvent(event)))
        } catch {
          // The client navigated away or aborted; stop writing but let the
          // analysis itself run to completion so the work isn't wasted.
          open = false
        }
      }
      const reporter = createAnalysisProgressReporter(send)

      try {
        const result = await runAnalysis(supabase, user.id, videoId, reporter)
        send({ type: "result", result })
      } catch (error) {
        if (error instanceof AnalysisFailure) {
          send({
            type: "error",
            status: error.status,
            error: error.code,
            message: error.userMessage,
          })
        } else if (error instanceof ReconsentRequiredError) {
          send({
            type: "error",
            status: 403,
            error: "reconnect_required",
            message:
              "Please reconnect your YouTube account to grant analytics access.",
          })
        } else {
          console.error("analyze route failed", error)
          send({
            type: "error",
            status: 500,
            error: "Failed to analyze video",
          })
        }
      } finally {
        open = false
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": ANALYSIS_STREAM_CONTENT_TYPE,
      "Cache-Control": "no-store, no-transform",
      // Ask any intermediary not to buffer, so stage events reach the browser
      // as they're written rather than all at once at the end.
      "X-Accel-Buffering": "no",
    },
  })
}

async function runAnalysis(
  supabase: SupabaseClient,
  userId: string,
  videoId: string,
  reporter: AnalysisProgressReporter,
): Promise<unknown> {
  // Replay a saved analysis when we have one — calling YouTube costs quota.
  reporter.stage("lookup")
  const cached = await getAnalysedVideo(supabase, userId, videoId)
  if (cached?.videoDetails && cached.retention) {
    // Everything below is cache-backed, so switch to the shorter plan. Legal
    // here because "lookup" is a shared prefix of both plans: the bar can't
    // rewind.
    reporter.usePlan(CACHED_ANALYSIS_STAGES)
    reporter.stage("transcript")
    const transcript = await healCachedTranscript(
      supabase,
      userId,
      videoId,
      cached.transcript,
    )
    let pacingAnalysis: PacingAnalysis | null = null
    reporter.stage("pacing")
    try {
      pacingAnalysis = await getOrGeneratePacingAnalysis(
        supabase,
        userId,
        cached.id,
        cached.videoDetails,
        transcript,
      )
    } catch (pacingError) {
      console.error("Failed to generate pacing analysis", pacingError)
    }

    reporter.stage("extras")
    await loadSurfaceExtras(
      supabase,
      userId,
      cached.id,
      cached.videoDetails,
      buildRetentionWindows(
        cached.retention,
        cached.videoDetails.durationSeconds,
      ),
      transcript,
      (completed, total) => reporter.advance(completed / total),
    )

    return {
      video: cached.videoDetails,
      retention: cached.retention,
      dropOffs: detectDropOffs(cached.retention),
      gains: detectRetentionGains(cached.retention),
      transcript,
      pacingAnalysis,
      cached: true,
    }
  }

  // This is a genuinely new analysis (nothing cached to replay), so it counts
  // against the plan's monthly allowance. Replaying a cached video above never
  // reaches here, so re-opening a report is always free. Block before spending
  // any YouTube quota when the user is out of analyses.
  const analysisCheck = await checkVideoAnalysisAllowed(userId)
  if (!analysisCheck.allowed) {
    throw new AnalysisFailure(402, "plan_limit_reached", analysisCheck.message)
  }
  const analysisPeriodStart = analysisCheck.entitlement.periodStart

  const accessToken = await getGoogleAccessToken(userId)

  reporter.stage("details")
  const video = await getVideoDetails(accessToken, videoId)
  if (!video) {
    throw new AnalysisFailure(404, "Video not found")
  }

  reporter.stage("retention")
  const retention = await getAudienceRetention(accessToken, video)
  if (retention.length === 0) {
    // The Analytics API returns no rows when the signed-in user does not own
    // the video, or when YouTube has too little data to report retention.
    throw new AnalysisFailure(
      422,
      "No retention data available. Make sure this video is on the YouTube channel you signed in with and has enough views.",
    )
  }

  reporter.stage("dropoffs")
  const dropOffs = detectDropOffs(retention)
  const gains = detectRetentionGains(retention)
  const retentionWindows = buildRetentionWindows(
    retention,
    video.durationSeconds,
  )
  // Best-effort: a missing or caption-less transcript must not fail the
  // analysis, so swallow errors and fall back to an empty transcript.
  reporter.stage("transcript")
  const transcript = await getVideoTranscript(accessToken, videoId).catch(
    (transcriptError) => {
      console.error("Failed to fetch transcript", transcriptError)
      return [] as TranscriptCue[]
    },
  )
  // Persist the analysis so subsequent requests are served from the cache
  // above, and so pacing analysis below has a video row to claim against.
  // Best-effort: a DB failure shouldn't fail the analysis response.
  let pacingAnalysis: PacingAnalysis | null = null
  let videoPersisted = false
  let analysedVideoId: string | null = null
  reporter.stage("persist")
  try {
    const savedVideo = await saveAnalysedVideo(supabase, {
      userId,
      video,
      retention,
      transcript,
    })
    if (savedVideo) {
      videoPersisted = true
      analysedVideoId = savedVideo.id
      reporter.advance(0.3)
      // Tally this new analysis against the plan's monthly allowance. Best
      // effort: a counter hiccup must not fail an analysis the user can use,
      // and the pre-flight check above is the real gate.
      try {
        await incrementUsage(userId, analysisPeriodStart, {
          videoAnalyses: 1,
        })
      } catch (usageError) {
        console.error("Failed to record video-analysis usage", usageError)
      }
      try {
        const savedWindows = await saveRetentionWindows(
          supabase,
          userId,
          savedVideo.id,
          retentionWindows,
        )
        reporter.advance(0.6)
        await createPendingRetentionWindowAudio(
          supabase,
          userId,
          savedVideo.id,
          savedWindows,
        )
        await createPendingRetentionWindowSceneCueScans(
          supabase,
          userId,
          savedVideo.id,
          savedWindows,
        )
        await createPendingRetentionWindowEventSynthesis(
          supabase,
          userId,
          savedVideo.id,
          savedWindows,
        )
        await saveRetentionWindowTranscripts(
          supabase,
          userId,
          savedVideo.id,
          savedWindows,
          transcript,
        )
        reporter.advance(0.9)
        // The source video may already be uploaded and normalised (this
        // analyze call can come after the upload) — if so, kick off
        // extraction now instead of waiting on the normalisation callback.
        const sourceFile = await getSourceFileForVideo(
          supabase,
          userId,
          videoId,
        )
        triggerRetentionWindowMediaExtraction(sourceFile)
      } catch (retentionSaveError) {
        console.error("Failed to save retention windows", retentionSaveError)
      }
      if (transcript.length > 0) {
        reporter.stage("pacing")
        try {
          pacingAnalysis = await getOrGeneratePacingAnalysis(
            supabase,
            userId,
            savedVideo.id,
            video,
            transcript,
          )
        } catch (pacingError) {
          // Pacing is additive: an OpenAI outage or a missing key must not
          // hide the retention analysis the user can still use.
          console.error("Failed to generate pacing analysis", pacingError)
        }
      }
    }
  } catch (saveError) {
    console.error("Failed to save analysed video", saveError)
  }

  // The video row failed to save, so there's nothing to claim/save a pacing
  // analysis against — fall back to generating one just for this response.
  if (!videoPersisted && transcript.length > 0) {
    reporter.stage("pacing")
    try {
      pacingAnalysis = await generatePacingAnalysis(video, transcript, {
        userId,
      })
    } catch (pacingError) {
      console.error("Failed to generate pacing analysis", pacingError)
    }
  }

  if (analysedVideoId) {
    reporter.stage("extras")
    await loadSurfaceExtras(
      supabase,
      userId,
      analysedVideoId,
      video,
      retentionWindows,
      transcript,
      (completed, total) => reporter.advance(completed / total),
    )
  }

  return {
    video,
    retention,
    dropOffs,
    gains,
    transcript,
    pacingAnalysis,
  }
}
