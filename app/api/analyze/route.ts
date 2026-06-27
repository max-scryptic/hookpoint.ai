import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getGoogleAccessToken,
  ReconsentRequiredError,
} from "@/lib/youtube/google-auth"
import {
  detectDropOffs,
  getAudienceRetention,
  getVideoDetails,
  parseVideoId,
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

    return NextResponse.json({ video, retention, dropOffs })
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
