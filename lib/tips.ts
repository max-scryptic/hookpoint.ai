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

// Which product surface a tip was read on. The section a tip carries names the
// part of a report it came from ("Packaging: Title", "Retention: Drop-off"),
// but not which report that was, and the same section names appear on more than
// one. The surface is the level above it, so the admin can ask "how is the
// comparison report doing" before drilling into a section.
export const TIP_SURFACES = [
  "video_analysis",
  "comparison_report",
  "unknown",
] as const

export type TipSurface = (typeof TIP_SURFACES)[number]

export const TIP_SURFACE_LABELS: Record<TipSurface, string> = {
  video_analysis: "Video analysis",
  comparison_report: "Comparison report",
  unknown: "Unknown",
}

// The surface is recovered from the path the tip was read on, which is the only
// thing recorded that actually identifies the report. Prefixes, not exact
// matches, since both surfaces carry an id or a query in the rest of the path.
const TIP_SURFACE_PATH_PREFIXES: { prefix: string; surface: TipSurface }[] = [
  { prefix: "/dashboard/analysed-video/", surface: "video_analysis" },
  {
    prefix: "/dashboard/video-comparator/report",
    surface: "comparison_report",
  },
]

/**
 * Where a flagged or saved tip was read: the surface, with the section as the
 * drill-down beneath it.
 *
 * The path decides it wherever there is one. A tip stored without a usable path
 * falls back to its section, which still settles the comparison report because
 * only a head-to-head names its sections that way; anything else is reported as
 * unknown rather than guessed at.
 */
export function tipSurface(
  sourcePath: string | null | undefined,
  section: string | null | undefined,
): TipSurface {
  const path = (sourcePath ?? "").split("?")[0]
  for (const { prefix, surface } of TIP_SURFACE_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return surface
  }
  if (/head-to-head/i.test(section ?? "")) return "comparison_report"
  return "unknown"
}

// What a tip is actually about, as opposed to the surface it was read on. A
// creator working through their checklist thinks in these terms ("what am I
// fixing about the hook?"), not in report sections, so the checklist groups by
// this and the admin can see which kind of advice keeps missing.
//
// Listed in the order they are worked through when planning a video, which is
// also the order the checklist renders its groups in.
export const TIP_CATEGORIES = [
  "hook",
  "retention",
  "attention",
  "script",
  "packaging",
  "delivery",
  "other",
] as const

export type TipCategory = (typeof TIP_CATEGORIES)[number]

// Written so two neighbouring groups can never be confused for each other:
// "Retention" and "Attention" side by side say nothing, "Drop-offs" and
// "Keeping attention" say exactly what belongs under each.
export const TIP_CATEGORY_LABELS: Record<TipCategory, string> = {
  hook: "Hook",
  retention: "Drop-offs",
  attention: "Keeping attention",
  script: "Script",
  packaging: "Packaging",
  delivery: "Delivery",
  other: "Other",
}

export function isTipCategory(value: unknown): value is TipCategory {
  return TIP_CATEGORIES.includes(value as TipCategory)
}

// Ordered rules read against the section a tip was rendered in, first match
// wins. Order carries the meaning here, so the list is worth reading top down:
//
//  - The tab a tip sits on is the strongest signal there is, so a "... : Script"
//    or "... : Deep analysis" suffix decides the category before anything in the
//    rest of the section can. A script rewrite for the hook is a script tip.
//  - "Drop-off" is separated from the other retention moments on purpose: a gain
//    or a hold is about keeping the viewers already watching, a drop-off is
//    about losing them, and the two want different work.
//  - A bare "Retention: ..." that matched nothing more specific lands on
//    retention last, so the generic word never steals a gain or a hold.
//
// Sections are part model-written (comparison report headings), so anything
// unrecognised falls through to "other" rather than being forced into a group.
const TIP_CATEGORY_RULES: { pattern: RegExp; category: TipCategory }[] = [
  { pattern: /\bscripts?\b/, category: "script" },
  {
    pattern: /deep analysis|non-?verbal|delivery|editing|visuals?\b/,
    category: "delivery",
  },
  { pattern: /\bhooks?\b|\bopening?s?\b|first (few )?seconds/, category: "hook" },
  { pattern: /packaging|thumbnails?|\btitles?\b/, category: "packaging" },
  { pattern: /drop-?offs?|\bdrops?\b/, category: "retention" },
  { pattern: /\bgains?\b|\bholds?\b|pacing|attention/, category: "attention" },
  { pattern: /retention/, category: "retention" },
]

/**
 * The category a tip read in this section belongs to.
 *
 * Derived rather than stored per call site: every "Try:" tip already names the
 * section it was read in, and asking each of the dozen call sites to also name a
 * category would leave them to drift apart. The category is worked out here,
 * server side, when the tip is saved or flagged, and written to the row so a
 * later change to these rules cannot silently reshuffle a creator's checklist.
 */
export function tipCategoryForSection(section: string): TipCategory {
  const haystack = section.toLowerCase()
  return (
    TIP_CATEGORY_RULES.find((rule) => rule.pattern.test(haystack))?.category ??
    "other"
  )
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
  category: TipCategory
  sourcePath: string | null
  completedAt: string | null
  createdAt: string
}

interface SavedTipRow {
  id: string
  tip: string
  section: string
  category: string | null
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
    .select("id, tip, section, category, source_path, completed_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to load saved tips: ${error.message}`)
  }

  return ((data ?? []) as SavedTipRow[]).map((row) => ({
    id: row.id,
    tip: row.tip,
    section: row.section,
    // Stored per row, but derived again for anything the column cannot
    // account for, so a row written before the column existed still lands in
    // the right group rather than in "Other".
    category: isTipCategory(row.category)
      ? row.category
      : tipCategoryForSection(row.section),
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
