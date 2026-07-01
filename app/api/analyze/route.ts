import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getAnalysedVideo,
  healCachedTranscript,
  saveAnalysedVideo,
} from "@/lib/analysed-videos"
import {
  getPacingAnalysis,
  savePacingAnalysis,
} from "@/lib/pacing-analyses"
import {
  buildRetentionWindows,
  saveRetentionWindows,
} from "@/lib/retention-windows"
import { createPendingRetentionWindowMedia } from "@/lib/retention-window-media"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import { getSourceFileForVideo } from "@/lib/source-files/source-files"
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

// POST /api/analyze  { url: string }
// Resolves the pasted YouTube URL, confirms the signed-in user owns the video,
// fetches its audience retention curve, and returns the curve plus the steepest
// drop-off points.
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

  try {
    // Replay a saved analysis when we have one — calling YouTube costs quota.
    const cached = await getAnalysedVideo(supabase, user.id, videoId)
    if (cached?.videoDetails && cached.retention) {
      const transcript = await healCachedTranscript(
        supabase,
        user.id,
        videoId,
        cached.transcript,
      )
      let pacingAnalysis = await getPacingAnalysis(
        supabase,
        user.id,
        cached.id,
      )
      if (!pacingAnalysis && transcript.length > 0) {
        try {
          pacingAnalysis = await generatePacingAnalysis(
            cached.videoDetails,
            transcript,
          )
          if (pacingAnalysis) {
            await savePacingAnalysis(
              supabase,
              user.id,
              cached.id,
              pacingAnalysis,
            )
          }
        } catch (pacingError) {
          console.error("Failed to generate pacing analysis", pacingError)
        }
      }

      return NextResponse.json({
        video: cached.videoDetails,
        retention: cached.retention,
        dropOffs: detectDropOffs(cached.retention),
        gains: detectRetentionGains(cached.retention),
        transcript,
        pacingAnalysis,
        cached: true,
      })
    }

    const accessToken = await getGoogleAccessToken(user.id)

    const video = await getVideoDetails(accessToken, videoId)
    if (!video) {
      return NextResponse.json(
        { error: "Video not found" },
        { status: 404 },
      )
    }

    const retention = await getAudienceRetention(accessToken, video)
    if (retention.length === 0) {
      // The Analytics API returns no rows when the signed-in user does not own
      // the video, or when YouTube has too little data to report retention.
      return NextResponse.json(
        {
          error:
            "No retention data available. Make sure this video is on the YouTube channel you signed in with and has enough views.",
        },
        { status: 422 },
      )
    }

    const dropOffs = detectDropOffs(retention)
    const gains = detectRetentionGains(retention)
    // Best-effort: a missing or caption-less transcript must not fail the
    // analysis, so swallow errors and fall back to an empty transcript.
    const transcript = await getVideoTranscript(accessToken, videoId).catch(
      (transcriptError) => {
        console.error("Failed to fetch transcript", transcriptError)
        return [] as TranscriptCue[]
      },
    )
    let pacingAnalysis: PacingAnalysis | null = null
    if (transcript.length > 0) {
      try {
        pacingAnalysis = await generatePacingAnalysis(video, transcript)
      } catch (pacingError) {
        // Pacing is additive: an OpenAI outage or a missing key must not hide
        // the retention analysis the user can still use.
        console.error("Failed to generate pacing analysis", pacingError)
      }
    }

    // Persist the analysis so subsequent requests are served from the cache
    // above. Best-effort: a DB failure shouldn't fail the analysis response.
    try {
      const savedVideo = await saveAnalysedVideo(supabase, {
        userId: user.id,
        video,
        retention,
        transcript,
      })
      if (savedVideo) {
        try {
          const savedWindows = await saveRetentionWindows(
            supabase,
            user.id,
            savedVideo.id,
            buildRetentionWindows(retention, video.durationSeconds),
          )
          await createPendingRetentionWindowMedia(
            supabase,
            user.id,
            savedVideo.id,
            savedWindows,
          )
          // The source video may already be uploaded and normalised (this
          // analyze call can come after the upload) — if so, kick off
          // extraction now instead of waiting on the normalisation callback.
          const sourceFile = await getSourceFileForVideo(
            supabase,
            user.id,
            videoId,
          )
          triggerRetentionWindowMediaExtraction(sourceFile)
        } catch (retentionSaveError) {
          console.error(
            "Failed to save retention windows",
            retentionSaveError,
          )
        }
        if (pacingAnalysis) {
          try {
            await savePacingAnalysis(
              supabase,
              user.id,
              savedVideo.id,
              pacingAnalysis,
            )
          } catch (pacingSaveError) {
            console.error("Failed to save pacing analysis", pacingSaveError)
          }
        }
      }
    } catch (saveError) {
      console.error("Failed to save analysed video", saveError)
    }

    return NextResponse.json({
      video,
      retention,
      dropOffs,
      gains,
      transcript,
      pacingAnalysis,
    })
  } catch (error) {
    if (error instanceof ReconsentRequiredError) {
      return NextResponse.json(
        {
          error: "reconnect_required",
          message:
            "Please reconnect your YouTube account to grant analytics access.",
        },
        { status: 403 },
      )
    }
    console.error("analyze route failed", error)
    return NextResponse.json(
      { error: "Failed to analyze video" },
      { status: 500 },
    )
  }
}
