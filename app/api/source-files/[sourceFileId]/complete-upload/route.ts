import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { completeSourceFileUpload } from "@/lib/source-files/upload-service"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"

// POST /api/source-files/:sourceFileId/complete-upload
// Called by the browser once the direct upload finishes. Verifies the object
// exists in storage, records its real size, then runs validation and returns the
// resulting source-file state.
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
    const sourceFile = await completeSourceFileUpload(
      supabase,
      getStorageProvider(),
      { userId: user.id, sourceFileId },
    )
    return NextResponse.json({ sourceFile: serialiseSourceFile(sourceFile) })
  } catch (error) {
    return errorResponse(error)
  }
}
