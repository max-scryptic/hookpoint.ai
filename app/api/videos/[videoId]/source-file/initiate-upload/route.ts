import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { initiateSourceFileUpload } from "@/lib/source-files/upload-service"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"

// POST /api/videos/:videoId/source-file/initiate-upload
// Body: { filename: string, mimeType?: string, fileSizeBytes?: number }
// Creates a pending source-file record for the user's analysed video and returns
// a signed direct-to-storage upload target. The browser uploads straight to
// storage with the returned token/URL — bytes never pass through this server.
export async function POST(
  request: NextRequest,
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

  let body: {
    filename?: string
    mimeType?: string
    fileSizeBytes?: number
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const { sourceFile, upload, multipartUpload } = await initiateSourceFileUpload(
      supabase,
      getStorageProvider(),
      {
        userId: user.id,
        youtubeVideoId: videoId,
        originalFilename: body.filename ?? "",
        mimeType: body.mimeType ?? null,
        declaredSizeBytes:
          typeof body.fileSizeBytes === "number" ? body.fileSizeBytes : null,
      },
    )

    return NextResponse.json({
      sourceFile: serialiseSourceFile(sourceFile),
      // Single-PUT target (Supabase Storage path).
      upload: upload
        ? {
            provider: upload.provider,
            bucket: upload.bucket,
            path: upload.path,
            token: upload.token,
            signedUrl: upload.signedUrl,
            expiresAt: upload.expiresAt,
          }
        : undefined,
      // Parallel multipart target (S3-compatible path). Never exposes the storage
      // path beyond the signed part URLs the browser needs.
      multipartUpload: multipartUpload
        ? {
            provider: multipartUpload.provider,
            uploadId: multipartUpload.uploadId,
            partSizeBytes: multipartUpload.partSizeBytes,
            totalParts: multipartUpload.totalParts,
            parts: multipartUpload.parts,
            expiresAt: multipartUpload.expiresAt,
          }
        : undefined,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
