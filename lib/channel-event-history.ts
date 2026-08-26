// Aggregates the retention-window events synthesized across a user's OTHER
// deeply-analysed videos into a compact, prompt-sized channel summary - the
// "cross-video intelligence" the paid plans advertise. Handed to the event
// synthesizer (lib/retention-window-event-synthesis.ts) so a window's events
// can be framed against what habitually moves retention on this channel, not
// just against the one video being analysed.
//
// The summary is deliberately small: per window kind, how often each event
// type recurred and across how many distinct videos, plus a few of the
// highest-confidence narratives as concrete examples. Recurrence across
// videos (not raw event volume) is what makes something a channel trend, so
// trends are ordered by distinct-video count first.

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  RetentionWindowEventPrimaryEvidence,
  RetentionWindowEventType,
} from "@/lib/retention-window-events"
import type { RetentionWindowKind } from "@/lib/retention-windows"

// One historical event joined to its window's kind - the minimal shape the
// summariser needs, regardless of where the rows came from.
export interface ChannelEventRecord {
  analysedVideoId: string
  windowKind: RetentionWindowKind
  eventType: RetentionWindowEventType
  narrative: string
  confidence: number | null
  // Rich receipt fields used by Channel Trends. Optional keeps historical
  // pure-aggregation callers compatible while database-loaded rows provide
  // every value.
  timestampSeconds?: number
  primaryEvidence?: RetentionWindowEventPrimaryEvidence
  windowDelta?: number
  windowFromSeconds?: number
  windowToSeconds?: number
  relativePerformance?: number | null
}

export interface ChannelEventTypeTrend {
  eventType: RetentionWindowEventType
  eventCount: number
  // Distinct videos this event type appeared in for this window kind.
  videoCount: number
}

export interface ChannelKindHistory {
  eventCount: number
  // Ordered by videoCount desc, then eventCount desc - the most channel-wide
  // recurring causes first.
  trends: ChannelEventTypeTrend[]
  // The highest-confidence narratives for this kind, as concrete examples of
  // what those trends looked like in practice.
  exampleNarratives: string[]
}

export interface ChannelEventHistory {
  // Distinct other videos contributing events to this summary.
  videoCount: number
  hooks: ChannelKindHistory | null
  dropOffs: ChannelKindHistory | null
  gains: ChannelKindHistory | null
  holds: ChannelKindHistory | null
}

// One or zero other videos is anecdote, not a channel trend - below this the
// history is withheld entirely rather than lending false authority.
const MIN_OTHER_VIDEOS = 2
// Newest-first cap on the event rows fetched, bounding both the query and the
// summary's inputs for prolific channels.
const MAX_EVENT_ROWS = 600
const MAX_EXAMPLES_PER_KIND = 3

const WINDOW_KINDS: readonly RetentionWindowKind[] = [
  "hook",
  "drop_off",
  "gain",
  "hold",
]

function isWindowKind(value: unknown): value is RetentionWindowKind {
  return (
    typeof value === "string" &&
    (WINDOW_KINDS as readonly string[]).includes(value)
  )
}

function summarizeKind(
  records: ChannelEventRecord[],
  kind: RetentionWindowKind,
): ChannelKindHistory | null {
  const kindRecords = records.filter((record) => record.windowKind === kind)
  if (kindRecords.length === 0) return null

  const byType = new Map<
    RetentionWindowEventType,
    { eventCount: number; videos: Set<string> }
  >()
  for (const record of kindRecords) {
    const entry =
      byType.get(record.eventType) ?? { eventCount: 0, videos: new Set() }
    entry.eventCount += 1
    entry.videos.add(record.analysedVideoId)
    byType.set(record.eventType, entry)
  }

  const trends: ChannelEventTypeTrend[] = [...byType.entries()]
    .map(([eventType, entry]) => ({
      eventType,
      eventCount: entry.eventCount,
      videoCount: entry.videos.size,
    }))
    .sort(
      (a, b) => b.videoCount - a.videoCount || b.eventCount - a.eventCount,
    )

  const exampleNarratives = [...kindRecords]
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, MAX_EXAMPLES_PER_KIND)
    .map((record) => record.narrative)

  return { eventCount: kindRecords.length, trends, exampleNarratives }
}

// Pure aggregation over already-loaded records. Returns null when fewer than
// MIN_OTHER_VIDEOS distinct videos contribute - the caller treats null as "no
// channel history yet" and the synthesizer prompt says the same.
export function summarizeChannelEvents(
  records: ChannelEventRecord[],
): ChannelEventHistory | null {
  const videoIds = new Set(records.map((record) => record.analysedVideoId))
  if (videoIds.size < MIN_OTHER_VIDEOS) return null

  return {
    videoCount: videoIds.size,
    hooks: summarizeKind(records, "hook"),
    dropOffs: summarizeKind(records, "drop_off"),
    gains: summarizeKind(records, "gain"),
    holds: summarizeKind(records, "hold"),
  }
}

interface ChannelEventHistoryRow {
  analysed_video_id: string
  event_type: RetentionWindowEventType
  timestamp_seconds: number
  narrative: string
  primary_evidence: RetentionWindowEventPrimaryEvidence
  confidence: number | null
  // PostgREST embeds the many-to-one join as an object, but loosely-typed
  // clients can surface it as a single-element array - accept both.
  retention_windows:
    | {
        kind: string
        delta: number
        from_seconds: number
        to_seconds: number
        relative_performance: number | null
      }
    | {
        kind: string
        delta: number
        from_seconds: number
        to_seconds: number
        relative_performance: number | null
      }[]
    | null
}

function embeddedWindow(row: ChannelEventHistoryRow) {
  const embedded = Array.isArray(row.retention_windows)
    ? row.retention_windows[0]
    : row.retention_windows
  return embedded ?? null
}

// Loads the user's synthesized events joined to their window's kind, newest
// first - the raw records both the synthesizer's channelHistory summary and
// the Channel Trends page (lib/channel-trends.ts) aggregate over. Pass
// excludeAnalysedVideoId when the caller is analysing a video, so it never
// reads its own (possibly stale) events back as channel context.
export async function loadChannelEventRecords(
  supabase: SupabaseClient,
  userId: string,
  options: { excludeAnalysedVideoId?: string; limit?: number } = {},
): Promise<ChannelEventRecord[]> {
  let query = supabase
    .from("retention_window_events")
    .select(
      "analysed_video_id, event_type, timestamp_seconds, narrative, primary_evidence, confidence, retention_windows!inner(kind, delta, from_seconds, to_seconds, relative_performance)",
    )
    .eq("user_id", userId)
  if (options.excludeAnalysedVideoId != null) {
    query = query.neq("analysed_video_id", options.excludeAnalysedVideoId)
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? MAX_EVENT_ROWS)

  if (error) {
    throw new Error(`Failed to load channel event history: ${error.message}`)
  }

  const records: ChannelEventRecord[] = []
  for (const row of (data ?? []) as unknown as ChannelEventHistoryRow[]) {
    const window = embeddedWindow(row)
    if (!isWindowKind(window?.kind)) continue
    records.push({
      analysedVideoId: row.analysed_video_id,
      windowKind: window.kind,
      eventType: row.event_type,
      narrative: row.narrative,
      confidence: row.confidence ?? null,
      timestampSeconds: row.timestamp_seconds,
      primaryEvidence: row.primary_evidence,
      windowDelta: window.delta,
      windowFromSeconds: window.from_seconds,
      windowToSeconds: window.to_seconds,
      relativePerformance: window.relative_performance,
    })
  }
  return records
}

// Loads and summarises the channel's event history for the synthesizer,
// excluding the video currently being analysed.
export async function getChannelEventHistory(
  supabase: SupabaseClient,
  userId: string,
  excludeAnalysedVideoId: string,
): Promise<ChannelEventHistory | null> {
  const records = await loadChannelEventRecords(supabase, userId, {
    excludeAnalysedVideoId,
  })
  return summarizeChannelEvents(records)
}
