import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { initiateSourceFileUpload } from "@/lib/source-files/upload-service"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"
import { getAnalysedVideo } from "@/lib/analysed-videos"
import { checkUploadAllowed } from "@/lib/billing/entitlements"
import { maxUploadBytesForPlan } from "@/lib/plans"

// POST /api/videos/:videoId/source-file/initiate-upload
// Body: { filename: string, mimeType?: string, fileSizeBytes?: number }
// Creates a pending source-file record for the user's analysed video and returns
// a signed direct-to-storage upload target. The browser uploads straight to
// storage with the returned token/URL - bytes never pass through this server.
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

  const declaredSizeBytes =
    typeof body.fileSizeBytes === "number" ? body.fileSizeBytes : null

  try {
    // Gate the upload on the user's plan before minting an upload target:
    // uploads must be included in the plan, the file must fit the plan's size
    // cap, and there must be enough deep-dive credits for the footage's runtime.
    // The credits are charged later, when the upload lands (complete-upload).
    const analysed = await getAnalysedVideo(supabase, user.id, videoId)
    const durationSeconds = analysed?.videoDetails?.durationSeconds ?? 0
    const uploadCheck = await checkUploadAllowed(user.id, {
      sizeBytes: declaredSizeBytes,
      durationSeconds,
    })
    if (!uploadCheck.allowed) {
      const status = uploadCheck.reason === "file_too_large" ? 413 : 402
      return NextResponse.json(
        { error: uploadCheck.reason, message: uploadCheck.message },
        { status },
      )
    }

    const { sourceFile, upload, multipartUpload } = await initiateSourceFileUpload(
      supabase,
      getStorageProvider(),
      {
        userId: user.id,
        youtubeVideoId: videoId,
        originalFilename: body.filename ?? "",
        mimeType: body.mimeType ?? null,
        declaredSizeBytes,
        maxUploadBytes: maxUploadBytesForPlan(uploadCheck.entitlement.plan),
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
