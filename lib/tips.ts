import type { SupabaseClient } from "@supabase/supabase-js"

// Everything behind the two controls that sit on a "Try:" tip: keeping it on
// the creator's checklist, and flagging it as not useful. Shared by the API
// routes, the checklist page and the callout itself, so the rules about what a
// tip is (how long, how it is compared, where it came from) are stated once.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

export const TIP_MAX_LENGTH = 2000
export const TIP_SECTION_MAX_LENGTH = 200
export const TIP_SOURCE_PATH_MAX_LENGTH = 500
export const TIP_NOTES_MAX_LENGTH = 1000
// The fingerprint is a normalised copy of the tip, so it is bounded the same
// way the tip is, up to the column's own limit.
export const TIP_FINGERPRINT_MAX_LENGTH = 500

// Why a tip missed. Kept short and mutually exclusive so the admin table can be
// scanned by reason; anything that does not fit lands on "other" and is
// explained in the notes.
export const TIP_FEEDBACK_REASONS = [
  "not_relevant",
  "too_generic",
  "already_doing_it",
  "incorrect",
  "not_actionable",
  "other",
] as const

export type TipFeedbackReason = (typeof TIP_FEEDBACK_REASONS)[number]

export const TIP_FEEDBACK_REASON_LABELS: Record<TipFeedbackReason, string> = {
  not_relevant: "Not relevant to my video",
  too_generic: "Too generic",
  already_doing_it: "Already doing this",
  incorrect: "Incorrect or misleading",
  not_actionable: "Not actionable",
  other: "Something else",
}

export function isTipFeedbackReason(value: unknown): value is TipFeedbackReason {
  return TIP_FEEDBACK_REASONS.includes(value as TipFeedbackReason)
}

/**
 * The comparison key for one tip: lower case, with every run of punctuation and
 * whitespace collapsed to a single space. Two tips that differ only in casing
 * or punctuation are the same advice, so keeping one of them is keeping both.
 *
 * This is the only implementation of the rule. The database stores what it
 * returns and enforces uniqueness on it; the callout compares it against the
 * fingerprints already saved to decide whether its bookmark reads as filled.
 */
export function tipFingerprint(tip: string): string {
  return tip
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, TIP_FINGERPRINT_MAX_LENGTH)
}

/**
 * The path a tip was read on, kept only when it is an in-app path we can link
 * back to. Anything absolute, protocol-relative or over-long is dropped rather
 * than stored, so a saved tip can never carry a link off the site.
 */
export function normaliseTipSourcePath(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > TIP_SOURCE_PATH_MAX_LENGTH ||
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//")
  ) {
    return null
  }
  return trimmed
}

// One line of the creator's checklist.
export interface SavedTip {
  id: string
  tip: string
  section: string
  sourcePath: string | null
  completedAt: string | null
  createdAt: string
}

interface SavedTipRow {
  id: string
  tip: string
  section: string
  source_path: string | null
  completed_at: string | null
  created_at: string
}

/**
 * The creator's whole checklist, newest first. Read with the signed-in user's
 * client, so row level security scopes it to them on top of the explicit filter.
 */
export async function listSavedTips(
  supabase: SupabaseClient,
  userId: string,
): Promise<SavedTip[]> {
  const { data, error } = await supabase
    .from("saved_tips")
    .select("id, tip, section, source_path, completed_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to load saved tips: ${error.message}`)
  }

  return ((data ?? []) as SavedTipRow[]).map((row) => ({
    id: row.id,
    tip: row.tip,
    section: row.section,
    sourcePath: row.source_path,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }))
}

/**
 * Just the fingerprints of everything the creator has kept. This is what the
 * tips on a report are checked against, so the button on a tip already on the
 * checklist reads as saved rather than offering to save it again.
 */
export async function listSavedTipFingerprints(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("saved_tips")
    .select("tip_fingerprint")
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to load saved tips: ${error.message}`)
  }

  return ((data ?? []) as { tip_fingerprint: string }[]).map(
    (row) => row.tip_fingerprint,
  )
}
