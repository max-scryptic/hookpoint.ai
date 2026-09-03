import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { getSourceFileForVideoPlan } from "@/lib/source-files/source-files"
import { getThumbnailStorageProvider } from "@/lib/video-plans/storage"
import { serialiseVideoPlan } from "@/lib/video-plans/serialise"
import { InvalidTitlesError, normaliseTitles } from "@/lib/video-plans/titles"
import {
  deleteVideoPlan,
  getVideoPlan,
  updateVideoPlan,
} from "@/lib/video-plans/video-plans"

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

// PATCH /api/video-plans/:planId
// Body: { titles: string[] }
// Saves the title ideas a creator is typing into a draft, so the plan they come
// back to is the one they left. Only a draft takes them: once the read has been
// started the titles are what it was written about, and rewriting them would
// leave a report describing wording that is no longer on the plan.
export async function PATCH(
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

  let body: { titles?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const plan = await getVideoPlan(supabase, user.id, planId)
  if (!plan) {
    return NextResponse.json(
      { error: "not_found", message: "Plan not found." },
      { status: 404 },
    )
  }

  if (plan.status !== "draft") {
    return NextResponse.json(
      {
        error: "already_started",
        message: "This plan has already been read, so its titles are fixed.",
      },
      { status: 409 },
    )
  }

  let titles: string[]
  try {
    // Empty is allowed: a draft is filled in over time, and a creator clearing
    // the box mid-thought must not lose the plan.
    titles = normaliseTitles(body.titles, { allowEmpty: true })
  } catch (error) {
    if (error instanceof InvalidTitlesError) {
      return NextResponse.json(
        { error: "invalid_titles", message: error.message },
        { status: 400 },
      )
    }
    throw error
  }

  try {
    const updated = await updateVideoPlan(supabase, user.id, planId, { titles })
    return NextResponse.json({ plan: serialiseVideoPlan(updated) })
  } catch (error) {
    console.error("Failed to update video plan titles", error)
    return NextResponse.json(
      { error: "internal_error", message: "Could not save your titles." },
      { status: 500 },
    )
  }
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

    const thumbnailPaths = [
      ...plan.thumbnailStoragePaths,
      plan.thumbnailStoragePath,
    ].filter((path, index, paths): path is string => {
      return Boolean(path) && paths.indexOf(path) === index
    })

    for (const path of thumbnailPaths) {
      await getThumbnailStorageProvider()
        .deleteObject(path)
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
