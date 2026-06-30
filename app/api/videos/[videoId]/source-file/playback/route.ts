import { NextResponse } from "next/server"

import {
  getSourceFileForVideo,
  resolvePlaybackStoragePath,
} from "@/lib/source-files/source-files"
import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"

// Returns a short-lived, owner-scoped URL for inline source-video playback.
// The storage path remains server-only and the private bucket is never exposed.
export async function GET(
  _request: Request,
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

  const sourceFile = await getSourceFileForVideo(supabase, user.id, videoId)
  const playbackPath = sourceFile
    ? resolvePlaybackStoragePath(sourceFile)
    : null
  if (
    !playbackPath ||
    sourceFile?.uploadStatus !== "ready" ||
    sourceFile.validationStatus === "failed"
  ) {
    return NextResponse.json(
      { error: "A validated source file is not available" },
      { status: 404 },
    )
  }

  try {
    const playbackUrl = await getStorageProvider().createSignedReadUrl(
      playbackPath,
      60 * 60,
    )
    return NextResponse.json(
      { playbackUrl },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    console.error("Failed to create source video playback URL", error)
    return NextResponse.json(
      { error: "Could not prepare source video playback" },
      { status: 500 },
    )
  }
}
