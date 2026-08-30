import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { buildVideoPlanThumbnailObjectPath } from "@/lib/storage/provider"
import {
  getMaxThumbnailBytes,
  isAcceptedThumbnailMimeType,
  thumbnailExtensionForMimeType,
  ACCEPTED_THUMBNAIL_EXTENSIONS,
} from "@/lib/video-plans/config"
import { getThumbnailStorageProvider } from "@/lib/video-plans/storage"
import { getVideoPlan, updateVideoPlan } from "@/lib/video-plans/video-plans"

// POST /api/video-plans/:planId/thumbnail
// Body: multipart/form-data with a single `file` field.
//
// Unlike the footage, the thumbnail goes through this server rather than
// direct-to-storage. A thumbnail is at most a couple of megabytes, so the
// signed-target round trip the video upload needs would be three requests to
// move less data than one; and passing through here is what lets the mime type
// be checked against the real bytes' declared type before anything is written.
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

  const plan = await getVideoPlan(supabase, user.id, planId)
  if (!plan) {
    return NextResponse.json(
      { error: "not_found", message: "Plan not found." },
      { status: 404 },
    )
  }

  let file: File | null = null
  try {
    const form = await request.formData()
    const value = form.get("file")
    if (value instanceof File) file = value
  } catch {
    return NextResponse.json(
      { error: "invalid", message: "Could not read the uploaded image." },
      { status: 400 },
    )
  }

  if (!file) {
    return NextResponse.json(
      { error: "invalid", message: "No thumbnail was uploaded." },
      { status: 400 },
    )
  }

  const mimeType = file.type
  if (!isAcceptedThumbnailMimeType(mimeType)) {
    return NextResponse.json(
      {
        error: "unsupported_type",
        message: `Unsupported image type. Upload a ${ACCEPTED_THUMBNAIL_EXTENSIONS.join(", ")} file.`,
      },
      { status: 415 },
    )
  }

  const maxBytes = getMaxThumbnailBytes()
  if (file.size > maxBytes) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `That image is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB thumbnail limit.`,
      },
      { status: 413 },
    )
  }

  const storage = getThumbnailStorageProvider()
  const path = buildVideoPlanThumbnailObjectPath({
    userId: user.id,
    videoPlanId: planId,
    extension: thumbnailExtensionForMimeType(mimeType),
  })

  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    await storage.putObject(path, bytes, { contentType: mimeType })

    // A replacement thumbnail in a different format lands on a different object
    // key, so the old one would otherwise be orphaned in the bucket. Delete it
    // best-effort: a stale object must never fail an upload that succeeded.
    if (plan.thumbnailStoragePath && plan.thumbnailStoragePath !== path) {
      await storage.deleteObject(plan.thumbnailStoragePath).catch((error) => {
        console.error("Failed to delete replaced plan thumbnail", error)
      })
    }

    const updated = await updateVideoPlan(supabase, user.id, planId, {
      thumbnailStoragePath: path,
      thumbnailMimeType: mimeType,
      thumbnailSizeBytes: bytes.byteLength,
    })

    return NextResponse.json({
      thumbnail: {
        mimeType: updated.thumbnailMimeType,
        sizeBytes: updated.thumbnailSizeBytes,
      },
    })
  } catch (error) {
    console.error("Failed to store plan thumbnail", error)
    return NextResponse.json(
      { error: "internal_error", message: "Could not save the thumbnail." },
      { status: 500 },
    )
  }
}

// GET /api/video-plans/:planId/thumbnail
// Redirects to a short-lived signed URL for the plan's thumbnail, so the report
// can render it with a plain <img> without the private object's path or a
// long-lived URL ever reaching the browser.
export async function GET(
  _request: NextRequest,
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

  const plan = await getVideoPlan(supabase, user.id, planId)
  if (!plan?.thumbnailStoragePath) {
    return NextResponse.json(
      { error: "not_found", message: "No thumbnail for this plan." },
      { status: 404 },
    )
  }

  try {
    const url = await getThumbnailStorageProvider().createSignedReadUrl(
      plan.thumbnailStoragePath,
      // Long enough to load the page and sit on it for a while, short enough
      // that a URL copied out of devtools stops working the same afternoon.
      60 * 60,
    )
    return NextResponse.redirect(url)
  } catch (error) {
    console.error("Failed to sign plan thumbnail URL", error)
    return NextResponse.json(
      { error: "internal_error", message: "Could not load the thumbnail." },
      { status: 500 },
    )
  }
}
