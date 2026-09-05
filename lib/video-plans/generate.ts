// Turning a complete plan into its packaging read.
//
// Three steps, in one request: fetch the thumbnail out of its private bucket,
// transcribe the footage's opening seconds, then ask the model to read the
// titles, the thumbnail and that hook against one another. All three are short
// - a couple of hundred kilobytes of audio, one image, one structured call - so
// this runs inline rather than through the claim-and-continue worker the deep
// analysis needs.
//
// The claim is what stops it running twice. The plan page renders, the client
// polls, a second tab opens: any of them can arrive here at the same moment,
// and only the caller that wins the claim spends the calls.

import type { SupabaseClient } from "@supabase/supabase-js"

import { scrubDashes } from "@/lib/copy-guardrails"
import { transcriptForSegment } from "@/lib/youtube/youtube"
import {
  resolveAnalysisSourceStoragePath,
  type SourceFile,
} from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"
import { getThumbnailStorageProvider } from "@/lib/video-plans/storage"
import { PLAN_HOOK_WINDOW_SECONDS } from "@/lib/video-plans/config"
import { transcribeFootage } from "@/lib/video-plans/transcript"
import {
  generateVideoPlanPackaging,
  type VideoPlanPackaging,
} from "@/lib/video-plans/packaging-plan"
import {
  claimPackagingPlan,
  getVideoPlan,
  planReadiness,
  releasePackagingPlanClaim,
  updateVideoPlan,
  type VideoPlan,
} from "@/lib/video-plans/video-plans"

// How long the signed URLs handed to ffmpeg and to the thumbnail fetch stay
// valid. Both reads happen inside this request, so this only has to outlast one
// extraction, not a queue.
const SIGNED_READ_EXPIRY_SECONDS = 15 * 60

export type GenerateOutcome =
  // The read is finished and stored on the plan.
  | { status: "ready"; plan: VideoPlan }
  // Someone else holds the claim, or the plan is not complete yet. Either way
  // the caller should keep polling rather than treat it as an error.
  | { status: "processing" }
  | { status: "failed"; message: string }

type PackagingGenerationPhase =
  | "claim"
  | "thumbnail"
  | "source"
  | "transcript"
  | "transcript_save"
  | "packaging"
  | "report_save"

const PACKAGING_FAILURE_MESSAGES: Record<PackagingGenerationPhase, string> = {
  claim: "We couldn't start reading this plan. Try again in a moment.",
  thumbnail:
    "We couldn't read the thumbnail for this plan. Try re-uploading it.",
  source:
    "We couldn't read the uploaded footage for this plan. Try re-uploading it.",
  transcript:
    "We couldn't transcribe the uploaded footage for this plan. Try again in a moment.",
  transcript_save:
    "We transcribed the footage but couldn't save the transcript. Try again in a moment.",
  packaging:
    "We couldn't generate the packaging read this time. Try again in a moment.",
  report_save:
    "We generated the packaging read but couldn't save it. Try again in a moment.",
}

// Reads one of the plan's thumbnails back out of storage as a data URI, which
// is how the packaging call sends it (see GeneratePackagingPlanInput). The
// provider interface exposes signed reads rather than raw bytes, so this
// fetches its own signed URL - one extra hop against our own storage, and no
// key handed out.
async function readThumbnailDataUri(
  storage: StorageProvider,
  path: string,
  mimeType: string | null,
): Promise<string> {
  const url = await storage.createSignedReadUrl(
    path,
    SIGNED_READ_EXPIRY_SECONDS,
  )
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Failed to read the thumbnail (${response.status})`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return `data:${mimeType ?? "image/jpeg"};base64,${buffer.toString("base64")}`
}

function thumbnailSources(
  plan: VideoPlan,
): Array<{ path: string; mimeType: string | null }> {
  const sources = plan.thumbnailStoragePaths
    .map((path, index) =>
      path
        ? {
            path,
            mimeType: plan.thumbnailMimeTypes[index] ?? plan.thumbnailMimeType,
          }
        : null,
    )
    .filter((source): source is { path: string; mimeType: string | null } =>
      Boolean(source),
    )

  if (sources.length > 0) return sources
  return plan.thumbnailStoragePath
    ? [{ path: plan.thumbnailStoragePath, mimeType: plan.thumbnailMimeType }]
    : []
}

// Generates and stores the packaging read for a plan, unless it already has one
// or another caller is mid-flight. Never throws: a failure is recorded on the
// plan and returned, because the caller is a route answering a poll, and a 500
// there would look like an outage rather than a plan that could not be read.
export async function generatePlanPackaging(
  supabase: SupabaseClient,
  sourceStorage: StorageProvider,
  userId: string,
  planId: string,
  sourceFile: SourceFile | null,
): Promise<GenerateOutcome> {
  const plan = await getVideoPlan(supabase, userId, planId)
  if (!plan) return { status: "failed", message: "Plan not found." }

  // Already read: nothing to do, whatever the poll thinks.
  if (plan.packagingPlan) return { status: "ready", plan }

  const footageIsReady = sourceFile?.uploadStatus === "ready"
  const readiness = planReadiness(plan, footageIsReady)
  if (!readiness.ready) return { status: "processing" }

  // planReadiness above already established the footage is ready, which it can
  // only be with a source file present; narrowed here so the storage path and
  // the measured duration below can both be read off it.
  const source = sourceFile ? resolveAnalysisSourceStoragePath(sourceFile) : null
  if (!source || !sourceFile) {
    return await fail(
      supabase,
      userId,
      planId,
      "We couldn't find the uploaded footage for this plan.",
    )
  }

  let claimed = false
  let phase: PackagingGenerationPhase = "claim"
  try {
    claimed = await claimPackagingPlan(supabase, userId, planId)
    if (!claimed) return { status: "processing" }

    const thumbnailStorage = getThumbnailStorageProvider()
    const storedThumbnails = thumbnailSources(plan)
    const thumbnails =
      plan.packagingMode === "single" || plan.packagingMode === "title"
        ? storedThumbnails.slice(0, 1)
        : plan.packagingMode === "title-and-thumbnail"
          ? storedThumbnails.slice(0, plan.titles.length)
          : storedThumbnails
    phase = "thumbnail"
    const thumbnailDataUris = await Promise.all(
      thumbnails.map((thumbnail) =>
        readThumbnailDataUri(
          thumbnailStorage,
          thumbnail.path,
          thumbnail.mimeType,
        ),
      ),
    )
    phase = "source"
    const sourceUrl = await sourceStorage.createSignedReadUrl(
      source.storagePath,
      SIGNED_READ_EXPIRY_SECONDS,
    )

    // The whole script, not just the opening. Packaging reads the first thirty
    // seconds of it below; the rest is stored because retention prediction is
    // built on exactly this and re-transcribing later would be paying twice.
    //
    // Transcribing is by far the longest step (one ffmpeg decode and one upload
    // per ten minutes of footage), so it is stored the moment it finishes,
    // before the packaging call. That way an invocation killed part-way through
    // the read does not throw away a transcript the creator has already paid
    // for: the retry below finds it and goes straight to packaging.
    let cues = plan.transcript
    if (!cues) {
      phase = "transcript"
      const transcribed = await transcribeFootage(sourceUrl, {
        durationSeconds: sourceFile.uploadedDurationSeconds,
        logContext: { userId },
      })
      cues = transcribed.cues
      phase = "transcript_save"
      await updateVideoPlan(supabase, userId, planId, { transcript: cues })
    }

    phase = "packaging"
    const packaging = await generateVideoPlanPackaging(
      {
        titles: plan.titles,
        packagingMode: plan.packagingMode,
        thumbnailDataUris,
        // Sliced with the same helper the published report uses, so "the hook"
        // means the same span of speech on both.
        hookTranscript: transcriptForSegment(cues, 0, PLAN_HOOK_WINDOW_SECONDS),
      },
      { userId },
    )

    phase = "report_save"
    const updated = await updateVideoPlan(supabase, userId, planId, {
      // Model-written prose rendered verbatim on the page, so it is scrubbed of
      // dashes on the way in. See the copy guardrail in lib/copy-guardrails.ts.
      packagingPlan: scrubDashes<VideoPlanPackaging>(packaging),
      status: "ready",
      failureReason: null,
    })
    await releasePackagingPlanClaim(supabase, userId, planId, "done")
    return { status: "ready", plan: updated }
  } catch (error) {
    console.error("Failed to generate video plan packaging", {
      phase,
      error,
    })
    if (claimed) {
      await releasePackagingPlanClaim(supabase, userId, planId, "failed").catch(
        () => {},
      )
    }
    return await fail(
      supabase,
      userId,
      planId,
      PACKAGING_FAILURE_MESSAGES[phase],
    )
  }
}

// Records a failure on the plan so the page has something to show and a retry
// to offer. Best-effort: if even this write fails, the message still goes back
// to the caller.
async function fail(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  message: string,
): Promise<GenerateOutcome> {
  await updateVideoPlan(supabase, userId, planId, {
    status: "failed",
    failureReason: message,
  }).catch((error) => {
    console.error("Failed to record video plan failure", error)
  })
  return { status: "failed", message }
}
