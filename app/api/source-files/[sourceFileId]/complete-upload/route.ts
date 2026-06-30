import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { completeSourceFileUpload } from "@/lib/source-files/upload-service"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"
import type { CompletedPart } from "@/lib/storage"

// POST /api/source-files/:sourceFileId/complete-upload
// Body: { durationSeconds?: number, uploadId?: string, parts?: { partNumber, etag }[] }
// Called by the browser once the direct upload finishes. For a multipart upload
// it first assembles the parts into the final object; then (either path) it
// verifies the object exists in storage, records its real size, validates against
// the browser-measured duration and returns the resulting source-file state.
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

  // The body can only be read once, and it carries both the (optional) measured
  // duration and, for multipart uploads, the part list — so parse it once here.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  // The browser-measured duration is optional: missing/invalid just means we
  // couldn't read it (the service degrades to a "couldn't verify" warning).
  let clientDurationSeconds: number | null = null
  if (typeof (body as { durationSeconds?: unknown })?.durationSeconds === "number") {
    clientDurationSeconds = (body as { durationSeconds: number }).durationSeconds
  }

  // The single-PUT path sends no part list; only multipart uploads post one.
  const multipart = parseMultipartBody(body)

  try {
    const sourceFile = await completeSourceFileUpload(
      supabase,
      getStorageProvider(),
      { userId: user.id, sourceFileId, clientDurationSeconds, multipart },
    )
    return NextResponse.json({ sourceFile: serialiseSourceFile(sourceFile) })
  } catch (error) {
    return errorResponse(error)
  }
}

// Pulls a well-formed { uploadId, parts } out of the already-parsed body, or
// returns undefined for the single-PUT path (no part list). Malformed part lists
// are ignored rather than failing the request, since completion then surfaces a
// clear object_missing error from the storage layer.
function parseMultipartBody(
  body: unknown,
): { uploadId: string; parts: CompletedPart[] } | undefined {
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
