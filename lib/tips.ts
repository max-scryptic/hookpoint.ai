import type { SupabaseClient } from "@supabase/supabase-js"

// Everything behind the two controls that sit on a tip: keeping it on the
// creator's checklist, and flagging it as not useful. Shared by the API routes,
// the checklist page and the callout itself, so the rules about what a tip is
// (how long, how it is compared, where it came from, which label it is read
// behind) are stated once.
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
//
// The /dashboard-prefixed variants are the paths these screens used to live at.
// Rows recorded before the move still carry them, and they are never rewritten,
// so both spellings have to keep resolving or historical tips would silently
// report as "unknown".
const TIP_SURFACE_PATH_PREFIXES: { prefix: string; surface: TipSurface }[] = [
  { prefix: "/analysed-video/", surface: "video_analysis" },
  { prefix: "/dashboard/analysed-video/", surface: "video_analysis" },
  {
    prefix: "/video-comparator/report",
    surface: "comparison_report",
  },
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
// creator reading their checklist thinks in these terms ("what am I doing about
// the people who leave?"), not in report sections, so each line is labelled with
// it and the admin can see which kind of advice keeps missing.
//
// Listed in the order they are worked through when planning a video. The two
// big ones are named after the job the tips under them do rather than
// after the report list they were read from. A creator does not sit down to
// work on "drop-offs" and then separately on "gains": both, and the hook window
// and the holds and the pacing stretches with them, are one piece of work -
// keeping a viewer watching - so they are one group. The same goes for the
// title, the thumbnail and the spoken hook, which are only ever worth judging
// against each other.
export const TIP_CATEGORIES = [
  "attention",
  "script",
  "packaging",
  "delivery",
  "other",
] as const

export type TipCategory = (typeof TIP_CATEGORIES)[number]

// Written so two neighbouring groups can never be confused for each other, and
// so each one names the work rather than the place it came from: "Retention" is
// what every retention insight is ultimately asking for, and "Packaging" is the
// one job the title, the thumbnail and the hook are doing together. Both are
// single words, so the labels read as a set beside Script, Delivery and Other
// and fit a badge on a checklist row without wrapping.
export const TIP_CATEGORY_LABELS: Record<TipCategory, string> = {
  attention: "Retention",
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
//  - The report a tip was read on is the strongest signal there is, and every
//    section names it first, so the two anchored rules go before anything that
//    reads the rest of the string.
//  - Everything in the retention insights is attention work: the hook window,
//    the drop-offs, the gains, the holds and the pacing stretches, and with them
//    the Script and Deep analysis tabs beneath each of those rows. The list a
//    row belongs to therefore decides its category rather than the footage tab
//    the tip happened to be open on, so a script rewrite for a drop-off is filed
//    next to the drop-off it fixes and not among the script head-to-head notes.
//    "Retention head-to-head: ..." is the same work read across two videos.
//  - Packaging next, so the spoken hook on a packaging card ("Packaging: Hook")
//    is read as one of the three surfaces being matched up rather than as a
//    retention moment. It is the only place the word "hook" means alignment.
//  - Only then the tabs that stand on their own elsewhere in the product: the
//    script head-to-head, the deep analysis evidence.
//  - The last rule catches a retention word in a section that named its report
//    some other way, so a heading we did not anticipate still lands on attention
//    rather than falling through.
//
// Sections are part model-written (comparison report headings), so anything
// unrecognised falls through to "other" rather than being forced into a group.
const TIP_CATEGORY_RULES: { pattern: RegExp; category: TipCategory }[] = [
  { pattern: /^retention\b|^pacing\b/, category: "attention" },
  { pattern: /packaging|thumbnails?|\btitles?\b/, category: "packaging" },
  { pattern: /\bscripts?\b/, category: "script" },
  {
    pattern: /deep analysis|non-?verbal|delivery|editing|visuals?\b/,
    category: "delivery",
  },
  {
    pattern: /retention|drop-?offs?|\bgains?\b|\bholds?\b|pacing|attention/,
    category: "attention",
  },
]

/**
 * The category a tip read in this section belongs to.
 *
 * Derived rather than stored per call site: every "Try:" tip already names the
 * section it was read in, and asking each of the dozen call sites to also name a
 * category would leave them to drift apart. The category is worked out here,
 * server side, when the tip is saved or flagged, and written to the row so a
 * later change to these rules cannot silently relabel a checklist a creator has
 * already been working from.
 */
export function tipCategoryForSection(section: string): TipCategory {
  const haystack = section.toLowerCase()
  return (
    TIP_CATEGORY_RULES.find((rule) => rule.pattern.test(haystack))?.category ??
    "other"
  )
}

// =============================================================================
// THE LABEL IN FRONT OF A TIP
//
// Almost every tip on a report answers a weakness: a hook that lost people, a
// drop-off, a slow stretch, a title pulling against its thumbnail. "Try:" is
// the right word in front of those, because the advice is something the creator
// is not doing yet.
//
// Two of the retention lists are not weaknesses. A gain is a moment viewers
// came back for, and a hold is a stretch they sat through without leaving; both
// are detected precisely because the curve went the right way, and the tip
// under one says how to set that same thing up deliberately next time (see the
// gain and hold instructions in lib/prompts/defaults/light-analysis.ts, and
// PRESERVE_PATTERN / SUSTAIN_ATTENTION in lib/deep-analysis-recommendations.ts).
// Labelling that "Try:" reads as a correction of something that in fact went
// right, which is the opposite of what the row is saying, so those tips are
// read behind "Maintain:" instead: this worked, keep doing it on purpose.
//
// The label is derived from the section rather than passed in, for the same
// reason the category is: every callout already names the section it was read
// in, and a dozen call sites each naming their own label would drift.
// =============================================================================

export const TIP_LABELS = ["Try", "Maintain"] as const

export type TipLabel = (typeof TIP_LABELS)[number]

// A gain or a hold on a single video's retention report, including the tabs
// beneath one ("Retention: Hold: Script", "Retention: Gain: Deep analysis").
// Anchored at the start so it can only match the retention lists themselves: a
// head-to-head section is prefixed "Retention head-to-head: ...", and its model
// written heading is free to contain the word "gains" while still being advice
// about which of two videos did better.
const MAINTAINED_SECTION = /^retention:\s*(?:gain|hold)s?\b/i

/**
 * The word printed in front of a tip read in this section: "Maintain" where the
 * moment it came from went right, "Try" everywhere else.
 *
 * Only the label changes. A "Maintain:" tip is saved, flagged, fingerprinted
 * and filed on the checklist exactly like any other, so nothing downstream has
 * to know which word introduced it.
 */
export function tipLabelForSection(section: string): TipLabel {
  return MAINTAINED_SECTION.test(section.trim()) ? "Maintain" : "Try"
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

// =============================================================================
// WHICH VIDEO A TIP IS ABOUT
//
// A lot of advice only means anything next to the video it was written about:
// "hint at why the papaya quest is exciting" is a note about one title, not a
// rule for every video the creator will ever make. The checklist has to say
// which one, or a tip kept a month ago is unreadable.
//
// Nothing about the video is stored on the tip. It is read back off the path
// the tip was saved from, which is the only thing recorded that identifies the
// report, and the two report surfaces identify their videos differently:
//
//   /analysed-video/{youtube id}                  one video, by its YouTube id
//   /video-comparator/report?a={row id}&b={row id}  two videos, by row id
//
// Read back rather than stored on purpose. It costs one query on a page that
// already runs one, it needs no backfill, so every tip a creator kept before
// this existed says what it is about too, and a video renamed on YouTube reads
// under its current title rather than the one it had the day the tip was kept.
// =============================================================================

// An analysed video's row id is a uuid, and the comparison report's a and b are
// row ids straight off a query string. Anything in that slot which is not
// shaped like one was not written by us, so it is dropped rather than sent to
// Postgres, where a malformed uuid fails the whole read.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Both spellings of each path, for the same reason tipSurface carries them: the
// /dashboard-prefixed ones are where these screens used to live, and tips saved
// back then still carry them.
const ANALYSED_VIDEO_PATH =
  /^(?:\/dashboard)?\/analysed-video\/([A-Za-z0-9_-]{1,64})\/?$/
const COMPARISON_REPORT_PATH =
  /^(?:\/dashboard)?\/video-comparator\/report\/?$/

// How to find one video behind a tip: which column its id belongs to, since a
// single video report names its video the way YouTube does and a comparison
// report names its two by our own row ids.
export type TipVideoRef =
  | { by: "youtubeId"; id: string }
  | { by: "analysedVideoId"; id: string }

/**
 * The videos the report at this path was about: one for a single video report,
 * two for a comparison, none for anything else.
 *
 * Purely a reading of the path. Whether those videos still exist, and what they
 * are called, is settled by the lookup below.
 */
export function tipVideoRefs(
  sourcePath: string | null | undefined,
): TipVideoRef[] {
  const [path, query] = (sourcePath ?? "").split("?")

  const single = path.match(ANALYSED_VIDEO_PATH)
  if (single) return [{ by: "youtubeId", id: single[1] }]

  if (COMPARISON_REPORT_PATH.test(path)) {
    const params = new URLSearchParams(query ?? "")
    return (["a", "b"] as const)
      .map((side) => params.get(side) ?? "")
      .filter((id) => UUID.test(id))
      .map((id) => ({ by: "analysedVideoId", id }) as const)
  }

  return []
}

// One line of the creator's checklist.
export interface SavedTip {
  id: string
  tip: string
  section: string
  category: TipCategory
  sourcePath: string | null
  createdAt: string
  // The videos the report this tip came from was about, current titles, in the
  // order the report reads them. One for a single video report, two for a
  // comparison, and empty where the video has since been deleted or the tip was
  // saved without a path we can read one off.
  videoTitles: string[]
}

interface SavedTipRow {
  id: string
  tip: string
  section: string
  category: string | null
  source_path: string | null
  created_at: string
}

/**
 * How many tips on this checklist belong to each category, for the categories
 * that actually appear on it.
 *
 * Empty categories are left out rather than listed at zero: the filter above
 * the checklist is built from this, and offering a creator a category they have
 * kept nothing under is offering them an empty list. The order is the order the
 * categories are worked through when planning a video, not the order they
 * happen to fall in this creator's list, so the filter reads the same way every
 * time they open the page.
 */
export function tipCategoryCounts(
  tips: SavedTip[],
): { category: TipCategory; count: number }[] {
  return TIP_CATEGORIES.map((category) => ({
    category,
    count: tips.filter((tip) => tip.category === category).length,
  })).filter(({ count }) => count > 0)
}

// The key one video is held under while the titles are being matched back to
// the tips that named it. The two kinds of id are namespaced rather than mixed,
// so a YouTube id could never be answered with the title of a row that happens
// to carry the same string as its own id.
function refKey(ref: TipVideoRef): string {
  return `${ref.by}:${ref.id}`
}

/**
 * The current titles of the videos these tips came from, keyed by ref.
 *
 * Best effort, deliberately: a title is context beside a line of the checklist,
 * not the line itself, so a failed or partial read leaves those lines without a
 * video rather than taking the creator's whole checklist down with it. A video
 * that has since been deleted simply has no row to answer with, which is the
 * same outcome and wants the same handling.
 */
async function readVideoTitles(
  supabase: SupabaseClient,
  userId: string,
  refs: TipVideoRef[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>()

  async function read(
    by: TipVideoRef["by"],
    column: "video_id" | "id",
  ): Promise<void> {
    const ids = [
      ...new Set(refs.filter((ref) => ref.by === by).map((ref) => ref.id)),
    ]
    if (ids.length === 0) return

    const { data, error } = await supabase
      .from("analysed_videos")
      .select(`${column}, video_title`)
      .eq("user_id", userId)
      .in(column, ids)

    if (error) {
      console.error("Failed to read the videos behind the saved tips", error)
      return
    }

    for (const row of (data ?? []) as Record<string, string | null>[]) {
      const id = row[column]
      const title = row.video_title?.trim()
      if (id && title) titles.set(refKey({ by, id } as TipVideoRef), title)
    }
  }

  // One query per kind of id, and only for the kinds these tips actually name:
  // a checklist kept entirely off single video reports never asks about row ids.
  await Promise.all([
    read("youtubeId", "video_id"),
    read("analysedVideoId", "id"),
  ])

  return titles
}

/**
 * The creator's whole checklist, in the order they put it in. Read with the
 * signed-in user's client, so row level security scopes it to them on top of
 * the explicit filter.
 *
 * A tip saved since the last reorder carries position 0, so the second sort
 * settles those ties in favour of the newest: a tip kept a minute ago is at the
 * top waiting to be placed, not buried at the bottom.
 */
export async function listSavedTips(
  supabase: SupabaseClient,
  userId: string,
): Promise<SavedTip[]> {
  const { data, error } = await supabase
    .from("saved_tips")
    .select("id, tip, section, category, source_path, created_at")
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to load saved tips: ${error.message}`)
  }

  const rows = (data ?? []) as SavedTipRow[]
  // Worked out once per tip and kept, so the same path is not read twice: once
  // to ask about its videos and again to hand them back.
  const refs = rows.map((row) => tipVideoRefs(row.source_path))
  const titles = await readVideoTitles(supabase, userId, refs.flat())

  return rows.map((row, index) => ({
    id: row.id,
    tip: row.tip,
    section: row.section,
    // Stored per row, but derived again for anything the column cannot
    // account for, so a row written before the column existed still reports
    // what it is about rather than "Other".
    category: isTipCategory(row.category)
      ? row.category
      : tipCategoryForSection(row.section),
    sourcePath: row.source_path,
    createdAt: row.created_at,
    videoTitles: refs[index]
      .map((ref) => titles.get(refKey(ref)))
      .filter((title): title is string => title !== undefined),
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
