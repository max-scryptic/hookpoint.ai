import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { getSourceFileForVideoPlan } from "@/lib/source-files/source-files"
import { getThumbnailStorageProvider } from "@/lib/video-plans/config"
import { serialiseVideoPlan } from "@/lib/video-plans/serialise"
import { deleteVideoPlan, getVideoPlan } from "@/lib/video-plans/video-plans"

// GET /api/video-plans/:planId
// The plan's current state, for the report page's poll while it is processing.
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
  if (!plan) {
    return NextResponse.json(
      { error: "not_found", message: "Plan not found." },
      { status: 404 },
    )
  }

  return NextResponse.json({ plan: serialiseVideoPlan(plan) })
}

// DELETE /api/video-plans/:planId
// Removes the plan and everything it owns. The source-file row cascades with
// it, but storage objects do not, so they are deleted here first - a cascade
// that left the footage in the bucket would leave nothing pointing at it.
export async function DELETE(
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
  if (!plan) {
    // Already gone. Deleting twice is not a failure worth reporting.
    return NextResponse.json({ deleted: true })
  }

  try {
    const sourceFile = await getSourceFileForVideoPlan(supabase, user.id, planId)
    const sourceStorage = getStorageProvider()
    for (const path of [
      sourceFile?.storagePath,
      sourceFile?.proxyStoragePath,
      sourceFile?.analysisProxyStoragePath,
    ]) {
      if (!path) continue
      await sourceStorage.deleteObject(path).catch((error) => {
        console.error("Failed to delete plan footage object", error)
      })
    }

    if (plan.thumbnailStoragePath) {
      await getThumbnailStorageProvider()
        .deleteObject(plan.thumbnailStoragePath)
        .catch((error) => {
          console.error("Failed to delete plan thumbnail object", error)
        })
    }

    await deleteVideoPlan(supabase, user.id, planId)
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Failed to delete video plan", error)
    return NextResponse.json(
      { error: "internal_error", message: "Could not delete the plan." },
      { status: 500 },
    )
  }
}
