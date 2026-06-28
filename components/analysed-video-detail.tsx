import Image from "next/image"
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import { RetentionChart } from "@/components/retention-chart"
import {
  transcriptForSegment,
  type DropOff,
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

interface SegmentRow {
  fromTimestampSeconds: number
  toTimestampSeconds: number
  // Signed change in retention across the segment, as a percentage-point delta.
  deltaPercent: number
  // What was being said across this segment, when a transcript is available.
  transcript: string
}

function SegmentList({
  rows,
  tone,
  emptyLabel,
}: {
  rows: SegmentRow[]
  tone: "drop" | "gain"
  emptyLabel: string
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }

  const accent = tone === "drop" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {rows.map((row, index) => (
        <li
          key={`${row.fromTimestampSeconds}-${index}`}
          className="flex flex-col gap-2 p-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {index + 1}
              </span>
              <span className="font-mono text-sm">
                {formatTimestamp(row.fromTimestampSeconds)} –{" "}
                {formatTimestamp(row.toTimestampSeconds)}
              </span>
            </div>
            <span className={`text-sm font-medium ${accent}`}>
              {row.deltaPercent >= 0 ? "+" : "−"}
              {Math.abs(row.deltaPercent).toFixed(1)}%
            </span>
          </div>
          {row.transcript && (
            <p className="pl-10 text-sm text-muted-foreground">
              “{row.transcript}”
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

export function AnalysedVideoDetail({
  video,
  retention,
  dropOffs,
  gains,
  transcript = [],
}: {
  video: VideoDetails
  retention: RetentionPoint[]
  dropOffs: DropOff[]
  gains: RetentionGain[]
  transcript?: TranscriptCue[]
}) {
  const dropRows: SegmentRow[] = dropOffs.map((drop) => ({
    fromTimestampSeconds: drop.fromTimestampSeconds,
    toTimestampSeconds: drop.toTimestampSeconds,
    deltaPercent: -drop.watchRatioDrop * 100,
    transcript: transcriptForSegment(
      transcript,
      drop.fromTimestampSeconds,
      drop.toTimestampSeconds,
    ),
  }))

  const gainRows: SegmentRow[] = gains.map((gain) => ({
    fromTimestampSeconds: gain.fromTimestampSeconds,
    toTimestampSeconds: gain.toTimestampSeconds,
    deltaPercent: gain.watchRatioGain * 100,
    transcript: transcriptForSegment(
      transcript,
      gain.fromTimestampSeconds,
      gain.toTimestampSeconds,
    ),
  }))

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
        <h2 className="text-sm font-medium text-muted-foreground">
          Audience retention
        </h2>
        <RetentionChart
          points={retention}
          durationSeconds={video.durationSeconds}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <TrendingDownIcon className="size-4 text-destructive" />
            <h2 className="text-sm font-medium">Biggest drop-offs</h2>
          </div>
          <SegmentList
            rows={dropRows}
            tone="drop"
            emptyLabel="No sharp drop-offs detected — retention is fairly steady across this video."
          />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <TrendingUpIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-medium">Held or grew the audience</h2>
          </div>
          <SegmentList
            rows={gainRows}
            tone="gain"
            emptyLabel="No notable rewatch spikes — retention only declined across this video."
          />
        </section>
      </div>
    </div>
  )
}
