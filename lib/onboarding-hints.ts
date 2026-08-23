import type { SupabaseClient } from "@supabase/supabase-js"

// The one-time hints a creator can meet in the interface, keyed by what each
// one teaches.
//
// Each points at something the interface offers but does not announce, and each
// is retired the moment the creator uses the thing it points at — starting an
// analysis, clicking a highlight, opening a footage tab — since at that point
// they know it is there.
//
// A hint is pending while the creator has no row for it in onboarding_hints,
// which means a key added here ships as "not yet seen" for every account.
export const ONBOARDING_HINTS = [
  // The two ways to start an analysis on the Analyse a Video page: paste a URL,
  // or open the actions menu on a row of your uploads. Shown side by side, and
  // only to a creator who has not analysed anything yet — the row menu in
  // particular gives no sign that it is where an analysis begins.
  "first_video_analysis",
  // The retention chart's highlights play their window back from the uploaded
  // footage. Points at the first highlight on the curve.
  "retention_insight_playback",
  // The deeper analysis adds a tab per conclusion to the windows below the
  // chart, alongside the transcript's own "Script" reading. Marks them as new.
  "deep_analysis_window_tabs",
] as const

export type OnboardingHint = (typeof ONBOARDING_HINTS)[number]

export function isOnboardingHint(value: unknown): value is OnboardingHint {
  return ONBOARDING_HINTS.includes(value as OnboardingHint)
}

// The hints this creator has not met yet. Read on the server so the report's
// first paint already knows which coach marks to draw: a hint decided a poll
// later would flash onto the page of someone who dismissed it long ago.
export async function getPendingOnboardingHints(
  supabase: SupabaseClient,
  userId: string,
): Promise<OnboardingHint[]> {
  const { data, error } = await supabase
    .from("onboarding_hints")
    .select("hint")
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to load onboarding hints: ${error.message}`)
  }

  const seen = new Set(
    ((data ?? []) as { hint: string }[]).map((row) => row.hint),
  )
  return ONBOARDING_HINTS.filter((hint) => !seen.has(hint))
}

// Postgres' unique_violation. Recording a hint twice is the ordinary outcome of
// two reports being open at once, not a failure.
const UNIQUE_VIOLATION = "23505"

export async function markOnboardingHintSeen(
  supabase: SupabaseClient,
  userId: string,
  hint: OnboardingHint,
): Promise<void> {
  const { error } = await supabase
    .from("onboarding_hints")
    .insert({ user_id: userId, hint })

  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`Failed to record onboarding hint: ${error.message}`)
  }
}
