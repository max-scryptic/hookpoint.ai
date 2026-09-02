import { NextResponse, after, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { getSourceFileForVideoPlan } from "@/lib/source-files/source-files"
import { generatePlanPackaging } from "@/lib/video-plans/generate"
import { serialiseVideoPlan } from "@/lib/video-plans/serialise"
import {
  getVideoPlan,
  planReadiness,
  updateVideoPlan,
} from "@/lib/video-plans/video-plans"

// Transcribing the opening and reading the packaging happens in after(), so it
// runs past the response but still inside this invocation's budget. Give it
// room: a cold ffmpeg decode over a signed URL is the slow part.
export const maxDuration = 300

// POST /api/video-plans/:planId/process
//
// Both the kick and the poll. It answers with the plan's current state
// immediately and, when there is a read still to do, schedules it behind the
// response. That makes it safe to call on a timer: the generation itself is
// claim-guarded (lib/video-plans/video-plans.ts), so a second caller arriving
// mid-flight simply loses the claim and reports "processing", and a claim
// abandoned by a killed invocation goes stale and is picked up by a later poll.
export async function POST(
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

  // Already read: hand it straight back, and don't schedule anything.
  if (plan.packagingPlan) {
    return NextResponse.json({ plan: serialiseVideoPlan(plan) })
  }

  const sourceFile = await getSourceFileForVideoPlan(supabase, user.id, planId)
  const readiness = planReadiness(plan, sourceFile?.uploadStatus === "ready")
  if (!readiness.ready) {
    // Not everything is in yet. This is the normal state while the footage is
    // still landing, so it is not an error - the caller keeps polling.
    return NextResponse.json({
      plan: serialiseVideoPlan(plan),
      waitingFor: readiness.reason,
    })
  }

  // Move the plan out of "draft" the moment everything is in, so a reload
  // between the upload landing and the read finishing shows the plan working
  // rather than looking half-built.
  const processing =
    plan.status === "draft" || plan.status === "failed"
      ? await updateVideoPlan(supabase, user.id, planId, {
          status: "processing",
          failureReason: null,
        }).catch((error) => {
          console.error("Failed to mark video plan processing", error)
          return plan
        })
      : plan

  after(async () => {
    await generatePlanPackaging(
      supabase,
      getStorageProvider(),
      user.id,
      planId,
      sourceFile,
    )
  })

  return NextResponse.json({ plan: serialiseVideoPlan(processing) })
}
