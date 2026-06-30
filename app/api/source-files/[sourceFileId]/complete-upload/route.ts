import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { completeSourceFileUpload } from "@/lib/source-files/upload-service"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"

// POST /api/source-files/:sourceFileId/complete-upload
// Called by the browser once the direct upload finishes. The body carries the
// duration the browser measured for the file ({ durationSeconds }). Verifies the
// object exists in storage, records its real size, validates against that
// duration and returns the resulting source-file state.
export async function POST(
  request: NextRequest,
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

  // The browser-measured duration is optional: a missing/invalid body just means
  // we couldn't read it (the service degrades to a "couldn't verify" warning).
  let clientDurationSeconds: number | null = null
  try {
    const body = (await request.json()) as { durationSeconds?: unknown }
    if (typeof body?.durationSeconds === "number") {
      clientDurationSeconds = body.durationSeconds
    }
  } catch {
    // No or unparseable body — leave clientDurationSeconds null.
  }

  try {
    const sourceFile = await completeSourceFileUpload(
      supabase,
      getStorageProvider(),
      { userId: user.id, sourceFileId, clientDurationSeconds },
    )
    return NextResponse.json({ sourceFile: serialiseSourceFile(sourceFile) })
  } catch (error) {
    return errorResponse(error)
  }
}
