import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { initiateVideoPlanSourceFileUpload } from "@/lib/source-files/upload-service"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"
import { checkUploadAllowed } from "@/lib/billing/entitlements"
import { maxUploadBytesForPlan } from "@/lib/plans"

// POST /api/video-plans/:planId/source-file/initiate-upload
// Body: { filename: string, mimeType?: string, fileSizeBytes?: number }
//
// The plan-owned twin of the analysed-video route. Same direct-to-storage
// contract, so the browser's upload code is identical either side; what differs
// is the owner the record hangs off and, below, what the plan gate is asked.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params
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
    // Uploads must be included in the plan, and the file must fit its size cap.
    // Duration is passed as 0 so no deep-dive credits are required: a plan runs
    // one packaging call, not the per-minute deep analysis those credits meter.
    // See the same note on POST /api/video-plans.
    const uploadCheck = await checkUploadAllowed(user.id, {
      sizeBytes: declaredSizeBytes,
      durationSeconds: 0,
    })
    if (!uploadCheck.allowed) {
      const status = uploadCheck.reason === "file_too_large" ? 413 : 402
      return NextResponse.json(
        { error: uploadCheck.reason, message: uploadCheck.message },
        { status },
      )
    }

    const { sourceFile, upload, multipartUpload } =
      await initiateVideoPlanSourceFileUpload(supabase, getStorageProvider(), {
        userId: user.id,
        videoPlanId: planId,
        originalFilename: body.filename ?? "",
        mimeType: body.mimeType ?? null,
        declaredSizeBytes,
        maxUploadBytes: maxUploadBytesForPlan(uploadCheck.entitlement.plan),
      })

    return NextResponse.json({
      sourceFile: serialiseSourceFile(sourceFile),
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
