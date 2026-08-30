// Client-facing serialisation for a video plan. Type-imports only, so the
// builder, the report and the routes can share one shape without pulling server
// code into the browser bundle - the same split as
// lib/source-files/serialise.ts.
//
// Storage paths are never exposed. The thumbnail is reached through
// /api/video-plans/:id/thumbnail, which signs a short-lived URL per request.

import { transcriptForSegment } from "@/lib/youtube/youtube"
import { PLAN_HOOK_WINDOW_SECONDS } from "@/lib/video-plans/config"
import type { VideoPlanPackaging } from "@/lib/video-plans/packaging-plan"
import type { VideoPlan, VideoPlanStatus } from "@/lib/video-plans/video-plans"

export interface SerialisedVideoPlan {
  id: string
  titles: string[]
  status: VideoPlanStatus
  failureReason: string | null
  // Whether a thumbnail has been stored, which is all the client needs to know:
  // where it lives is the server's business.
  hasThumbnail: boolean
  // The spoken opening alone, sliced out of the stored script.
  hookTranscript: string | null
  packagingPlan: VideoPlanPackaging | null
  createdAt: string
  updatedAt: string
}

export function serialiseVideoPlan(plan: VideoPlan): SerialisedVideoPlan {
  return {
    id: plan.id,
    titles: plan.titles,
    status: plan.status,
    failureReason: plan.failureReason,
    hasThumbnail: plan.thumbnailStoragePath != null,
      // Only the opening reaches the browser. The whole script can be tens of
    // kilobytes and the report shows the hook alone, so the rest stays on the
    // server until retention prediction has a use for it.
    hookTranscript: plan.transcript
      ? transcriptForSegment(plan.transcript, 0, PLAN_HOOK_WINDOW_SECONDS)
      : null,
    packagingPlan: plan.packagingPlan,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  }
}
