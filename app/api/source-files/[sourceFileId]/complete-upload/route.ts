import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import { completeSourceFileUpload } from "@/lib/source-files/upload-service"
import { errorResponse, serialiseSourceFile } from "@/lib/source-files/http"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import { getEntitlement, incrementUsage } from "@/lib/billing/entitlements"
import { creditsForDurationSeconds, maxUploadBytesForPlan } from "@/lib/plans"
import { updateSourceFile, type SourceFile } from "@/lib/source-files/source-files"
import type { CompletedPart } from "@/lib/storage"

// Extraction runs in the background via after() once the response is sent, but
// still within this invocation's time budget — give it room beyond the default.
export const maxDuration = 300

// POST /api/source-files/:sourceFileId/complete-upload
// Body: { durationSeconds?: number, uploadId?: string,
//         parts?: { partNumber, etag }[] }
// Called by the browser once the direct upload finishes. For a multipart upload
// it first assembles the parts into the final object; then (either path) it
// verifies the object exists in storage, records its real size, validates against
// the browser-measured duration and returns the resulting source-file state.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceFileId: string }> },
) {
  const { sourceFileId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // The body can only be read once, and it carries both the (optional) measured
  // duration and, for multipart uploads, the part list — so parse it once here.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  // The browser-measured duration is optional: missing/invalid just means we
  // couldn't read it (the service degrades to a "couldn't verify" warning).
  let clientDurationSeconds: number | null = null
  if (typeof (body as { durationSeconds?: unknown })?.durationSeconds === "number") {
    clientDurationSeconds = (body as { durationSeconds: number }).durationSeconds
  }

  // The single-PUT path sends no part list; only multipart uploads post one.
  const multipart = parseMultipartBody(body)

  // Resolve the user's plan once: its size cap gates completion, and its window
  // is where the deep-dive credit charge lands below.
  const entitlement = await getEntitlement(user.id)

  try {
    let sourceFile = await completeSourceFileUpload(
      supabase,
      getStorageProvider(),
      {
        userId: user.id,
        sourceFileId,
        clientDurationSeconds,
        multipart,
        maxUploadBytes: maxUploadBytesForPlan(entitlement.plan),
      },
    )

    // Charge deep-dive credits for the footage now that it's really landed, once
    // per file (deepCreditsCharged guards re-completions and later retries).
    // Best-effort: a metering hiccup must not fail a good upload — the upload was
    // already gated on available credits at initiate time.
    sourceFile = await chargeDeepCreditsIfNeeded(
      supabase,
      user.id,
      entitlement.periodStart,
      sourceFile,
    )
    // Deep analysis can start decoding the just-uploaded original right now,
    // in parallel with the 720p/360p proxy transcode that was kicked off
    // above — the retention windows may already exist (analyze usually runs
    // before the upload), and waiting for the normalisation callback would
    // leave the whole extraction pipeline idle through an external transcode
    // round-trip. If the analysis hasn't run yet this no-ops, and /api/analyze
    // triggers extraction itself once the windows exist.
    triggerRetentionWindowMediaExtraction(sourceFile)
    return NextResponse.json({ sourceFile: serialiseSourceFile(sourceFile) })
  } catch (error) {
    return errorResponse(error)
  }
}

// Charges the deep-dive credits a ready source file's deep analysis costs
// (~1 credit per minute of footage), exactly once. Returns the file with its
// deep_credits_charged stamp so re-completions and retries don't recharge. A
// non-ready file, or one already charged, is returned unchanged.
async function chargeDeepCreditsIfNeeded(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  periodStart: Date,
  sourceFile: SourceFile,
): Promise<SourceFile> {
  if (sourceFile.uploadStatus !== "ready" || sourceFile.deepCreditsCharged != null) {
    return sourceFile
  }
  const cost = creditsForDurationSeconds(sourceFile.youtubeDurationSeconds ?? 0)
  try {
    if (cost > 0) {
      await incrementUsage(userId, periodStart, { deepCredits: cost })
    }
    return await updateSourceFile(supabase, userId, sourceFile.id, {
      deepCreditsCharged: cost,
    })
  } catch (error) {
    console.error("Failed to charge deep-dive credits", error)
    return sourceFile
  }
}

// Pulls a well-formed { uploadId, parts } out of the already-parsed body, or
// returns undefined for the single-PUT path (no part list). Malformed part lists
// are ignored rather than failing the request, since completion then surfaces a
// clear object_missing error from the storage layer.
function parseMultipartBody(
  body: unknown,
): { uploadId: string; parts: CompletedPart[] } | undefined {
  if (typeof body !== "object" || body === null) return undefined

  const { uploadId, parts } = body as {
    uploadId?: unknown
    parts?: unknown
  }
  if (typeof uploadId !== "string" || !Array.isArray(parts)) return undefined

  const cleaned: CompletedPart[] = []
  for (const part of parts) {
    if (
      typeof part === "object" &&
      part !== null &&
      typeof (part as { partNumber?: unknown }).partNumber === "number" &&
      typeof (part as { etag?: unknown }).etag === "string"
    ) {
      const p = part as { partNumber: number; etag: string }
      cleaned.push({ partNumber: p.partNumber, etag: p.etag })
    }
  }
  if (cleaned.length === 0) return undefined

  return { uploadId, parts: cleaned }
}
