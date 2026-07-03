import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getAnalysedVideo } from "@/lib/analysed-videos"
import { getSourceFileForVideo } from "@/lib/source-files/source-files"
import { isSourceFileReady } from "@/lib/retention-window-media-extraction"
import { resetDeepAnalysis } from "@/lib/retention-window-deep-analysis-reset"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"

// POST /api/videos/:videoId/retry-deep-analysis
// Resets a video's deep analysis: clears every scene-cue/snapshot/audio/event
// row the pipeline in lib/retention-window-media-trigger.ts has written so
// far, then re-kicks that same pipeline against the still-uploaded source
// file. The source file itself and the video's light analysis (retention
// curve, transcript, pacing) are untouched — only re-running /api/analyze
// redoes those.
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

  try {
    const [analysedVideo, sourceFile] = await Promise.all([
      getAnalysedVideo(supabase, user.id, videoId),
      getSourceFileForVideo(supabase, user.id, videoId),
    ])

    if (!analysedVideo) {
      return NextResponse.json(
        { error: "not_found", message: "Video not found." },
        { status: 404 },
      )
    }

    if (!isSourceFileReady(sourceFile)) {
      return NextResponse.json(
        {
          error: "nothing_to_retry",
          message: "No ready source file to re-analyze.",
        },
        { status: 409 },
      )
    }

    await resetDeepAnalysis(supabase, user.id, analysedVideo.id)
    triggerRetentionWindowMediaExtraction(sourceFile)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to retry deep analysis", error)
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong." },
      { status: 500 },
    )
  }
}
