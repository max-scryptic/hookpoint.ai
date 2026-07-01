"use client"

import { useEffect, useRef, useState } from "react"
import {
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"

import type { DeepAnalysisProgress as ProgressResponse } from "@/lib/retention-window-media-progress"

const POLL_INTERVAL_MS = 4000

const STAGE_LABELS: {
  key: keyof NonNullable<ProgressResponse["stages"]>
  label: string
}[] = [
  { key: "transcoding", label: "Transcoding video" },
  { key: "snapshots", label: "Fetching snapshots" },
  { key: "snapshotAnalysis", label: "Analyzing visuals" },
  { key: "audio", label: "Fetching audio" },
  { key: "audioAnalysis", label: "Analyzing audio" },
  { key: "transcript", label: "Fetching transcript" },
]

// Polls /api/videos/:videoId/analysis-progress while a raw upload's
// transcode/snapshot/audio harvest is running, showing each stage's live
// status underneath the source-file card. Renders nothing once the video has
// no source file yet, or once every stage has settled — the "Source file
// ready" row above already covers the steady state.
export function DeepAnalysisProgress({ videoId }: { videoId: string }) {
  const [progress, setProgress] = useState<ProgressResponse | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/videos/${videoId}/analysis-progress`)
        if (!res.ok || cancelled) return
        const data = (await res.json()) as ProgressResponse
        if (cancelled) return
        setProgress(data)
        if (!data.complete) {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
        }
      } catch {
        if (!cancelled) timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [videoId])

  if (!progress?.active || !progress.stages || progress.complete) return null

  return (
    <div className="mt-4 flex flex-col gap-2 border-t pt-4">
      <p className="text-sm font-medium">Conducting deeper analysis…</p>
      <ul className="flex flex-col gap-1.5">
        {STAGE_LABELS.map(({ key, label }) => (
          <StageRow key={key} label={label} status={progress.stages![key]} />
        ))}
      </ul>
    </div>
  )
}

function StageRow({
  label,
  status,
}: {
  label: string
  status: "pending" | "in_progress" | "ready" | "failed"
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <StageIcon status={status} />
      <span
        className={status === "pending" ? "text-muted-foreground" : undefined}
      >
        {label}
      </span>
    </li>
  )
}

function StageIcon({
  status,
}: {
  status: "pending" | "in_progress" | "ready" | "failed"
}) {
  switch (status) {
    case "pending":
      return <CircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
    case "in_progress":
      return (
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />
      )
    case "ready":
      return (
        <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
      )
    case "failed":
      return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
  }
}
