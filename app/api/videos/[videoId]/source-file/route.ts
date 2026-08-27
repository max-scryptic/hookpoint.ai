import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  getSourceFileForVideo,
  resolvePlaybackStoragePath,
} from "@/lib/source-files/source-files"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"
import { PLAYBACK_URL_TTL_SECONDS } from "@/lib/source-files/playback-url"
import { getStorageProvider } from "@/lib/storage/provider"

// GET /api/videos/:videoId/source-file
// Returns the current source file (and its validation status) for the user's
// YouTube video, or { sourceFile: null } when none has been uploaded.
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
    const sourceFile = await getSourceFileForVideo(supabase, user.id, videoId)
    const playbackPath = sourceFile
      ? resolvePlaybackStoragePath(sourceFile)
      : null
    let playbackUrl: string | null = null
    // When the signature above lapses. The player seeks against this URL long
    // after the response that carried it, so it needs to know when to come back
    // for a fresh one rather than discovering the expiry as a failed seek.
    let playbackUrlExpiresAt: string | null = null
    if (
      playbackPath &&
      sourceFile?.uploadStatus === "ready" &&
      (sourceFile.validationStatus === "passed" ||
        sourceFile.validationStatus === "warning")
    ) {
      playbackUrl = await getStorageProvider().createSignedReadUrl(
        playbackPath,
        PLAYBACK_URL_TTL_SECONDS,
      )
      playbackUrlExpiresAt = new Date(
        Date.now() + PLAYBACK_URL_TTL_SECONDS * 1000,
      ).toISOString()
    }

    return NextResponse.json({
      sourceFile: sourceFile ? serialiseSourceFile(sourceFile) : null,
      playbackUrl,
      playbackUrlExpiresAt,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
