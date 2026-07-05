"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AreaChartIcon,
  GaugeIcon,
  ImageIcon,
  ListChecksIcon,
  QuoteIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"

import {
  RetentionChart,
  type RetentionChartInsight,
} from "@/components/retention-chart"
import { SourceVideoThumbnail } from "@/components/source-video-thumbnail"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { PacingAnalysis } from "@/lib/pacing-analysis"
import type { PackagingAlignment } from "@/lib/packaging-alignment"
import type {
  RetentionAttribution,
  RetentionMomentAttribution,
  RetentionMomentKind,
} from "@/lib/retention-attribution"
import { computeMetadataHygiene } from "@/lib/metadata-hygiene"
import type { RetentionWindow } from "@/lib/retention-windows"
import {
  transcriptForSegment,
  type RetentionPoint,
  type TranscriptCue,
  type VideoAnalyticsSummary,
  type VideoDetails,
} from "@/lib/youtube/youtube"

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const mm = hrs > 0 ? String(mins).padStart(2, "0") : String(mins)
  const ss = String(secs).padStart(2, "0")
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`
}

// Compact human number: 12345 -> "12.3K", 2_400_000 -> "2.4M".
function formatCompactNumber(value: number | null): string {
  if (value == null) return "—"
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

// ---------------------------------------------------------------------------
// The Hook (fixed, always-on opening windows analysed for every video)
// ---------------------------------------------------------------------------

function RetentionWindows({
  windows,
  transcript,
}: {
  windows: RetentionWindow[]
  transcript: TranscriptCue[]
}) {
  if (windows.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        No hook windows are available for this video.
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {windows.map((window) => {
        const said = transcriptForSegment(
          transcript,
          window.fromSeconds,
          window.toSeconds,
        )
        const endPercentage = Math.round((window.endWatchRatio ?? 0) * 100)
        const lostPercentage = Math.max(
          0,
          Math.round((window.startWatchRatio ?? 0) * 100) - endPercentage,
        )
        return (
          <div
            key={window.windowKey ?? window.windowIndex}
            className="rounded-xl border bg-card p-4"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{window.label}</h3>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {formatTimestamp(window.fromSeconds)} –{" "}
                  {formatTimestamp(window.toSeconds)}
                </span>
                {said && <ScriptSegmentTooltip text={said} />}
              </div>
            </div>

            {window.outOfRange ? (
              <p className="mt-3 text-sm text-muted-foreground">
                This video is too short to reach this window.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-4">
                <Metric label="Viewers lost" value={`${lostPercentage}%`} />
                <Metric
                  label="Still watching at end"
                  value={`${endPercentage}%`}
                />
                {window.relativePerformance != null && (
                  <Metric
                    label="vs. similar videos"
                    value={`${Math.round(window.relativePerformance * 100)}%`}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function PacingAnalysisSection({
  analysis,
  transcript,
  hasTranscript,
}: {
  analysis: PacingAnalysis | null
  transcript: TranscriptCue[]
  hasTranscript: boolean
}) {
  return (
    <>
      {!analysis ? (
        <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
          {hasTranscript
            ? "Pacing analysis could not be generated right now. It will be retried the next time this report is opened."
            : "Pacing analysis is unavailable because this video has no timestamped transcript."}
        </div>
      ) : analysis.slowOrRepetitiveStretches.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
          No slow or repetitive stretches stood out — the pacing holds up across
          this video.
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {[...analysis.slowOrRepetitiveStretches]
            .sort((a, b) => a.startSeconds - b.startSeconds)
            .map((stretch, index) => {
            const said = transcriptForSegment(
              transcript,
              stretch.startSeconds,
              stretch.endSeconds,
            )
            return (
            <li
              key={index}
              className="flex flex-col gap-2 p-4"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-mono text-sm">
                  {formatTimestamp(stretch.startSeconds)} –{" "}
                  {formatTimestamp(stretch.endSeconds)}
                </span>
                {said && <ScriptSegmentTooltip text={said} />}
              </div>
              <p className="pl-10 text-sm">{stretch.reason}</p>
              {stretch.suggestion && (
                <p className="pl-10 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Try: </span>
                  {stretch.suggestion}
                </p>
              )}
            </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Drop-off list (significant drops)
// ---------------------------------------------------------------------------

// A small explanation + optional tip block, shared by the drop-off and gain
// lists, rendered from the LLM retention attribution when one is available for
// that window.
function AttributionNote({
  attribution,
}: {
  attribution: RetentionMomentAttribution | undefined
}) {
  if (!attribution || attribution.explanation === "") return null
  return (
    <div className="pl-10">
      <p className="text-sm">{attribution.explanation}</p>
      {attribution.tip && (
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Try: </span>
          {attribution.tip}
        </p>
      )}
    </div>
  )
}

function DropList({
  drops,
  transcript,
  attribution,
}: {
  // The significant *mid-video* drop-offs (kind = 'drop_off'). The Hook section
  // above already covers the opening, so these never overlap it.
  drops: RetentionWindow[]
  transcript: TranscriptCue[]
  // AI explanations/tips keyed by the drop-off's windowIndex, when generated.
  attribution: Map<number, RetentionMomentAttribution>
}) {
  if (drops.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        No abnormal drop-offs detected — retention falls about as evenly as a
        typical video, with no single moment standing out.
      </div>
    )
  }

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {drops.map((drop, index) => {
        const said = transcriptForSegment(
          transcript,
          drop.fromSeconds,
          drop.toSeconds,
        )
        return (
          <li key={`${drop.fromSeconds}-${index}`} className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-mono text-sm">
                  {formatTimestamp(drop.fromSeconds)} –{" "}
                  {formatTimestamp(drop.toSeconds)}
                </span>
                {drop.isAbnormallySteep && (
                  <Badge>
                    {(drop.steepness ?? 0).toFixed(1)}× steeper than normal
                  </Badge>
                )}
                {drop.relativePerformance != null && (
                  <Badge tone={drop.relativePerformance < 0.5 ? "warn" : "muted"}>
                    {Math.round(drop.relativePerformance * 100)}% vs. similar
                  </Badge>
                )}
                {said && <ScriptSegmentTooltip text={said} />}
              </div>
              <span className="text-sm font-medium text-destructive">
                −{(Math.abs(drop.delta) * 100).toFixed(1)}%
              </span>
            </div>

            <AttributionNote attribution={attribution.get(drop.windowIndex)} />
          </li>
        )
      })}
    </ul>
  )
}

// A compact hover affordance that reveals the transcript segment for a window
// without spending vertical space on it in the card body.
function ScriptSegmentTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
            aria-label="Show what was said in this window"
          />
        }
      >
        <QuoteIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">“…{text}…”</TooltipContent>
    </Tooltip>
  )
}

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "warn"
}) {
  const cls =
    tone === "warn"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
      : "bg-muted text-muted-foreground"
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Gains list
// ---------------------------------------------------------------------------

function GainList({
  gains,
  transcript,
  attribution,
}: {
  gains: RetentionWindow[]
  transcript: TranscriptCue[]
  attribution: Map<number, RetentionMomentAttribution>
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {gains.map((gain, index) => {
        const said = transcriptForSegment(
          transcript,
          gain.fromSeconds,
          gain.toSeconds,
        )
        return (
          <li key={`${gain.fromSeconds}-${index}`} className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-mono text-sm">
                  {formatTimestamp(gain.fromSeconds)} –{" "}
                  {formatTimestamp(gain.toSeconds)}
                </span>
                {said && <ScriptSegmentTooltip text={said} />}
              </div>
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                +{(gain.delta * 100).toFixed(1)}%
              </span>
            </div>

            <AttributionNote attribution={attribution.get(gain.windowIndex)} />
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Title / Thumbnail / Hook alignment (LLM + vision over the thumbnail)
// ---------------------------------------------------------------------------

function PackagingAlignmentSection({
  alignment,
  hasThumbnail,
}: {
  alignment: PackagingAlignment | null
  hasThumbnail: boolean
}) {
  if (!alignment) {
    return (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        {hasThumbnail
          ? "Title & thumbnail analysis could not be generated right now. It will be retried the next time this report is opened."
          : "Title & thumbnail analysis is unavailable because this video has no thumbnail image."}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-medium">Alignment Summary</h3>
        <p className="mt-2 text-sm text-muted-foreground">{alignment.overall}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PointsCard
          title="What worked well"
          tone="good"
          points={alignment.whatWorked.slice(0, 3)}
        />
        <PointsCard
          title="What could be improved"
          tone="warn"
          points={alignment.whatCouldBeBetter.slice(0, 3)}
        />
      </div>
    </div>
  )
}

function PointsCard({
  title,
  tone,
  points,
}: {
  title: string
  tone: "good" | "warn"
  points: string[]
}) {
  const dot =
    tone === "good"
      ? "bg-emerald-500 dark:bg-emerald-400"
      : "bg-amber-500 dark:bg-amber-400"
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {points.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing to flag.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {points.map((point, index) => (
            <li key={index} className="flex gap-2 text-sm">
              <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metadata hygiene (deterministic checks)
// ---------------------------------------------------------------------------

function MetadataHygieneSection({ video }: { video: VideoDetails }) {
  const hygiene = useMemo(() => computeMetadataHygiene(video), [video])

  const statusStyles: Record<
    (typeof hygiene.checks)[number]["status"],
    string
  > = {
    good: "bg-emerald-500 dark:bg-emerald-400",
    warn: "bg-amber-500 dark:bg-amber-400",
    info: "bg-muted-foreground/40",
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        {hygiene.goodCount} of {hygiene.scoredCount} metadata checks look
        healthy. These are quick packaging basics you can fix in YouTube Studio.
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {hygiene.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-3 p-4">
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${statusStyles[check.status]}`}
            />
            <div>
              <div className="text-sm font-medium">{check.label}</div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {check.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top-level detail
// ---------------------------------------------------------------------------

export function AnalysedVideoDetail({
  video,
  retention,
  retentionWindows,
  transcript = [],
  pacingAnalysis = null,
  retentionAttribution = null,
  packagingAlignment = null,
  analyticsSummary = null,
}: {
  video: VideoDetails
  retention: RetentionPoint[]
  retentionWindows: RetentionWindow[]
  transcript?: TranscriptCue[]
  pacingAnalysis?: PacingAnalysis | null
  retentionAttribution?: RetentionAttribution | null
  packagingAlignment?: PackagingAlignment | null
  analyticsSummary?: VideoAnalyticsSummary | null
}) {
  const [previewTime, setPreviewTime] = useState<number | null>(null)
  const [playbackWindow, setPlaybackWindow] = useState<{
    id: string
    fromSeconds: number
    toSeconds: number
  } | null>(null)
  const insightAreaRef = useRef<HTMLDivElement | null>(null)

  // Dismiss the open insight (returning the video to its thumbnail) when the
  // user clicks anywhere outside the video/chart area — not just inside the
  // chart itself — so scrolling down and clicking elsewhere on the page
  // closes it the same way clicking off inside the chart already does.
  useEffect(() => {
    if (!playbackWindow) return

    function handlePointerDown(event: PointerEvent) {
      if (!insightAreaRef.current) return
      if (!(event.target instanceof Node)) return
      if (!insightAreaRef.current.contains(event.target)) {
        setPlaybackWindow(null)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [playbackWindow])

  const hookWindows = retentionWindows.filter((w) => w.kind === "hook")
  const drops = retentionWindows.filter((w) => w.kind === "drop_off")
  const gains = retentionWindows.filter((w) => w.kind === "gain")

  // Index the LLM attribution by kind + windowIndex so each drop-off / gain card
  // can pick up its own explanation and tip.
  const attributionByKind = (
    kind: RetentionMomentKind,
  ): Map<number, RetentionMomentAttribution> => {
    const map = new Map<number, RetentionMomentAttribution>()
    for (const moment of retentionAttribution?.moments ?? []) {
      if (moment.kind === kind) map.set(moment.windowIndex, moment)
    }
    return map
  }
  const dropAttribution = attributionByKind("drop_off")
  const gainAttribution = attributionByKind("gain")
  const chartInsights: RetentionChartInsight[] = [
    ...hookWindows
      .filter((window) => !window.outOfRange)
      .map((window) => {
        const endPercentage = Math.round((window.endWatchRatio ?? 0) * 100)
        const lostPercentage = Math.max(
          0,
          Math.round((window.startWatchRatio ?? 0) * 100) - endPercentage,
        )
        const said = transcriptForSegment(
          transcript,
          window.fromSeconds,
          window.toSeconds,
        )

        return {
          id: `hook-${window.windowKey ?? window.windowIndex}`,
          kind: "hook" as const,
          label: window.label ?? `Hook window ${window.windowIndex + 1}`,
          fromSeconds: window.fromSeconds,
          toSeconds: Math.min(window.toSeconds, video.durationSeconds),
          metric: `${lostPercentage}%`,
          metricLabel: "viewers lost",
          details: [
            `${endPercentage}% still watching at end`,
            ...(window.relativePerformance != null
              ? [`${Math.round(window.relativePerformance * 100)}% vs. similar videos`]
              : []),
          ],
          transcript: said
            ? said.length > 240
              ? `${said.slice(0, 240)}…`
              : said
            : undefined,
        }
      }),
    ...drops.map((window) => {
      const said = transcriptForSegment(
        transcript,
        window.fromSeconds,
        window.toSeconds,
      )

      return {
        id: `drop-${window.windowIndex}`,
        kind: "drop" as const,
        label: `Significant drop-off ${window.windowIndex + 1}`,
        fromSeconds: window.fromSeconds,
        toSeconds: window.toSeconds,
        metric: `−${(Math.abs(window.delta) * 100).toFixed(1)}%`,
        metricLabel: "audience retention",
        details: [
          ...(window.isAbnormallySteep
            ? [`${(window.steepness ?? 0).toFixed(1)}× steeper than normal`]
            : []),
          ...(window.relativePerformance != null
            ? [`${Math.round(window.relativePerformance * 100)}% vs. similar videos`]
            : []),
        ],
        transcript: said || undefined,
      }
    }),
    ...gains.map((window) => {
      const said = transcriptForSegment(
        transcript,
        window.fromSeconds,
        window.toSeconds,
      )

      return {
        id: `gain-${window.windowIndex}`,
        kind: "gain" as const,
        label: `Retention gain ${window.windowIndex + 1}`,
        fromSeconds: window.fromSeconds,
        toSeconds: window.toSeconds,
        metric: `+${(window.delta * 100).toFixed(1)}%`,
        metricLabel: "audience retention",
        transcript: said || undefined,
      }
    }),
    ...(pacingAnalysis?.slowOrRepetitiveStretches ?? []).map(
      (stretch, index) => ({
        id: `pacing-${stretch.startSeconds}-${index}`,
        kind: "pacing" as const,
        label: `Pacing opportunity ${index + 1}`,
        fromSeconds: stretch.startSeconds,
        toSeconds: stretch.endSeconds,
        details: stretch.suggestion ? [`Try: ${stretch.suggestion}`] : undefined,
        transcript: stretch.reason,
      }),
    ),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div ref={insightAreaRef} className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
          {video.thumbnailUrl && (
            <div className="shrink-0 sm:self-start">
              <SourceVideoThumbnail
                videoId={video.id}
                thumbnailUrl={video.thumbnailUrl}
                title={video.title}
                scrubTime={previewTime}
                playbackWindow={playbackWindow}
              />
            </div>
          )}
          <div className="flex flex-1 flex-col">
            <h1 className="text-2xl font-semibold tracking-normal">
              {video.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Audience retention across this video, with the moments where you
              lost and held the most viewers.
            </p>
            {analyticsSummary && (
              <div className="mt-4 flex flex-wrap items-start gap-x-8 gap-y-3 sm:mt-auto sm:pt-4">
                <Metric
                  label="Views"
                  value={formatCompactNumber(analyticsSummary.views)}
                />
                <Metric
                  label="Avg. view duration"
                  value={
                    analyticsSummary.averageViewDurationSeconds != null
                      ? formatTimestamp(
                          analyticsSummary.averageViewDurationSeconds,
                        )
                      : "—"
                  }
                />
              </div>
            )}
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AreaChartIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Audience retention</h2>
          </div>
          <RetentionChart
            points={retention}
            durationSeconds={video.durationSeconds}
            insights={chartInsights}
            selectedInsightId={playbackWindow?.id ?? null}
            onScrubTimeChange={setPreviewTime}
            onInsightSelect={(insight) =>
              setPlaybackWindow(
                insight
                  ? {
                      id: insight.id,
                      fromSeconds: insight.fromSeconds,
                      toSeconds: insight.toSeconds,
                    }
                  : null,
              )
            }
          />
        </section>
      </div>

      <Tabs defaultValue="packaging">
        <TabsList>
          <TabsTrigger value="packaging">
            <ImageIcon className="text-purple-600 dark:text-purple-400" />
            Title, Thumbnail &amp; Hook
          </TabsTrigger>
          <TabsTrigger value="metadata">
            <ListChecksIcon className="text-teal-600 dark:text-teal-400" />
            Metadata
          </TabsTrigger>
          <TabsTrigger value="hook">
            <GaugeIcon className="text-yellow-500 dark:text-yellow-400" />
            The Hook
          </TabsTrigger>
          <TabsTrigger value="drop-offs">
            <TrendingDownIcon className="text-destructive" />
            Retention Drop Offs
          </TabsTrigger>
          <TabsTrigger value="gains">
            <TrendingUpIcon className="text-emerald-600 dark:text-emerald-400" />
            Retention Gains
          </TabsTrigger>
          <TabsTrigger value="pacing">
            <GaugeIcon className="text-blue-600 dark:text-blue-400" />
            Pacing Analysis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="packaging">
          <PackagingAlignmentSection
            alignment={packagingAlignment}
            hasThumbnail={Boolean(video.thumbnailUrl)}
          />
        </TabsContent>

        <TabsContent value="metadata">
          <MetadataHygieneSection video={video} />
        </TabsContent>

        <TabsContent value="hook">
          <RetentionWindows windows={hookWindows} transcript={transcript} />
        </TabsContent>

        <TabsContent value="drop-offs">
          <DropList
            drops={drops}
            transcript={transcript}
            attribution={dropAttribution}
          />
        </TabsContent>

        <TabsContent value="gains">
          {gains.length === 0 ? (
            <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
              No notable retention gains stood out for this video.
            </div>
          ) : (
            <GainList
              gains={gains}
              transcript={transcript}
              attribution={gainAttribution}
            />
          )}
        </TabsContent>

        <TabsContent value="pacing">
          <PacingAnalysisSection
            analysis={pacingAnalysis}
            transcript={transcript}
            hasTranscript={transcript.length > 0}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
