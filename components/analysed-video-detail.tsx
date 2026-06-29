"use client"

import { useMemo } from "react"
import Image from "next/image"
import {
  AreaChartIcon,
  GaugeIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"

import { RetentionChart } from "@/components/retention-chart"
import {
  computeHookStats,
  detectRetentionGains,
  detectSignificantDropOffs,
  transcriptForSegment,
  type RetentionGain,
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
// Hook performance card
// ---------------------------------------------------------------------------

function HookCard({
  retention,
  durationSeconds,
  transcript,
}: {
  retention: RetentionPoint[]
  durationSeconds: number
  transcript: TranscriptCue[]
}) {
  const stats = useMemo(
    () => computeHookStats(retention, durationSeconds),
    [retention, durationSeconds],
  )
  if (!stats) return null

  const said = transcriptForSegment(transcript, 0, stats.windowSeconds)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <GaugeIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">
          Hook · first {Math.round(stats.windowSeconds)}s
        </h2>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <Metric
            label="Viewers lost"
            value={`${(stats.drop * 100).toFixed(1)}%`}
          />
          <Metric
            label="Still watching at end of hook"
            value={`${Math.round(stats.endWatchRatio * 100)}%`}
          />
          {stats.relativePerformance != null && (
            <Metric
              label="vs. similar videos"
              value={`${Math.round(stats.relativePerformance * 100)}%`}
            />
          )}
        </div>

        {said && (
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Opening line:{" "}
              </span>
              “{said.length > 240 ? `${said.slice(0, 240)}…` : said}”
            </p>
          </div>
        )}
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

// ---------------------------------------------------------------------------
// Drop-off list (significant drops)
// ---------------------------------------------------------------------------

function DropList({
  retention,
  transcript,
}: {
  retention: RetentionPoint[]
  transcript: TranscriptCue[]
}) {
  const drops = useMemo(
    () => detectSignificantDropOffs(retention),
    [retention],
  )

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
          drop.fromTimestampSeconds,
          drop.toTimestampSeconds,
        )
        return (
          <li key={`${drop.fromTimestampSeconds}-${index}`} className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-mono text-sm">
                  {formatTimestamp(drop.fromTimestampSeconds)} –{" "}
                  {formatTimestamp(drop.toTimestampSeconds)}
                </span>
              </div>
              <span className="text-sm font-medium text-destructive">
                −{(drop.watchRatioDrop * 100).toFixed(1)}%
              </span>
            </div>

            <div className="flex flex-wrap gap-2 pl-10">
              {drop.isAbnormallySteep && (
                <Badge>{drop.steepness.toFixed(1)}× steeper than normal</Badge>
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
  gains: RetentionGain[]
  transcript: TranscriptCue[]
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {gains.map((gain, index) => {
        const said = transcriptForSegment(
          transcript,
          gain.fromTimestampSeconds,
          gain.toTimestampSeconds,
        )
        return (
          <li key={`${gain.fromTimestampSeconds}-${index}`} className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-mono text-sm">
                  {formatTimestamp(gain.fromTimestampSeconds)} –{" "}
                  {formatTimestamp(gain.toTimestampSeconds)}
                </span>
              </div>
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                +{(gain.watchRatioGain * 100).toFixed(1)}%
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
  transcript = [],
}: {
  video: VideoDetails
  retention: RetentionPoint[]
  transcript?: TranscriptCue[]
}) {
  const gains = useMemo(() => detectRetentionGains(retention), [retention])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {video.thumbnailUrl && (
          <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-muted sm:w-64">
            <Image
              src={video.thumbnailUrl}
              alt={video.title}
              fill
              sizes="256px"
              className="object-cover"
            />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {video.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Audience retention across this video, with the moments where you lost
            and held the most viewers.
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
        />
      </section>

      <HookCard
        retention={retention}
        durationSeconds={video.durationSeconds}
        transcript={transcript}
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <TrendingDownIcon className="size-4 text-destructive" />
          <h2 className="text-sm font-medium">Biggest drop-offs</h2>
        </div>
        <DropList retention={retention} transcript={transcript} />
      </section>

      {gains.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <TrendingUpIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-medium">Held or grew the audience</h2>
          </div>
          <GainList gains={gains} transcript={transcript} />
        </section>
      )}
    </div>
  )
}
