import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getSourceFileForVideo } from "@/lib/source-files/source-files"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"

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
    return NextResponse.json({
      sourceFile: sourceFile ? serialiseSourceFile(sourceFile) : null,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
