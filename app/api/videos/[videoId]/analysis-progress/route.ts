import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getAnalysedVideo } from "@/lib/analysed-videos"
import { getSourceFileForVideo } from "@/lib/source-files/source-files"
import {
  getDeepAnalysisProgress,
  type DeepAnalysisProgress,
} from "@/lib/retention-window-media-progress"

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

    const progress = await getDeepAnalysisProgress(
      supabase,
      user.id,
      analysedVideo.id,
      sourceFile,
    )
    return NextResponse.json(progress)
  } catch (error) {
    console.error("Failed to load analysis progress", error)
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong." },
      { status: 500 },
    )
  }
}
