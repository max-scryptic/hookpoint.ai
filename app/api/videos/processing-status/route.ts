import { NextResponse } from "next/server"

import type { SupabaseClient } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/server"
import { listResumableDeepAnalysisSourceFiles } from "@/lib/deep-analysis-resume"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import {
  getVideoProcessingStatus,
  type VideoProcessingStatus,
} from "@/lib/retention-window-media-progress"

// Resumed pipelines run in this invocation's after() callback, so this route
// needs the same budget as every other trigger point for them.
export const maxDuration = 300

// At most one video per poll: this endpoint is hit every few seconds by every
// open dashboard, and a stalled pipeline's next stage is expensive. One is
// enough to make a watched list recover promptly, and the cron sweep handles
// backlogs.
const MAX_VIDEOS_PER_POLL = 1

// Best-effort: a poll that can't work out what to resume should still return
// the status it came for, so this never rejects into the caller's error path.
async function resumeStalledDeepAnalysis(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    const sourceFiles = await listResumableDeepAnalysisSourceFiles(supabase, {
      userId,
      limit: MAX_VIDEOS_PER_POLL,
    })
    for (const sourceFile of sourceFiles) {
      triggerRetentionWindowMediaExtraction(sourceFile)
    }
  } catch (error) {
    console.error("Failed to resume stalled deep analysis from list poll", error)
  }
}

// GET /api/videos/processing-status
// Polled by the analysed-videos table while any of its rows is still being
// deep-analysed, so a row that finishes in the background swaps its
// "Processing…" spinner for the uploaded tick without the user reloading.
//
// Deliberately narrow: just the two id lists that drive those two indicators.
// The alternative — re-rendering the route — would re-read every analysed video
// with its full retention curve and transcript on every tick, which is far too
// much to pay for a flag flipping.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const status = await getVideoProcessingStatus(supabase, user.id)

    // While this list is showing anything as "Processing…", use the poll it is
    // already making to resume pipelines that have stalled with no invocation
    // behind them. The per-video detail page has done this for a while; doing
    // it here too means a user watching the list — the far more common place to
    // be waiting — recovers a stalled video without having to open it.
    //
    // Gated on there being something to resume so a healthy dashboard pays
    // nothing for this, and bounded well below the list poll's frequency by the
    // sweeper's own cooldown, which leaves a video alone while a recent run is
    // still young. The cron sweep is what guarantees recovery with no browser
    // open at all; this just makes it immediate when someone is watching.
    if (status.processingVideoIds.length > 0) {
      await resumeStalledDeepAnalysis(supabase, user.id)
    }

    return NextResponse.json(status satisfies VideoProcessingStatus)
  } catch (error) {
    console.error("Failed to load video processing status", error)
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong." },
      { status: 500 },
    )
  }
}
