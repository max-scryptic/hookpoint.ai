// Read/write helpers for the `video_plans` table - a plan for a video that has
// not been published yet: its candidate titles, its thumbnail, and (through
// source_files) its footage.
//
// Everything here goes through a user-scoped Supabase client so RLS confirms
// ownership on every read and write. Nothing in the planner runs "as the
// system" the way the deep-analysis workers do, because every step of a plan
// happens while its owner is present.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { VideoPlanPackaging } from "@/lib/video-plans/packaging-plan"

export type VideoPlanStatus = "draft" | "processing" | "ready" | "failed"

export interface VideoPlan {
  id: string
  userId: string
  titles: string[]
  thumbnailStoragePath: string | null
  thumbnailMimeType: string | null
  thumbnailSizeBytes: number | null
  status: VideoPlanStatus
  failureReason: string | null
  hookTranscript: string | null
  packagingPlan: VideoPlanPackaging | null
  createdAt: string
  updatedAt: string
}

interface VideoPlanRow {
  id: string
  user_id: string
  titles: string[] | null
  thumbnail_storage_path: string | null
  thumbnail_mime_type: string | null
  thumbnail_size_bytes: number | null
  status: VideoPlanStatus
  failure_reason: string | null
  hook_transcript: string | null
  packaging_plan: VideoPlanPackaging | null
  created_at: string
  updated_at: string
}

const COLUMNS =
  "id, user_id, titles, thumbnail_storage_path, thumbnail_mime_type, thumbnail_size_bytes, status, failure_reason, hook_transcript, packaging_plan, created_at, updated_at"

export function mapVideoPlanRow(row: VideoPlanRow): VideoPlan {
  return {
    id: row.id,
    userId: row.user_id,
    titles: row.titles ?? [],
    thumbnailStoragePath: row.thumbnail_storage_path,
    thumbnailMimeType: row.thumbnail_mime_type,
    thumbnailSizeBytes: row.thumbnail_size_bytes,
    status: row.status,
    failureReason: row.failure_reason,
    hookTranscript: row.hook_transcript,
    packagingPlan: row.packaging_plan,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createVideoPlan(
  supabase: SupabaseClient,
  input: { userId: string; titles: string[] },
): Promise<VideoPlan> {
  const { data, error } = await supabase
    .from("video_plans")
    .insert({
      user_id: input.userId,
      titles: input.titles,
      status: "draft",
    })
    .select(COLUMNS)
    .single()

  if (error) {
    throw new Error(`Failed to create video plan: ${error.message}`)
  }

  return mapVideoPlanRow(data as VideoPlanRow)
}

export async function getVideoPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
): Promise<VideoPlan | null> {
  const { data, error } = await supabase
    .from("video_plans")
    .select(COLUMNS)
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load video plan: ${error.message}`)
  }

  return data ? mapVideoPlanRow(data as VideoPlanRow) : null
}

// The user's plans, newest first. Used by the planner index to list what they
// have already planned beneath the form that starts a new one.
export async function listVideoPlans(
  supabase: SupabaseClient,
  userId: string,
  limit = 50,
): Promise<VideoPlan[]> {
  const { data, error } = await supabase
    .from("video_plans")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to list video plans: ${error.message}`)
  }

  return ((data as VideoPlanRow[] | null) ?? []).map(mapVideoPlanRow)
}

export interface UpdateVideoPlanInput {
  titles?: string[]
  thumbnailStoragePath?: string | null
  thumbnailMimeType?: string | null
  thumbnailSizeBytes?: number | null
  status?: VideoPlanStatus
  failureReason?: string | null
  hookTranscript?: string | null
  packagingPlan?: VideoPlanPackaging | null
}

function toRow(input: UpdateVideoPlanInput): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if ("titles" in input) row.titles = input.titles
  if ("thumbnailStoragePath" in input)
    row.thumbnail_storage_path = input.thumbnailStoragePath
  if ("thumbnailMimeType" in input)
    row.thumbnail_mime_type = input.thumbnailMimeType
  if ("thumbnailSizeBytes" in input)
    row.thumbnail_size_bytes = input.thumbnailSizeBytes
  if ("status" in input) row.status = input.status
  if ("failureReason" in input) row.failure_reason = input.failureReason
  if ("hookTranscript" in input) row.hook_transcript = input.hookTranscript
  if ("packagingPlan" in input) row.packaging_plan = input.packagingPlan
  return row
}

export async function updateVideoPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  input: UpdateVideoPlanInput,
): Promise<VideoPlan> {
  const { data, error } = await supabase
    .from("video_plans")
    .update(toRow(input))
    .eq("id", planId)
    .eq("user_id", userId)
    .select(COLUMNS)
    .single()

  if (error) {
    throw new Error(`Failed to update video plan: ${error.message}`)
  }

  return mapVideoPlanRow(data as VideoPlanRow)
}

export async function deleteVideoPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
): Promise<void> {
  const { error } = await supabase
    .from("video_plans")
    .delete()
    .eq("id", planId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to delete video plan: ${error.message}`)
  }
}

// --- Everything a plan needs before it can be read -------------------------

export type PlanNotReadyReason = "no_titles" | "no_thumbnail" | "no_footage"

export type PlanReadiness =
  | { ready: true }
  | { ready: false; reason: PlanNotReadyReason }

// Whether a plan has all three of the things the packaging read is about. Pure,
// so the form's own enablement rule and the server's refusal to start
// processing are the same rule rather than two that can drift.
export function planReadiness(
  plan: Pick<VideoPlan, "titles" | "thumbnailStoragePath">,
  footageIsReady: boolean,
): PlanReadiness {
  if (plan.titles.length === 0) return { ready: false, reason: "no_titles" }
  if (!plan.thumbnailStoragePath) {
    return { ready: false, reason: "no_thumbnail" }
  }
  if (!footageIsReady) return { ready: false, reason: "no_footage" }
  return { ready: true }
}

export const PLAN_READINESS_MESSAGE: Record<PlanNotReadyReason, string> = {
  no_titles: "Add at least one title idea before starting the plan.",
  no_thumbnail: "Upload your thumbnail before starting the plan.",
  no_footage: "Your footage is still uploading.",
}

// --- Claiming the packaging read -------------------------------------------
//
// The same atomic claim the analysed-video analyses use (lib/analysis-claim.ts),
// against this table's own claim columns. Several callers can legitimately
// arrive at once - the plan page rendering, a second tab, the client's poll
// after the upload lands - and only one of them should spend the model call.

const CLAIM_STALE_MS = 10 * 60 * 1000

// Claims the right to generate this plan's packaging read. Returns false when
// another caller already holds it; the loser skips generating and picks up the
// winner's result on its next read.
export async function claimPackagingPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString()

  const { data, error } = await supabase
    .from("video_plans")
    .update({
      packaging_plan_status: "processing",
      packaging_plan_claimed_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .eq("user_id", userId)
    .or(
      `packaging_plan_status.is.null,packaging_plan_status.eq.failed,packaging_plan_claimed_at.lt.${staleBefore}`,
    )
    .select("id")

  if (error) {
    throw new Error(`Failed to claim packaging plan: ${error.message}`)
  }

  return (data?.length ?? 0) > 0
}

// Releases a claim. 'done' clears it - packaging_plan being non-null is the
// source of truth for "already generated" from then on. 'failed' leaves a
// marker so the next attempt retries immediately rather than waiting out the
// staleness window.
export async function releasePackagingPlanClaim(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  outcome: "done" | "failed",
): Promise<void> {
  const { error } = await supabase
    .from("video_plans")
    .update({
      packaging_plan_status: outcome === "done" ? null : "failed",
      packaging_plan_claimed_at: null,
    })
    .eq("id", planId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to release packaging plan claim: ${error.message}`)
  }
}
