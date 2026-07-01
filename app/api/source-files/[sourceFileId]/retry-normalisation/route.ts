import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { getSourceFileById } from "@/lib/source-files/source-files"
import { startNormalisation } from "@/lib/source-files/normalisation-service"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"

// POST /api/source-files/:sourceFileId/retry-normalisation
// Re-kicks the 1080p Qencode transcode for a source file whose original is
// still on hand (e.g. a prior job got stuck or the transcoder wrote a bad
// proxy) without requiring the user to re-upload the master. A no-op, returned
// as an error, once the original has already been deleted (normalisation
// succeeded, or there's nothing to transcode from).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sourceFileId: string }> },
) {
  const { sourceFileId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const sourceFile = await getSourceFileById(supabase, user.id, sourceFileId)
    if (!sourceFile) {
      return NextResponse.json(
        { error: "not_found", message: "Source file not found." },
        { status: 404 },
      )
    }

    if (!sourceFile.storagePath) {
      return NextResponse.json(
        {
          error: "nothing_to_retry",
          message: "No original master on hand to re-transcode.",
        },
        { status: 409 },
      )
    }

    const updated = await startNormalisation(
      supabase,
      getStorageProvider(),
      sourceFile,
    )
    return NextResponse.json({ sourceFile: serialiseSourceFile(updated) })
  } catch (error) {
    return errorResponse(error)
  }
}
