import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  getAnalysedVideo,
  healCachedTranscript,
  saveInsights,
} from "@/lib/analysed-videos"
import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import { generateVideoInsights } from "@/lib/ai/insights"

// POST /api/insights/[videoId]
// Generates (or regenerates) the AI insight layer for a previously-analysed
// video the signed-in user owns, persists it, and returns it. Insight
// generation is on-demand because it spends model tokens — the rest of the
// analysis is served from the cache without ever calling this.
export async function POST(
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

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "AI insights are not configured on this server." },
      { status: 503 },
    )
  }

  try {
    const cached = await getAnalysedVideo(supabase, user.id, videoId)
    if (!cached?.videoDetails || !cached.retention) {
      return NextResponse.json(
        { error: "Analyse this video before generating insights." },
        { status: 404 },
      )
    }

    const transcript = await healCachedTranscript(
      supabase,
      user.id,
      videoId,
      cached.transcript,
    )

    // The OAuth token lets the storyboard fetch authenticate so YouTube doesn't
    // bot-challenge it. Best-effort: frames are optional, so if the token can't
    // be obtained (e.g. the user must reconnect) we still generate insights from
    // the transcript alone rather than failing the request.
    let accessToken: string | undefined
    try {
      accessToken = await getGoogleAccessToken(user.id)
    } catch (tokenError) {
      console.error("Could not get Google token for frame capture", tokenError)
    }

    const insights = await generateVideoInsights({
      videoId,
      video: cached.videoDetails,
      retention: cached.retention,
      transcript,
      accessToken,
    })

    if (!insights) {
      return NextResponse.json(
        { error: "AI insights are not configured on this server." },
        { status: 503 },
      )
    }

    // Best-effort persist — still return the insights even if the write fails.
    try {
      await saveInsights(supabase, user.id, videoId, insights)
    } catch (saveError) {
      console.error("Failed to save insights", saveError)
    }

    return NextResponse.json({ insights })
  } catch (error) {
    console.error("Failed to generate insights", error)
    return NextResponse.json(
      { error: "Failed to generate insights. Please try again." },
      { status: 500 },
    )
  }
}
