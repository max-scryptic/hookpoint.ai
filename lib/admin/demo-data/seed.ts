// Writes (and removes) a synthetic library for one account, so every surface in
// the product can be looked at without anybody uploading a video first.
//
// Everything here goes through the service-role client, which bypasses Row
// Level Security, so it must only ever be reached from server code that has
// already established the caller is an admin (see lib/admin/auth.ts and
// app/api/admin/demo-data/route.ts).
//
// WHAT MAKES A ROW REMOVABLE
//
// Every demo video id carries the DEMO_VIDEO_ID_PREFIX marker, and everything
// else the seeder writes hangs off an analysed_videos row by foreign key, is
// keyed to one (notifications, cost logs, comparisons), or carries its own
// marker (saved tips, the demo subscription). So "remove the demo data" is a
// question the data itself can answer, and clearing never has to guess whether
// a row was ours. The one deliberate exception is documented on clearDemoData.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013) in this file.

import {
  buildDemoVideo,
  DEMO_MODEL,
  DEMO_VIDEO_ID_PREFIX,
  type DemoVideoPayload,
} from "@/lib/admin/demo-data/build"
import {
  DEMO_COMPARISON_SECTIONS,
  DEMO_SAVED_TIPS,
  DEMO_VIDEO_CONCEPTS,
} from "@/lib/admin/demo-data/content"
import { Rng } from "@/lib/admin/demo-data/random"
import { assessPairComparability } from "@/lib/comparison-comparability"
import {
  PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
  RETENTION_COMPARISON_REPORT_SCHEMA_VERSION,
  SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
} from "@/lib/comparison-report-versions"
import { savePacingAnalysis } from "@/lib/pacing-analyses"
import type { PackagingComparisonReport } from "@/lib/packaging-comparison-report"
import type { RetentionComparisonReport } from "@/lib/retention-comparison-report"
import { saveRetentionWindows } from "@/lib/retention-windows"
import type { ScriptComparisonReport } from "@/lib/script-comparison-report"
import { createAdminClient } from "@/lib/supabase/admin"
import { tipCategoryForSection } from "@/lib/tips"

// Enough videos for the Channel Trends page to reach its "established" stage
// (six) with room over it, without making the seed a long job.
export const DEFAULT_DEMO_VIDEO_COUNT = 9
export const MAX_DEMO_VIDEO_COUNT = DEMO_VIDEO_CONCEPTS.length
export const MIN_DEMO_VIDEO_COUNT = 1

// Roughly this share of the library gets the deep-analysis treatment (a source
// file, synthesized events, a pipeline run). Deep credits cost real money, so a
// real library is never fully deep-analysed, and the trends page's "N of your M
// videos" wording only reads correctly when the fraction is a real one.
const DEEP_ANALYSED_SHARE = 0.7

// The demo subscription's id. Obviously not a Stripe id, and the marker the
// cleanup path matches on so a real subscription is never touched.
const DEMO_SUBSCRIPTION_PREFIX = "demo_sub_"

// Prefixed onto every seeded checklist line's fingerprint, which is what makes
// the demo tips removable without touching tips the account really kept.
const DEMO_TIP_FINGERPRINT_PREFIX = "demo:"

// How far back the seeded daily-activity and cost-log history runs. The admin
// dashboard charts default to the last 30 days over a 180 day window, so 120
// days fills the default view and leaves the range picker something to find.
const HISTORY_DAYS = 120

export interface SeedDemoDataOptions {
  userId: string
  videoCount?: number
  // Whether to also write a paid subscription projection for the account.
  // Channel Trends and the deep-analysis surfaces are gated on a plan with deep
  // credits, so without this the seeded library is there but the page that
  // motivated the seeding shows its locked explainer.
  grantPaidPlan?: boolean
  // Injectable for tests; defaults to now.
  now?: Date
}

export interface SeedDemoDataResult {
  videos: number
  deepAnalysedVideos: number
  retentionWindows: number
  events: number
  comparisons: number
  savedTips: number
  notifications: number
  costLogs: number
  planGranted: boolean
  // One line per decorative section that failed and was skipped. Empty on a
  // clean seed. The library itself is never in here: a failure writing it
  // throws, because there is nothing to demo without it.
  warnings: string[]
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function dateDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

// --- comparison reports ------------------------------------------------------

function buildComparisonReports(
  a: DemoVideoPayload,
  b: DemoVideoPayload,
  rng: Rng,
): {
  script: ScriptComparisonReport
  packaging: PackagingComparisonReport
  retention: RetentionComparisonReport
} {
  const generatedAt = a.dateAnalysed
  const comparability = assessPairComparability({
    viewsA: a.analyticsSummary.views,
    viewsB: b.analyticsSummary.views,
    averageWatchedPercentA: a.analyticsSummary.averageViewPercentage,
    averageWatchedPercentB: b.analyticsSummary.averageViewPercentage,
    trafficSourcesA: a.analyticsSummary.trafficSources,
    trafficSourcesB: b.analyticsSummary.trafficSources,
    impressionsA: a.analyticsSummary.impressions,
    impressionsB: b.analyticsSummary.impressions,
    clickThroughRateA: a.analyticsSummary.impressionClickThroughRate,
    clickThroughRateB: b.analyticsSummary.impressionClickThroughRate,
  })

  // Whichever of the two actually held its audience better is the side the
  // reports favour, so the prose does not contradict the numbers beside it.
  const strongerSide: "a" | "b" =
    (a.analyticsSummary.averageViewPercentage ?? 0) >=
    (b.analyticsSummary.averageViewPercentage ?? 0)
      ? "a"
      : "b"

  const script: ScriptComparisonReport = {
    summary:
      "One script names its outcome in the first line and spends the rest of its runtime earning it. The other reaches the same point about ninety seconds later, and the curve shows what that costs.",
    sections: DEMO_COMPARISON_SECTIONS.map((section) => ({
      heading: section.heading,
      videoA: [
        "Opens on the result, then works backwards through the setup.",
        "Keeps one thread the whole way through.",
      ],
      videoB: [
        "Opens on context, and reaches the promise around the ninety second mark.",
        "Introduces a second comparison before closing the first.",
      ],
      strongerSide,
      body: section.body,
      tip: section.tip,
      tipExamples: [],
    })),
    comparability,
    schemaVersion: SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
    model: DEMO_MODEL,
    generatedAt,
  }

  const surfaces = (["thumbnail", "title", "hook", "alignment"] as const).map(
    (surface) => ({
      surface,
      strongerSide,
      aRead: "One readable subject, and text that adds the half the title leaves out.",
      bRead: "A busier frame, with text that repeats what the title already says.",
      whyItMatters:
        "At feed size the reader gets one idea from the thumbnail. Spending it on a repeat of the title spends it on nothing.",
      tip: "Give the thumbnail the half of the idea the title does not carry.",
      tipExamples: [],
    }),
  )

  const packaging: PackagingComparisonReport = {
    verdict: {
      strongerSide,
      summary:
        "The stronger packaging makes one promise across all three surfaces and confirms it inside the first ten seconds. The other splits the promise between the title and the thumbnail.",
      confidence: rng.round(0.55, 0.9, 2),
    },
    surfaces,
    drivers: [
      {
        label: "One promise, carried across all three surfaces",
        surface: "alignment" as const,
        favours: strongerSide,
        detail:
          "Title, thumbnail and opening line all point at the same outcome, so nothing has to be re-explained after the click.",
        evidence: [a.title, b.title, "First line at 0:02"],
        tip: "Write the thumbnail text and the first spoken line together, not separately.",
        confidence: rng.round(0.55, 0.9, 2),
      },
      {
        label: "A concrete number in the title",
        surface: "title" as const,
        favours: strongerSide,
        detail:
          "A countable claim sets the reader's expectation of how long this will take and what they get.",
        evidence: [a.title],
        tip: "Put the number in the title when there genuinely is one.",
        confidence: rng.round(0.5, 0.85, 2),
      },
    ],
    comparability,
    schemaVersion: PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
    model: DEMO_MODEL,
    generatedAt,
  }

  const retention: RetentionComparisonReport = {
    summary:
      "Both curves lose the same share in the first thirty seconds. They separate around the two minute mark, and never converge again.",
    sections: [
      {
        heading: "The opening thirty seconds",
        body: "Neither opening is the problem. Both hold within a couple of points of each other through the hook windows, which is where most videos on this channel do their losing.",
        tip: "Keep the opening you already have and spend the effort on the two minute mark.",
        tipExamples: [],
      },
      {
        heading: "Where the two curves separate",
        body: "One curve flattens into its build sequence while the other keeps declining through it. The difference is narration: the flatter one talks over the work.",
        tip: "Narrate the working stretches, especially the ones that look obvious to you.",
        tipExamples: [],
      },
      {
        heading: "How each one ends",
        body: "The stronger curve is still shedding viewers at the end, just from a higher line. Nothing at the end explains the gap; it was decided in the middle.",
        tip: "Judge an ending by where the line is when it starts, not by how it finishes.",
        tipExamples: [],
      },
    ],
    schemaVersion: RETENTION_COMPARISON_REPORT_SCHEMA_VERSION,
    model: DEMO_MODEL,
    generatedAt,
  }

  return { script, packaging, retention }
}

// --- seeding -----------------------------------------------------------------

export async function seedDemoData(
  options: SeedDemoDataOptions,
): Promise<SeedDemoDataResult> {
  const {
    userId,
    videoCount = DEFAULT_DEMO_VIDEO_COUNT,
    grantPaidPlan = true,
    now = new Date(),
  } = options

  const wanted = Math.min(
    MAX_DEMO_VIDEO_COUNT,
    Math.max(MIN_DEMO_VIDEO_COUNT, Math.round(videoCount)),
  )
  const supabase = createAdminClient()
  const rng = new Rng(`${userId}:library`)

  // The seed is a sequence of writes across a dozen tables, not one
  // transaction, so a failure partway through leaves the account holding
  // whatever landed before it. That is how a unique-index collision on the
  // notifications table once cost an otherwise complete library its plan grant,
  // which is the one row that decides whether Channel Trends renders at all.
  //
  // So the library itself (videos, windows, events, the plan that unlocks them)
  // still fails loudly, and everything that only decorates it is best-effort:
  // a comparison report or a cost log that will not write is worth a line in
  // the result, not the whole seed.
  const warnings: string[] = []
  async function optional(label: string, task: () => Promise<void>) {
    try {
      await task()
    } catch (error) {
      console.error(`Demo data: ${label} failed`, error)
      warnings.push(
        `${label}: ${error instanceof Error ? error.message : "failed"}`,
      )
    }
  }

  // Re-seeding replaces rather than accumulates: a second click should leave
  // the account with one demo library, not two.
  await clearDemoData(userId)

  const concepts = DEMO_VIDEO_CONCEPTS.slice(0, wanted)
  const deepCount = Math.max(1, Math.round(wanted * DEEP_ANALYSED_SHARE))
  const payloads = concepts.map((concept, index) =>
    buildDemoVideo({
      concept,
      index,
      total: wanted,
      seedKey: userId,
      now,
      // The most recent uploads are the deep-analysed ones, which is the order
      // a creator would actually spend credits in.
      deepAnalysed: index >= wanted - deepCount,
    }),
  )

  // --- analysed videos -------------------------------------------------------

  const videoRows = payloads.map((payload) => ({
    user_id: userId,
    video_id: payload.videoId,
    video_title: payload.title,
    date_analysed: payload.dateAnalysed,
    video_details: payload.videoDetails,
    retention: payload.retention,
    transcript: payload.transcript,
    analytics_summary: payload.analyticsSummary,
    packaging_alignment: payload.packagingAlignment,
    script_taxonomy: payload.scriptTaxonomy,
    retention_attribution: payload.retentionAttribution,
    // The measured editing figures a deep analysis takes off the source file.
    // Null on a light-analysed video, exactly as it is in production: the
    // numbers are measured off a source file that a light analysis never had.
    deep_feature_baseline: payload.deepFeatureBaseline,
    // Null status on all three means "settled, nothing in flight", which is
    // what stops a detail-page visit claiming the row and paying for a model
    // call to regenerate what is already stored.
    packaging_alignment_status: null,
    script_taxonomy_status: null,
    retention_attribution_status: null,
    pacing_analysis_status: null,
  }))

  const { data: insertedVideos, error: videoError } = await supabase
    .from("analysed_videos")
    .insert(videoRows)
    .select("id, video_id")

  if (videoError) {
    throw new Error(`Failed to insert demo videos: ${videoError.message}`)
  }

  const videoIdByYoutubeId = new Map(
    ((insertedVideos ?? []) as { id: string; video_id: string }[]).map((row) => [
      row.video_id,
      row.id,
    ]),
  )

  // --- retention windows, transcripts, events --------------------------------

  let windowCount = 0
  let eventCount = 0

  for (const payload of payloads) {
    const analysedVideoId = videoIdByYoutubeId.get(payload.videoId)
    if (!analysedVideoId) continue

    // Reuses the product's own writer, so a demo window row is written by
    // exactly the code that writes a real one.
    const saved = await saveRetentionWindows(
      supabase,
      userId,
      analysedVideoId,
      payload.windows,
    )
    windowCount += saved.length

    const windowIdByKey = new Map(
      saved.map((window) => [`${window.kind}:${window.windowIndex}`, window.id]),
    )

    const transcriptRows = saved.map((window) => ({
      retention_window_id: window.id,
      analysed_video_id: analysedVideoId,
      user_id: userId,
      from_seconds: window.analysisFromSeconds ?? window.fromSeconds,
      to_seconds: window.analysisToSeconds ?? window.toSeconds,
      transcript: payload.transcript
        .filter(
          (cue) =>
            cue.endSeconds >= window.fromSeconds &&
            cue.startSeconds <= window.toSeconds,
        )
        .map((cue) => cue.text)
        .join(" ")
        .trim(),
      // Left null on purpose: a null taxonomy status is excluded from the
      // deep-analysis progress tally entirely, so these rows never hold the
      // pipeline open (see lib/retention-window-media-progress.ts).
      taxonomy_status: null,
    }))

    if (transcriptRows.length > 0) {
      const { error } = await supabase
        .from("retention_window_transcripts")
        .insert(transcriptRows)
      if (error) {
        throw new Error(
          `Failed to insert demo window transcripts: ${error.message}`,
        )
      }
    }

    if (!payload.deepAnalysed) continue

    // A synthesis job per window, all ready. The trends page counts its library
    // from these rather than from the events, so a window that produced no
    // events still grows the library.
    const synthesisRows = saved.map((window) => ({
      retention_window_id: window.id,
      analysed_video_id: analysedVideoId,
      user_id: userId,
      status: "ready",
      model: DEMO_MODEL,
      synthesized_at: payload.dateAnalysed,
    }))
    if (synthesisRows.length > 0) {
      const { error } = await supabase
        .from("retention_window_event_synthesis")
        .insert(synthesisRows)
      if (error) {
        throw new Error(
          `Failed to insert demo synthesis jobs: ${error.message}`,
        )
      }
    }

    const eventRows = payload.windowEvents.flatMap((group) => {
      const windowId = windowIdByKey.get(`${group.kind}:${group.windowIndex}`)
      if (!windowId) return []
      return group.events.map((event) => ({
        retention_window_id: windowId,
        analysed_video_id: analysedVideoId,
        user_id: userId,
        event_index: event.eventIndex,
        event_type: event.eventType,
        timestamp_seconds: event.timestampSeconds,
        narrative: event.narrative,
        primary_evidence: event.primaryEvidence,
        confidence: event.confidence,
        created_at: payload.dateAnalysed,
      }))
    })
    if (eventRows.length > 0) {
      const { error } = await supabase
        .from("retention_window_events")
        .insert(eventRows)
      if (error) {
        throw new Error(`Failed to insert demo events: ${error.message}`)
      }
      eventCount += eventRows.length
    }
  }

  // --- pacing ----------------------------------------------------------------

  for (const payload of payloads) {
    const analysedVideoId = videoIdByYoutubeId.get(payload.videoId)
    if (!analysedVideoId) continue
    await savePacingAnalysis(supabase, userId, analysedVideoId, payload.pacing)
  }

  // --- source files and pipeline runs ----------------------------------------

  // Every one of these was inserted a moment ago, so the id is always there;
  // the filter is what keeps a missing one out of a NOT NULL column rather
  // than turning it into an insert error halfway through the seed.
  const deepPayloads = payloads.filter(
    (payload) =>
      payload.deepAnalysed && videoIdByYoutubeId.has(payload.videoId),
  )

  // The most recent analysis date in the library, used to date the one
  // notification that belongs to the channel rather than to a single video.
  const newestAnalysedAt =
    payloads[payloads.length - 1]?.dateAnalysed ?? now.toISOString()

  const sourceFileRows = deepPayloads.map((payload) => ({
    user_id: userId,
    analysed_video_id: videoIdByYoutubeId.get(payload.videoId)!,
    youtube_video_id: payload.videoId,
    original_filename: `${payload.videoId}-final-export.mp4`,
    storage_provider: "supabase",
    // No object was uploaded, so there is no path to point at. Every read of
    // this column is null-guarded, and a null keeps the playback and download
    // affordances off rather than offering a file that is not there.
    storage_path: null,
    file_size_bytes: payload.sourceFileBytes,
    mime_type: "video/mp4",
    uploaded_duration_seconds: payload.videoDetails.durationSeconds,
    youtube_duration_seconds: payload.videoDetails.durationSeconds,
    duration_difference_seconds: 0,
    duration_validation_status: "passed",
    filename_validation_status: "passed",
    filename_similarity_score: 0.82,
    validation_status: "passed",
    upload_status: "ready",
    normalisation_status: "skipped",
    deep_credits_charged: Math.max(
      1,
      Math.round(payload.videoDetails.durationSeconds / 60),
    ),
    created_at: payload.dateAnalysed,
  }))

  if (sourceFileRows.length > 0) {
    const { error } = await supabase.from("source_files").insert(sourceFileRows)
    if (error) {
      throw new Error(`Failed to insert demo source files: ${error.message}`)
    }
  }

  const pipelineRows = deepPayloads.map((payload) => ({
    user_id: userId,
    analysed_video_id: videoIdByYoutubeId.get(payload.videoId)!,
    pipeline_version: DEMO_MODEL,
    status: "ready",
    current_stage: null,
    stages: {
      eventSynthesis: { status: "ready", finishedAt: payload.dateAnalysed },
    },
    started_at: payload.dateAnalysed,
    finished_at: payload.dateAnalysed,
  }))

  if (pipelineRows.length > 0) {
    const { error } = await supabase
      .from("deep_analysis_pipeline_runs")
      .insert(pipelineRows)
    if (error) {
      throw new Error(`Failed to insert demo pipeline runs: ${error.message}`)
    }
  }

  // --- comparisons -----------------------------------------------------------

  let comparisonCount = 0
  await optional("Comparison reports", async () => {
    if (payloads.length < 2) return
    const pairs: [DemoVideoPayload, DemoVideoPayload][] = []
    // Newest against oldest, then the two in the middle: two pairs with a real
    // gap between them, which is what makes a comparison report worth reading.
    pairs.push([payloads[payloads.length - 1], payloads[0]])
    if (payloads.length >= 4) {
      pairs.push([
        payloads[payloads.length - 2],
        payloads[Math.floor(payloads.length / 2)],
      ])
    }

    const comparisonRows = pairs.flatMap(([a, b]) => {
      const videoAId = videoIdByYoutubeId.get(a.videoId)
      const videoBId = videoIdByYoutubeId.get(b.videoId)
      if (!videoAId || !videoBId) return []
      const reports = buildComparisonReports(a, b, rng)
      return [
        {
          user_id: userId,
          video_a_id: videoAId,
          video_b_id: videoBId,
          created_at: a.dateAnalysed,
          script_report: reports.script,
          packaging_report: reports.packaging,
          retention_report: reports.retention,
          report_run_started_at: null,
          deep_credits_charged: 0,
        },
      ]
    })

    if (comparisonRows.length > 0) {
      const { error } = await supabase
        .from("video_comparisons")
        .insert(comparisonRows)
      if (error) {
        throw new Error(`Failed to insert demo comparisons: ${error.message}`)
      }
      comparisonCount = comparisonRows.length
    }
  })

  // --- checklist -------------------------------------------------------------

  const tipRows = DEMO_SAVED_TIPS.map((entry, index) => ({
    user_id: userId,
    tip: entry.tip,
    section: entry.section,
    category: tipCategoryForSection(entry.section),
    source_path: `/analysed-video/${payloads[index % payloads.length].videoId}`,
    tip_fingerprint: `${DEMO_TIP_FINGERPRINT_PREFIX}${index}:${entry.tip.slice(0, 60)}`,
    position: index,
    // A checklist with a couple of lines already ticked shows both states.
    completed_at: index % 4 === 3 ? isoDaysAgo(now, index + 1) : null,
    created_at: isoDaysAgo(now, 20 - index),
  }))

  let savedTipCount = 0
  await optional("Checklist", async () => {
    const { error } = await supabase.from("saved_tips").insert(tipRows)
    if (error) throw new Error(error.message)
    savedTipCount = tipRows.length
  })

  // --- notifications ---------------------------------------------------------

  // The seeder writes no notifications. Two database triggers on
  // retention_window_event_synthesis already have: inserting the last 'ready'
  // synthesis row for a video raises its deep_analysis_complete notification
  // (migration 20260712130000), and the first video to get there also raises
  // the one-per-user channel_trends_ready notification (migration
  // 20260816120000). Inserting our own on top collided with
  // notifications_deep_analysis_video_idx and took the rest of the seed with it.
  //
  // What is left to do is age them. The triggers stamp created_at = now(), so
  // an account seeded with a year of uploads would show every notification
  // arriving in the same second. Each one is backdated to the analysis date of
  // the video it belongs to, and all but the newest are marked read, so the
  // bell carries a plausible history behind a single unread badge.
  let notificationCount = 0
  await optional("Notification dates", async () => {
    for (const [index, payload] of deepPayloads.entries()) {
      const analysedVideoId = videoIdByYoutubeId.get(payload.videoId)
      if (!analysedVideoId) continue
      const isNewest = index === deepPayloads.length - 1
      const { count, error } = await supabase
        .from("notifications")
        .update(
          {
            created_at: payload.dateAnalysed,
            read_at: isNewest ? null : payload.dateAnalysed,
          },
          { count: "exact" },
        )
        .eq("user_id", userId)
        .eq("analysed_video_id", analysedVideoId)
      if (error) throw new Error(error.message)
      notificationCount += count ?? 0
    }

    // The channel-trends notification carries no analysed_video_id, so it is
    // not covered by the loop above. It is the newest thing that happened, and
    // it is the one worth leaving unread: it points at the page this whole
    // library exists to fill.
    const { count: trendsCount, error: trendsError } = await supabase
      .from("notifications")
      .update(
        { created_at: newestAnalysedAt, read_at: null },
        { count: "exact" },
      )
      .eq("user_id", userId)
      .eq("kind", "channel_trends_ready")
    if (trendsError) throw new Error(trendsError.message)
    notificationCount += trendsCount ?? 0
  })

  // --- cost logs -------------------------------------------------------------

  const { data: userRow } = await supabase
    .from("users")
    .select("email")
    .eq("id", userId)
    .maybeSingle()
  const userEmail = (userRow as { email: string } | null)?.email ?? null

  const CALL_TYPES = [
    "pacing",
    "packaging_alignment",
    "packaging_taxonomy",
    "script_taxonomy",
    "retention_attribution",
    "event_synthesis",
    "snapshot",
    "audio",
  ] as const

  const costRows = payloads.flatMap((payload) => {
    const analysedVideoId = videoIdByYoutubeId.get(payload.videoId)
    const callTypes = payload.deepAnalysed
      ? CALL_TYPES
      : CALL_TYPES.slice(0, 5)
    return callTypes.map((callType) => {
      const inputTokens = rng.int(1_500, 26_000)
      const outputTokens = rng.int(300, 3_400)
      return {
        user_id: userId,
        user_email: userEmail,
        analysed_video_id: analysedVideoId,
        cost_type: "llm_call",
        call_type: callType,
        provider: "openai",
        model: DEMO_MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd:
          Math.round(
            (inputTokens * 0.0000025 + outputTokens * 0.00001) * 10000,
          ) / 10000,
        created_at: payload.dateAnalysed,
      }
    })
  })

  let costLogCount = 0
  await optional("Cost logs", async () => {
    if (costRows.length === 0) return
    const { error } = await supabase.from("cost_logs").insert(costRows)
    if (error) throw new Error(error.message)
    costLogCount = costRows.length
  })

  // --- activity history ------------------------------------------------------

  // Upserted while ignoring duplicates, so a day the account really was active
  // on keeps its own row. These are the one thing clearDemoData leaves behind;
  // see the note there.
  const activityRows = Array.from({ length: HISTORY_DAYS }, (_, index) => index)
    .filter(() => rng.bool(0.55))
    .map((daysAgo) => ({
      user_id: userId,
      activity_date: dateDaysAgo(now, daysAgo),
      last_seen_at: isoDaysAgo(now, daysAgo),
    }))

  await optional("Activity history", async () => {
    if (activityRows.length === 0) return
    const { error } = await supabase
      .from("user_daily_activity")
      .upsert(activityRows, {
        onConflict: "user_id,activity_date",
        ignoreDuplicates: true,
      })
    if (error) throw new Error(error.message)
  })

  // --- plan and usage --------------------------------------------------------

  let planGranted = false
  if (grantPaidPlan) {
    const periodStart = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000)
    const periodEnd = new Date(now.getTime() + 18 * 24 * 60 * 60 * 1000)

    const { error } = await supabase.from("billing_subscriptions").upsert(
      {
        user_id: userId,
        stripe_subscription_id: `${DEMO_SUBSCRIPTION_PREFIX}${userId}`,
        stripe_customer_id: `demo_cus_${userId}`,
        plan_id: "pro",
        billing_period: "monthly",
        status: "active",
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: false,
      },
      { onConflict: "user_id" },
    )
    if (error) {
      throw new Error(`Failed to grant the demo plan: ${error.message}`)
    }
    planGranted = true

    const { error: usageError } = await supabase.from("usage_counters").upsert(
      {
        user_id: userId,
        period_start: periodStart.toISOString(),
        video_analyses_used: wanted,
        deep_credits_used: sourceFileRows.reduce(
          (total, row) => total + (row.deep_credits_charged ?? 0),
          0,
        ),
      },
      { onConflict: "user_id,period_start" },
    )
    if (usageError) {
      throw new Error(
        `Failed to write demo usage counters: ${usageError.message}`,
      )
    }
  }

  return {
    videos: payloads.length,
    deepAnalysedVideos: deepPayloads.length,
    retentionWindows: windowCount,
    events: eventCount,
    comparisons: comparisonCount,
    savedTips: savedTipCount,
    notifications: notificationCount,
    costLogs: costLogCount,
    planGranted,
    warnings,
  }
}

// --- clearing ----------------------------------------------------------------

export interface ClearDemoDataResult {
  videos: number
  comparisons: number
  savedTips: number
  notifications: number
  planRemoved: boolean
}

/**
 * Removes everything seedDemoData wrote for one account.
 *
 * Deletes run children first so nothing is orphaned even where a foreign key
 * would not have cascaded. The one thing deliberately left behind is the
 * user_daily_activity history: those rows say only "this account was active on
 * this date", they are indistinguishable from real ones once written, and
 * removing a date range wholesale would take real activity with it. Seeding
 * writes them with ignoreDuplicates for the same reason.
 */
export async function clearDemoData(
  userId: string,
): Promise<ClearDemoDataResult> {
  const supabase = createAdminClient()

  const { data: demoVideos, error: lookupError } = await supabase
    .from("analysed_videos")
    .select("id")
    .eq("user_id", userId)
    .like("video_id", `${DEMO_VIDEO_ID_PREFIX}%`)

  if (lookupError) {
    throw new Error(`Failed to find demo videos: ${lookupError.message}`)
  }

  const videoIds = ((demoVideos ?? []) as { id: string }[]).map((row) => row.id)

  let comparisons = 0
  let notifications = 0

  if (videoIds.length > 0) {
    const { count: comparisonCount, error: comparisonError } = await supabase
      .from("video_comparisons")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .or(
        `video_a_id.in.(${videoIds.join(",")}),video_b_id.in.(${videoIds.join(",")})`,
      )
    if (comparisonError) {
      throw new Error(
        `Failed to remove demo comparisons: ${comparisonError.message}`,
      )
    }
    comparisons = comparisonCount ?? 0

    const { count: notificationCount, error: notificationError } = await supabase
      .from("notifications")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .in("analysed_video_id", videoIds)
    if (notificationError) {
      throw new Error(
        `Failed to remove demo notifications: ${notificationError.message}`,
      )
    }
    notifications = notificationCount ?? 0

    // cost_logs has no foreign key onto analysed_videos, so its rows would
    // otherwise survive the videos they belong to.
    const { error: costError } = await supabase
      .from("cost_logs")
      .delete()
      .eq("user_id", userId)
      .in("analysed_video_id", videoIds)
    if (costError) {
      throw new Error(`Failed to remove demo cost logs: ${costError.message}`)
    }

    // Everything else (retention windows and their events, synthesis jobs,
    // window transcripts, pacing, source files, pipeline runs) cascades from
    // the analysed_videos rows.
    const { error: videoError } = await supabase
      .from("analysed_videos")
      .delete()
      .eq("user_id", userId)
      .in("id", videoIds)
    if (videoError) {
      throw new Error(`Failed to remove demo videos: ${videoError.message}`)
    }
  }

  const { count: tipCount, error: tipError } = await supabase
    .from("saved_tips")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .like("tip_fingerprint", `${DEMO_TIP_FINGERPRINT_PREFIX}%`)
  if (tipError) {
    throw new Error(`Failed to remove demo saved tips: ${tipError.message}`)
  }

  const { count: planCount, error: planError } = await supabase
    .from("billing_subscriptions")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .like("stripe_subscription_id", `${DEMO_SUBSCRIPTION_PREFIX}%`)
  if (planError) {
    throw new Error(`Failed to remove the demo plan: ${planError.message}`)
  }

  return {
    videos: videoIds.length,
    comparisons,
    savedTips: tipCount ?? 0,
    notifications: notifications,
    planRemoved: (planCount ?? 0) > 0,
  }
}
