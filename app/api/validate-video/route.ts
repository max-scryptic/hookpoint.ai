import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getGoogleAccessToken,
  ReconsentRequiredError,
} from "@/lib/youtube/google-auth"
import {
  getMyChannelId,
  getVideoDetails,
  parseVideoId,
} from "@/lib/youtube/youtube"

// POST /api/validate-video  { url: string }
// Confirms a pasted YouTube URL resolves to a real video that belongs to the
// channel the signed-in user connected. Used by the Analyse Video form before
// it sends the user through to the analysis view.
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
      { error: "That doesn't look like a YouTube video URL." },
      { status: 400 },
    )
  }

  try {
    const accessToken = await getGoogleAccessToken(user.id)

    const [video, channelId] = await Promise.all([
      getVideoDetails(accessToken, videoId),
      getMyChannelId(accessToken),
    ])

    if (!video) {
      return NextResponse.json(
        { error: "We couldn't find that video on YouTube." },
        { status: 404 },
      )
    }

    if (!channelId || video.channelId !== channelId) {
      return NextResponse.json(
        {
          error:
            "That video isn't on your connected channel. You can only analyse your own videos.",
        },
        { status: 403 },
      )
    }

    return NextResponse.json({ ok: true, videoId, title: video.title })
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
    console.error("validate-video route failed", error)
    return NextResponse.json(
      { error: "Something went wrong validating that video." },
      { status: 500 },
    )
  }
}
