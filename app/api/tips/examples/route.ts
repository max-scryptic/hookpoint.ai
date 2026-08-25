import { NextResponse } from "next/server"

import { getAnalysedVideo } from "@/lib/analysed-videos"
import { createClient } from "@/lib/supabase/server"
import {
  analysedVideoIdFromPath,
  canGenerateTipExamples,
  TIP_EXAMPLES_TIP_MAX_LENGTH,
} from "@/lib/tip-examples"
import {
  getOrGenerateTipExamples,
  TipExamplesRateLimitError,
  type TipExamplesVideoContext,
} from "@/lib/tip-examples-generation"
import { tipCategoryForSection, TIP_SECTION_MAX_LENGTH } from "@/lib/tips"

// The three worked examples behind one "Try:" tip, written the first time
// anybody opens it and read back from the cache after that (see
// lib/tip-examples-generation.ts).
//
// The video the examples are grounded in is looked up here rather than sent by
// the client: the request carries the path the tip was read on, the same one
// the checklist already records, and the video is resolved from it through the
// creator's own Supabase client. So the grounding can only ever be a video that
// creator has analysed, whatever a hand-written request claims.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    tip?: unknown
    section?: unknown
    sourcePath?: unknown
  }

  const tip = typeof body.tip === "string" ? body.tip.trim() : ""
  const section = typeof body.section === "string" ? body.section.trim() : ""
  if (
    !canGenerateTipExamples(tip) ||
    section.length === 0 ||
    section.length > TIP_SECTION_MAX_LENGTH
  ) {
    return NextResponse.json(
      {
        error: `Examples are only written for advice of ${TIP_EXAMPLES_TIP_MAX_LENGTH.toLocaleString()} characters or fewer.`,
      },
      { status: 400 },
    )
  }

  // Best-effort: a tip read on a page that names no video, or on a video whose
  // analysis has since been deleted, still gets examples. They are written from
  // the advice alone, which is what a head-to-head report gets anyway.
  let video: TipExamplesVideoContext | null = null
  const videoId =
    typeof body.sourcePath === "string"
      ? analysedVideoIdFromPath(body.sourcePath)
      : null
  if (videoId) {
    try {
      const analysed = await getAnalysedVideo(supabase, user.id, videoId)
      if (analysed) {
        video = {
          videoId: analysed.videoId,
          title: analysed.videoTitle,
          description: analysed.videoDetails?.description ?? null,
        }
      }
    } catch (error) {
      console.error("Failed to load video context for tip examples", error)
    }
  }

  try {
    const { examples, cached } = await getOrGenerateTipExamples({
      tip,
      section,
      // Derived from the section by the same server-side rule the checklist
      // saves by, never taken from the client.
      category: tipCategoryForSection(section),
      video,
      userId: user.id,
    })
    return NextResponse.json({ examples, cached })
  } catch (error) {
    if (error instanceof TipExamplesRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 })
    }
    console.error("Failed to generate tip examples", error)
    return NextResponse.json(
      { error: "Could not write examples for this tip." },
      { status: 500 },
    )
  }
}
