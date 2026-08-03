import {
  PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
  SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
} from "@/lib/comparison-report-versions"
import { createAdminClient } from "@/lib/supabase/admin"
import { reportIsCurrent } from "@/lib/video-comparisons"

// Read-side helper for the admin user-detail "Video comparisons" tab and the
// comparison detail page behind it. Uses the service-role client (bypassing
// RLS) and MUST only be called from server code that has already verified the
// caller is an admin (see requireAdminUser). Every query is still scoped by
// user_id, so an admin viewing one account can never pull in another's rows.
//
// The two written head-to-heads are reported separately here rather than as the
// single "reportsReady" flag the creator's own history uses: when one of them is
// missing, an admin wants to know which.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// One side of a comparison, resolved for display. The video row can be gone
// (the comparison cascades away with it, so in practice only a partial read
// leaves these null), in which case the row still lists with a placeholder
// rather than disappearing.
export type AdminComparisonVideo = {
  // analysed_videos row id, so the side can link to its admin analysis page.
  id: string
  // YouTube video id, for the link out to the source video. Null when the
  // analysed video row could not be resolved.
  videoId: string | null
  title: string | null
  thumbnailUrl: string | null
}

export type AdminVideoComparison = {
  id: string
  createdAt: string
  a: AdminComparisonVideo
  b: AdminComparisonVideo
  // Whether each written head-to-head is stored at the shape the report page
  // renders. False for a pair generated before that report existed, one whose
  // generation failed, or one stored against an older shape.
  scriptReportReady: boolean
  packagingReportReady: boolean
}

// Same probe the creator-facing list uses: presence and shape version of both
// stored reports, without dragging the whole JSON blob back for every row.
const REPORT_READY_PROBE =
  "script_ready:script_report->>schemaVersion, packaging_ready:packaging_report->>schemaVersion"

interface ComparisonRow {
  id: string
  video_a_id: string
  video_b_id: string
  created_at: string
  script_ready: string | null
  packaging_ready: string | null
}

type ResolvedVideo = {
  videoId: string
  title: string | null
  thumbnailUrl: string | null
}

// Titles and thumbnails for every video referenced by a set of comparisons,
// looked up in a single query. A missing row (a video deleted between the two
// reads) simply yields a placeholder side rather than dropping the comparison.
async function resolveVideos(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  videoIds: string[],
): Promise<Map<string, ResolvedVideo>> {
  if (videoIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from("analysed_videos")
    .select("id, video_id, video_title, thumbnail_url:video_details->>thumbnailUrl")
    .eq("user_id", userId)
    .in("id", videoIds)

  if (error) {
    // Titles are an enrichment: a failure leaves the listing rendering with
    // placeholder sides rather than sinking the tab.
    console.error("Failed to load comparison video titles", error)
    return new Map()
  }

  return new Map(
    (
      (data ?? []) as Array<{
        id: string
        video_id: string
        video_title: string | null
        thumbnail_url: string | null
      }>
    ).map((row) => [
      row.id,
      {
        videoId: row.video_id,
        title: row.video_title,
        thumbnailUrl: row.thumbnail_url,
      },
    ]),
  )
}

function toComparison(
  row: ComparisonRow,
  videos: Map<string, ResolvedVideo>,
): AdminVideoComparison {
  const side = (id: string): AdminComparisonVideo => {
    const video = videos.get(id)
    return {
      id,
      videoId: video?.videoId ?? null,
      title: video?.title ?? null,
      thumbnailUrl: video?.thumbnailUrl ?? null,
    }
  }

  return {
    id: row.id,
    createdAt: row.created_at,
    a: side(row.video_a_id),
    b: side(row.video_b_id),
    scriptReportReady: reportIsCurrent(
      row.script_ready,
      SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
    ),
    packagingReportReady: reportIsCurrent(
      row.packaging_ready,
      PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
    ),
  }
}

// Every head-to-head a user has generated, newest first, with both sides
// resolved for the listing.
export async function getUserVideoComparisons(
  userId: string,
): Promise<AdminVideoComparison[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("video_comparisons")
    .select(`id, video_a_id, video_b_id, created_at, ${REPORT_READY_PROBE}`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to load video comparisons: ${error.message}`)
  }

  const rows = (data ?? []) as ComparisonRow[]
  if (rows.length === 0) return []

  const videos = await resolveVideos(supabase, userId, [
    ...new Set(rows.flatMap((row) => [row.video_a_id, row.video_b_id])),
  ])

  return rows.map((row) => toComparison(row, videos))
}

// One of a user's comparisons by its row id, or null when no such row belongs
// to that user. The user_id predicate keeps the lookup scoped to the account
// the admin is viewing, so a mistyped or foreign id resolves to null (a 404)
// rather than surfacing another user's comparison.
export async function getUserVideoComparisonById(
  userId: string,
  comparisonId: string,
): Promise<AdminVideoComparison | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("video_comparisons")
    .select(`id, video_a_id, video_b_id, created_at, ${REPORT_READY_PROBE}`)
    .eq("user_id", userId)
    .eq("id", comparisonId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load video comparison: ${error.message}`)
  }
  if (!data) return null

  const row = data as ComparisonRow
  const videos = await resolveVideos(supabase, userId, [
    row.video_a_id,
    row.video_b_id,
  ])

  return toComparison(row, videos)
}
