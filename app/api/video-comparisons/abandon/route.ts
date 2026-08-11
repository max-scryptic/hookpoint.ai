import { NextResponse, type NextRequest } from "next/server"

import { rollBackComparisonForPair } from "@/lib/comparison-cleanup"
import { createClient } from "@/lib/supabase/server"
import { ABANDONED_COMPARISON_GRACE_MS } from "@/lib/video-comparisons"

// POST /api/video-comparisons/abandon
// Body: { videoAId: string, videoBId: string, startedAt: string }
//
// The creator walked away from a comparison that was still being written. The
// pair was saved and charged for before the first report could be written onto
// it, so left alone it would sit in their history opening onto an empty report.
// This undoes that run: the row it created is deleted and its credits are handed
// back, leaving them exactly where they were before they pressed the button.
//
// The browser sends this on its way out of the page (see the Video Comparator
// picker), which means it has to survive the page going away: it is a beacon,
// fired and forgotten, so nothing here reports back to a client that is already
// gone. It is also not the only thing watching for an abandoned run. The
// generate endpoint notices the dropped connection itself, and a sweep on the
// next page load catches the runs neither of them got to report. All three end
// in the same delete, and only the one that actually removes a row refunds, so
// arriving twice is harmless.
//
// startedAt is when the creator pressed the button, and it is what keeps this
// from taking anything that is not the abandoned run's own: a pair generated
// (and paid for) previously was created long before that moment, so re-opening
// one to fill in a missing section can never delete it.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const payload = body as {
    videoAId?: unknown
    videoBId?: unknown
    startedAt?: unknown
  } | null
  const videoAId = readId(payload?.videoAId)
  const videoBId = readId(payload?.videoBId)
  const startedAt = readStartedAt(payload?.startedAt)
  if (!videoAId || !videoBId || videoAId === videoBId || !startedAt) {
    return NextResponse.json({ error: "Nothing to abandon." }, { status: 400 })
  }

  const rolledBack = await rollBackComparisonForPair(
    supabase,
    user.id,
    videoAId,
    videoBId,
    startedAt,
  )

  return NextResponse.json({ rolledBack })
}

function readId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

// A browser's clock can sit a little either side of the server's, and the row
// this is meant to take back was stamped by the server's. Allow for that, so a
// creator whose clock runs fast still gets their run undone.
const CLOCK_SKEW_ALLOWANCE_MS = 2 * 60 * 1000

// The moment the run started, as the client reported it. Clock skew and a
// hand-edited value both point the same way, so the timestamp is only ever
// trusted to reach back as far as a run could plausibly still be in flight: no
// call here can touch a pair generated before that, whatever it claims. What
// stops the skew allowance from reaching an older pair is the delete itself,
// which only ever takes a row with no written report on it at all.
function readStartedAt(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const reported = new Date(value)
  if (Number.isNaN(reported.getTime())) return null

  const startedAt = new Date(reported.getTime() - CLOCK_SKEW_ALLOWANCE_MS)
  const floor = new Date(Date.now() - ABANDONED_COMPARISON_GRACE_MS)
  return startedAt.getTime() < floor.getTime() ? floor : startedAt
}
