import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { completeSourceFileUpload } from "@/lib/source-files/upload-service"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"
import type { CompletedPart } from "@/lib/storage"

// POST /api/source-files/:sourceFileId/complete-upload
// Body (multipart uploads only): { uploadId: string, parts: { partNumber, etag }[] }
// Called by the browser once the direct upload finishes. For a multipart upload
// it first assembles the parts into the final object; then it verifies the object
// exists in storage, records its real size, runs validation and returns the
// resulting source-file state.
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

  // The single-PUT path sends no body; only multipart uploads post the part list.
  const multipart = await parseMultipartBody(request)

  try {
    const sourceFile = await completeSourceFileUpload(
      supabase,
      getStorageProvider(),
      { userId: user.id, sourceFileId, multipart },
    )
    return NextResponse.json({ sourceFile: serialiseSourceFile(sourceFile) })
  } catch (error) {
    return errorResponse(error)
  }
}

// Pulls a well-formed { uploadId, parts } out of the request body, or returns
// undefined for the single-PUT path (no/empty body). Malformed part lists are
// ignored rather than failing the request, since completion then surfaces a
// clear object_missing error from the storage layer.
async function parseMultipartBody(
  request: NextRequest,
): Promise<{ uploadId: string; parts: CompletedPart[] } | undefined> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return undefined
  }
  if (typeof body !== "object" || body === null) return undefined

  const { uploadId, parts } = body as {
    uploadId?: unknown
    parts?: unknown
  }
  if (typeof uploadId !== "string" || !Array.isArray(parts)) return undefined

  const cleaned: CompletedPart[] = []
  for (const part of parts) {
    if (
      typeof part === "object" &&
      part !== null &&
      typeof (part as { partNumber?: unknown }).partNumber === "number" &&
      typeof (part as { etag?: unknown }).etag === "string"
    ) {
      const p = part as { partNumber: number; etag: string }
      cleaned.push({ partNumber: p.partNumber, etag: p.etag })
    }
  }
  if (cleaned.length === 0) return undefined

  return { uploadId, parts: cleaned }
}
