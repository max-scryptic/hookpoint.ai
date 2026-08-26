import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  getVideoProcessingStatus,
  type VideoProcessingStatus,
} from "@/lib/retention-window-media-progress"

// GET /api/videos/processing-status
// Polled by the analysed-videos table while any of its rows is still being
// deep-analysed, so a row that finishes in the background swaps its
// "Processing…" spinner for the uploaded tick without the user reloading.
//
// Deliberately narrow: just the two id lists that drive those two indicators.
// The alternative - re-rendering the route - would re-read every analysed video
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
    return NextResponse.json(status satisfies VideoProcessingStatus)
  } catch (error) {
    console.error("Failed to load video processing status", error)
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong." },
      { status: 500 },
    )
  }
}
