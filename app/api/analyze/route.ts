import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getAnalysedVideo,
  healCachedTranscript,
  saveAnalysedVideo,
  saveInsights,
} from "@/lib/analysed-videos"
import { generateVideoInsights, type VideoInsights } from "@/lib/ai/insights"
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

// POST /api/analyze  { url: string }
// Resolves the pasted YouTube URL, confirms the signed-in user owns the video,
// fetches its audience retention curve, and returns the curve plus the steepest
// drop-off points. AI insight generation is layered on top of this response.
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
      return NextResponse.json({
        video: cached.videoDetails,
        retention: cached.retention,
        dropOffs: cached.dropOffs ?? detectDropOffs(cached.retention),
        gains: detectRetentionGains(cached.retention),
        transcript: await healCachedTranscript(
          supabase,
          user.id,
          videoId,
          cached.transcript,
        ),
        insights: cached.insights,
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

    // Persist the analysis so subsequent requests are served from the cache
    // above. Best-effort: a DB failure shouldn't fail the analysis response.
    try {
      await saveAnalysedVideo(supabase, {
        userId: user.id,
        video,
        retention,
        dropOffs,
        transcript,
      })
    } catch (saveError) {
      console.error("Failed to save analysed video", saveError)
    }

    // Generate the AI insight layer up front so a first-time analysis comes back
    // complete. Returns null when no OPENAI_API_KEY is set, so a key-less server
    // is unchanged. Best-effort: an insight failure must not fail the analysis.
    let insights: VideoInsights | null = null
    try {
      insights = await generateVideoInsights({ videoId, video, retention, transcript })
      if (insights) {
        await saveInsights(supabase, user.id, videoId, insights)
      }
    } catch (insightError) {
      console.error("Failed to auto-generate insights", insightError)
    }

    return NextResponse.json({
      video,
      retention,
      dropOffs,
      gains,
      transcript,
      insights,
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
