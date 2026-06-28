"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import {
  GaugeIcon,
  Loader2Icon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { RetentionChart } from "@/components/retention-chart"
import type { VideoInsights } from "@/lib/ai/insights"
import {
  computeHookStats,
  detectRetentionGains,
  detectSignificantDropOffs,
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
// Hook performance card
// ---------------------------------------------------------------------------

function HookCard({
  retention,
  durationSeconds,
  transcript,
  hookInsight,
}: {
  retention: RetentionPoint[]
  durationSeconds: number
  transcript: TranscriptCue[]
  hookInsight: VideoInsights["hook"] | null
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
          {hookInsight && (
            <div className="flex flex-col">
              <span className="text-3xl font-semibold tabular-nums">
                {hookInsight.score}
                <span className="text-base font-normal text-muted-foreground">
                  /100
                </span>
              </span>
              <span className="text-xs text-muted-foreground">Hook score</span>
            </div>
          )}

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

        {hookInsight && (
          <div className="mt-4 border-t pt-4">
            <p className="text-sm font-medium">{hookInsight.verdict}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hookInsight.analysis}
            </p>
          </div>
        )}

        {said && (
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Opening line: </span>“
            {said.length > 240 ? `${said.slice(0, 240)}…` : said}”
          </p>
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
// Drop-off list (significant drops, with inline AI hypotheses when present)
// ---------------------------------------------------------------------------

function DropList({
  retention,
  transcript,
  insights,
}: {
  retention: RetentionPoint[]
  transcript: TranscriptCue[]
  insights: VideoInsights | null
}) {
  const drops = useMemo(
    () => detectSignificantDropOffs(retention),
    [retention],
  )

  const insightByTime = useMemo(() => {
    const map = new Map<number, VideoInsights["drops"][number]>()
    for (const d of insights?.drops ?? []) {
      map.set(Math.round(d.fromTimestampSeconds), d)
    }
    return map
  }, [insights])

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
        const ai = insightByTime.get(Math.round(drop.fromTimestampSeconds))
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

            {ai?.hypothesis && (
              <div className="ml-10 rounded-lg border border-dashed bg-muted/30 p-3">
                <p className="text-sm">
                  <span className="font-medium">Likely cause: </span>
                  {ai.hypothesis}
                </p>
                {ai.suggestion && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Try: </span>
                    {ai.suggestion}
                  </p>
                )}
              </div>
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
  retention,
  transcript,
}: {
  retention: RetentionPoint[]
  transcript: TranscriptCue[]
}) {
  const gains = useMemo(() => detectRetentionGains(retention), [retention])

  if (gains.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        No notable rewatch spikes — retention only declined across this video.
      </div>
    )
  }

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
// AI insights bar (summary + generate / regenerate control)
// ---------------------------------------------------------------------------

function InsightsBar({
  videoId,
  aiEnabled,
  insights,
  onInsights,
}: {
  videoId: string
  aiEnabled: boolean
  insights: VideoInsights | null
  onInsights: (insights: VideoInsights) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/insights/${videoId}`, { method: "POST" })
      const data = (await res.json()) as {
        insights?: VideoInsights
        error?: string
      }
      if (!res.ok || !data.insights) {
        setError(data.error ?? "Failed to generate insights.")
        return
      }
      onInsights(data.insights)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (!insights) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <SparklesIcon className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">AI insights</p>
            <p className="text-sm text-muted-foreground">
              Score the hook and get a likely-cause hypothesis for each major
              drop, grounded in what was said and shown on screen.
            </p>
          </div>
        </div>
        {aiEnabled ? (
          <Button onClick={generate} disabled={loading} className="shrink-0">
            {loading ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Analysing…
              </>
            ) : (
              <>
                <SparklesIcon className="size-4" />
                Generate AI insights
              </>
            )}
          </Button>
        ) : (
          <p className="shrink-0 text-sm text-muted-foreground">
            Set <code className="font-mono">ANTHROPIC_API_KEY</code> to enable.
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive sm:hidden">{error}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div className="flex items-start gap-3">
        <SparklesIcon className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-medium">AI summary</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {insights.summary}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>
          Generated {new Date(insights.generatedAt).toLocaleString()} ·{" "}
          {insights.usedFrames
            ? "analysed on-screen frames"
            : "transcript only (no frames available)"}
        </span>
        {aiEnabled && (
          <Button
            variant="ghost"
            size="sm"
            onClick={generate}
            disabled={loading}
          >
            {loading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SparklesIcon className="size-4" />
            )}
            Regenerate
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top-level detail
// ---------------------------------------------------------------------------

export function AnalysedVideoDetail({
  video,
  retention,
  transcript = [],
  initialInsights = null,
  aiEnabled = false,
}: {
  video: VideoDetails
  retention: RetentionPoint[]
  transcript?: TranscriptCue[]
  initialInsights?: VideoInsights | null
  aiEnabled?: boolean
}) {
  const [insights, setInsights] = useState<VideoInsights | null>(initialInsights)

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
            and held the most viewers — and why.
          </p>
        </div>
      </div>

      <InsightsBar
        videoId={video.id}
        aiEnabled={aiEnabled}
        insights={insights}
        onInsights={setInsights}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Audience retention
        </h2>
        <RetentionChart
          points={retention}
          durationSeconds={video.durationSeconds}
        />
      </section>

      <HookCard
        retention={retention}
        durationSeconds={video.durationSeconds}
        transcript={transcript}
        hookInsight={insights?.hook ?? null}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <TrendingDownIcon className="size-4 text-destructive" />
            <h2 className="text-sm font-medium">Biggest drop-offs</h2>
          </div>
          <DropList
            retention={retention}
            transcript={transcript}
            insights={insights}
          />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <TrendingUpIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-medium">Held or grew the audience</h2>
          </div>
          <GainList retention={retention} transcript={transcript} />
        </section>
      </div>
    </div>
  )
}
