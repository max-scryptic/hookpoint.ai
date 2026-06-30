import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getStorageProvider } from "@/lib/storage/provider"
import { getNormalisationCallbackSecret } from "@/lib/source-files/normalisation-config"
import { getSourceFileByNormalisationTaskToken } from "@/lib/source-files/source-files"
import {
  applyNormalisationCallback,
  parseQencodeCallback,
} from "@/lib/source-files/normalisation-service"

// POST /api/source-files/normalisation-callback?secret=...
// Server-to-server status webhook called by Qencode when a transcode job
// progresses or finishes. Unauthenticated (no user session), so it's protected
// by a shared secret and uses the service-role admin client to find and update
// the row. On success the original master is deleted and playback flips to the
// 1080p proxy; on error the original is kept as the fallback.
//
// Always returns 200 for events we can't act on (bad secret aside) so the
// transcoder doesn't pointlessly retry a callback we've already handled or that
// targets a row we no longer have.
export async function POST(request: NextRequest) {
  const expectedSecret = getNormalisationCallbackSecret()
  if (expectedSecret) {
    const provided = request.nextUrl.searchParams.get("secret")
    if (provided !== expectedSecret) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const callback = parseQencodeCallback(body)
  if (!callback) {
    // Nothing actionable (no task token) — acknowledge so it isn't retried.
    return NextResponse.json({ ok: true })
  }

  try {
    const admin = createAdminClient()
    const sourceFile = await getSourceFileByNormalisationTaskToken(
      admin,
      callback.taskToken,
    )
    if (!sourceFile) {
      // Unknown/stale job (e.g. the row was deleted). Acknowledge and move on.
      return NextResponse.json({ ok: true })
    }

    await applyNormalisationCallback(
      admin,
      getStorageProvider(),
      sourceFile,
      callback,
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to process normalisation callback", error)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
