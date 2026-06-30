import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { abortSourceFileUpload } from "@/lib/source-files/upload-service"
import { errorResponse } from "@/lib/source-files/http"

// POST /api/source-files/:sourceFileId/abort-upload
// Body (multipart only): { uploadId: string }
// Called by the browser when an in-flight upload fails or is cancelled. Discards
// the multipart upload's parts (when an uploadId is given) and clears the DB row
// so the slot is ready for a fresh attempt. Best-effort and idempotent.
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

  let uploadId: string | undefined
  try {
    const body = (await request.json()) as { uploadId?: unknown }
    if (typeof body?.uploadId === "string") uploadId = body.uploadId
  } catch {
    // No body — abort a single-PUT upload (just clears the row/object).
  }

  try {
    await abortSourceFileUpload(supabase, getStorageProvider(), {
      userId: user.id,
      sourceFileId,
      uploadId,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
