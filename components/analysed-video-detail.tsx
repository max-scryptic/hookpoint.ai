"use client"

import { useEffect, useRef, useState } from "react"
import {
  AreaChartIcon,
  GaugeIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"

import {
  RetentionChart,
  type RetentionChartInsight,
} from "@/components/retention-chart"
import { SourceVideoThumbnail } from "@/components/source-video-thumbnail"
import type { PacingAnalysis } from "@/lib/pacing-analysis"
import type { RetentionWindow } from "@/lib/retention-windows"
import {
  transcriptForSegment,
  type RetentionPoint,
  type TranscriptCue,
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
  if (windows.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <GaugeIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">The Hook</h2>
      </div>

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
                <span className="font-mono text-xs text-muted-foreground">
                  {formatTimestamp(window.fromSeconds)} –{" "}
                  {formatTimestamp(window.toSeconds)}
                </span>
              </div>

              {window.outOfRange ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  This video is too short to reach this window.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-4">
                    <Metric
                      label="Viewers lost"
                      value={`${lostPercentage}%`}
                    />
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

                  {said && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      “{said.length > 240 ? `${said.slice(0, 240)}…` : said}”
                    </p>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function PacingAnalysisSection({
  analysis,
  hasTranscript,
}: {
  analysis: PacingAnalysis | null
  hasTranscript: boolean
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <GaugeIcon className="size-4 text-violet-600 dark:text-violet-400" />
        <h2 className="text-sm font-medium">Pacing analysis</h2>
      </div>

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
            .map((stretch, index) => (
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
              </div>
              <p className="pl-10 text-sm">{stretch.reason}</p>
              {stretch.suggestion && (
                <p className="pl-10 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Try: </span>
                  {stretch.suggestion}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Drop-off list (significant drops)
// ---------------------------------------------------------------------------

function DropList({
  drops,
  transcript,
}: {
  // The significant *mid-video* drop-offs (kind = 'drop_off'). The Hook section
  // above already covers the opening, so these never overlap it.
  drops: RetentionWindow[]
  transcript: TranscriptCue[]
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
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-mono text-sm">
                  {formatTimestamp(drop.fromSeconds)} –{" "}
                  {formatTimestamp(drop.toSeconds)}
                </span>
              </div>
              <span className="text-sm font-medium text-destructive">
                −{(Math.abs(drop.delta) * 100).toFixed(1)}%
              </span>
            </div>

            <div className="flex flex-wrap gap-2 pl-10">
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
            </div>

            {said && (
              <p className="pl-10 text-sm text-muted-foreground">“{said}”</p>
            )}
          </li>
        )
      })}
    </ul>
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
}: {
  gains: RetentionWindow[]
  transcript: TranscriptCue[]
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
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-mono text-sm">
                  {formatTimestamp(gain.fromSeconds)} –{" "}
                  {formatTimestamp(gain.toSeconds)}
                </span>
              </div>
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                +{(gain.delta * 100).toFixed(1)}%
              </span>
            </div>
            {said && (
              <p className="pl-10 text-sm text-muted-foreground">“{said}”</p>
            )}
          </li>
        )
      })}
    </ul>
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
}: {
  video: VideoDetails
  retention: RetentionPoint[]
  retentionWindows: RetentionWindow[]
  transcript?: TranscriptCue[]
  pacingAnalysis?: PacingAnalysis | null
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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {video.thumbnailUrl && (
            <SourceVideoThumbnail
              videoId={video.id}
              thumbnailUrl={video.thumbnailUrl}
              title={video.title}
              scrubTime={previewTime}
              playbackWindow={playbackWindow}
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              {video.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Audience retention across this video, with the moments where you
              lost and held the most viewers.
            </p>
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

      <RetentionWindows windows={hookWindows} transcript={transcript} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <TrendingDownIcon className="size-4 text-destructive" />
          <h2 className="text-sm font-medium">Biggest drop-offs</h2>
        </div>
        <DropList drops={drops} transcript={transcript} />
      </section>

      {gains.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <TrendingUpIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-medium">Biggest retention gains</h2>
          </div>
          <GainList gains={gains} transcript={transcript} />
        </section>
      )}

      <PacingAnalysisSection
        analysis={pacingAnalysis}
        hasTranscript={transcript.length > 0}
      />
    </div>
  )
}
