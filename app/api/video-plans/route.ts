import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { checkUploadAllowed } from "@/lib/billing/entitlements"
import {
  countDeeplyAnalysedVideos,
  VIDEO_PLANNER_VIDEO_THRESHOLD,
} from "@/lib/deep-analysis-library"
import { createVideoPlan } from "@/lib/video-plans/video-plans"
import { InvalidTitlesError, normaliseTitles } from "@/lib/video-plans/titles"

// POST /api/video-plans
// Body: { titles: string[] }
// Creates the draft plan the builder then attaches a thumbnail and footage to.
// The row exists first because both of those need something to hang off: the
// thumbnail's object path is keyed on the plan id, and so is the source file's.
export async function POST(request: NextRequest) {
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

  // The planner is an upload feature, so it is gated exactly where every other
  // upload is: on whether the plan includes raw uploads at all. The duration is
  // passed as 0 deliberately - a plan's packaging read is a single model call
  // over one image and thirty seconds of audio, not the per-minute deep
  // analysis that deep-dive credits meter, so it must not be priced as one.
  // The size cap is still enforced, at the point the footage is offered.
  const uploadCheck = await checkUploadAllowed(user.id, {
    sizeBytes: null,
    durationSeconds: 0,
  })
  if (!uploadCheck.allowed) {
    return NextResponse.json(
      { error: uploadCheck.reason, message: uploadCheck.message },
      { status: 402 },
    )
  }

  // The second gate: a plan is read against the creator's own library, so it
  // needs enough deeply analysed videos underneath it to have something to read
  // against. Same threshold the page shows its meter against
  // (app/(app)/video-planner/page.tsx), enforced here so the gate is not just a
  // hidden button. Best-effort in the same direction as the page: a failed
  // count lets the plan through rather than refusing a creator over a database
  // hiccup.
  try {
    const libraryVideoCount = await countDeeplyAnalysedVideos(supabase, user.id)
    if (libraryVideoCount < VIDEO_PLANNER_VIDEO_THRESHOLD) {
      return NextResponse.json(
        {
          error: "library_too_small",
          message: `The Video Planner opens once ${VIDEO_PLANNER_VIDEO_THRESHOLD} of your videos have been deeply analysed. You have ${libraryVideoCount} so far.`,
        },
        { status: 403 },
      )
    }
  } catch (error) {
    console.error("Failed to count deeply analysed videos", error)
  }

  let titles: string[]
  try {
    titles = normaliseTitles(body.titles)
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
    const plan = await createVideoPlan(supabase, { userId: user.id, titles })
    return NextResponse.json({ plan: { id: plan.id, titles: plan.titles } })
  } catch (error) {
    console.error("Failed to create video plan", error)
    return NextResponse.json(
      { error: "internal_error", message: "Could not start the plan." },
      { status: 500 },
    )
  }
}
