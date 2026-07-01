import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getStorageProvider } from "@/lib/storage/provider"
import { getNormalisationCallbackSecret } from "@/lib/source-files/normalisation-config"
import {
  getSourceFileById,
  getSourceFileByNormalisationTaskToken,
} from "@/lib/source-files/source-files"
import {
  applyNormalisationCallback,
  parseQencodeCallback,
} from "@/lib/source-files/normalisation-service"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"

// Extraction runs in the background via after() once the response is sent, but
// still within this invocation's time budget — give it room beyond the default.
export const maxDuration = 300

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

  // Qencode POSTs callbacks as application/x-www-form-urlencoded, not JSON
  // (task_token/event as plain fields, a JSON-encoded `status` field for the
  // rest). formData() parses both url-encoded and multipart bodies; fall back
  // to a JSON body in case that ever changes.
  let fields: Record<string, string> = {}
  try {
    const form = await request.formData()
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") fields[key] = value
    }
  } catch {
    try {
      const json = await request.json()
      if (json && typeof json === "object") {
        for (const [key, value] of Object.entries(json)) {
          fields[key] = typeof value === "string" ? value : JSON.stringify(value)
        }
      }
    } catch {
      fields = {}
    }
  }

  const callback = parseQencodeCallback(fields)
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

    // The retention analysis may already have run for this video (this
    // callback can land after /api/analyze) — if so, kick off extraction now
    // instead of waiting on a future analyze call.
    if (callback.outcome === "completed") {
      const updated = await getSourceFileById(
        admin,
        sourceFile.userId,
        sourceFile.id,
      )
      triggerRetentionWindowMediaExtraction(updated)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to process normalisation callback", error)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
