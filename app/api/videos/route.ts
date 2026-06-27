import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getGoogleAccessToken,
  ReconsentRequiredError,
} from "@/lib/youtube/google-auth"
import { getRecentVideos } from "@/lib/youtube/youtube"

// Keep page sizes bounded — search.list allows up to 50 per page.
const MAX_PAGE_SIZE = 50

// Turns a date-input value (YYYY-MM-DD) into the RFC 3339 timestamp the
// search.list publishedAfter/publishedBefore params expect. `endOfDay` pushes
// the time to the last second so a "before" bound is inclusive of that day.
function toRfc3339(date: string | null, endOfDay = false): string | null {
  if (!date) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`
}

// GET /api/videos?pageToken=&q=&publishedAfter=&publishedBefore=&maxResults=
// Returns one page of the signed-in user's uploads plus the cursors for the
// adjacent pages. Each call hits the YouTube API; the client calls this again
// whenever the filters change or the user pages forward/back.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const params = request.nextUrl.searchParams
  const query = params.get("q")?.trim() || null
  const pageToken = params.get("pageToken") || null
  const publishedAfter = toRfc3339(params.get("publishedAfter"))
  const publishedBefore = toRfc3339(params.get("publishedBefore"), true)

  const requestedMax = Number(params.get("maxResults"))
  const maxResults =
    Number.isFinite(requestedMax) && requestedMax > 0
      ? Math.min(requestedMax, MAX_PAGE_SIZE)
      : 12

  try {
    const accessToken = await getGoogleAccessToken(user.id)
    const page = await getRecentVideos(accessToken, {
      maxResults,
      pageToken,
      query,
      publishedAfter,
      publishedBefore,
    })

    return NextResponse.json(page)
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
    console.error("videos route failed", error)
    return NextResponse.json(
      { error: "Something went wrong loading your videos." },
      { status: 500 },
    )
  }
}
