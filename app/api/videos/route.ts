import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  getGoogleAccessToken,
  ReconsentRequiredError,
} from "@/lib/youtube/google-auth"
import {
  getRecentVideos,
  type RecentVideosOrder,
} from "@/lib/youtube/youtube"

// Keep page sizes bounded — search.list allows up to 50 per page.
const MAX_PAGE_SIZE = 50

// GET /api/videos?pageToken=&q=&maxResults=
// Returns one page of the signed-in user's uploads plus the cursors for the
// adjacent pages. Each call hits the YouTube API; the client calls this again
// whenever the search query changes or the user pages forward/back. Date-range
// and privacy filtering happen client-side — search.list with forMine=true
// rejects publishedAfter/publishedBefore and never returns privacy status.
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

  // Only the orders search.list supports with forMine=true; anything else
  // falls back to newest-first.
  const orderParam = params.get("order")
  const order: RecentVideosOrder =
    orderParam === "title" || orderParam === "viewCount" ? orderParam : "date"

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
      order,
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
