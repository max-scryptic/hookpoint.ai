"use client"

import { useEffect, useRef, useState } from "react"
import {
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"

import type { DeepAnalysisPipelineRunSummary } from "@/lib/deep-analysis-pipeline-runs"
import type { DeepAnalysisProgress as ProgressResponse } from "@/lib/retention-window-media-progress"

const POLL_INTERVAL_MS = 4000

// What /api/videos/:videoId/analysis-progress actually returns: the stage
// snapshot, plus the latest pipeline-run summary and a `degraded` flag the
// route sets when it couldn't compute the per-stage breakdown but a source
// file is still ready (e.g. a transient DB error or schema drift). `degraded`
// lets the card keep showing a generic "analysing" state instead of a blank
// row — the failure mode that once left an in-flight upload with no visible
// indication at all.
export interface DeepAnalysisProgressResponse extends ProgressResponse {
  pipelineRun?: DeepAnalysisPipelineRunSummary | null
  degraded?: boolean
}

// High-level, card-ready read of where a video's deep analysis stands, derived
// from the raw poll. Kept deliberately small so the source-file card can drive
// a single spinner/failure indicator off it without re-deriving the rules.
export interface DeepAnalysisStatus {
  // The pipeline is running (or we can't yet tell, but a source file is ready
  // and nothing says it finished) — show a spinner.
  analysing: boolean
  // The latest run ended in failure and produced no complete result — prompt a
  // retry instead of a silent green check.
  failed: boolean
  // Full per-stage breakdown when the endpoint could compute it; null while
  // degraded/loading.
  progress: DeepAnalysisProgressResponse | null
}

const STAGE_LABELS: {
  key: keyof NonNullable<ProgressResponse["stages"]>
  label: string
}[] = [
  { key: "transcoding", label: "Transcoding video" },
  { key: "sceneCueScan", label: "Detecting scene changes" },
  { key: "snapshots", label: "Fetching snapshots" },
  { key: "snapshotAnalysis", label: "Analyzing visuals" },
  { key: "audio", label: "Fetching audio" },
  { key: "audioAnalysis", label: "Analyzing audio" },
  { key: "transcriptTaxonomy", label: "Reading window transcripts" },
  { key: "eventSynthesis", label: "Synthesizing retention events" },
]

// Polls /api/videos/:videoId/analysis-progress and folds the raw response into
// a small, card-ready status. Owns the single poll for the source-file card so
// both the high-level spinner and the detailed checklist read the same data
// without double-polling. Keeps polling while a run is in flight and while the
// endpoint is unreachable (it may recover), and stops once the run has settled
// or failed — the resting "Source file ready" row covers steady state. To
// restart it after a manual retry, remount the caller (via a `key`) rather than
// resetting state here.
export function useDeepAnalysisProgress(videoId: string): DeepAnalysisStatus {
  const [progress, setProgress] = useState<DeepAnalysisProgressResponse | null>(
    null,
  )
  const [unreachable, setUnreachable] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/videos/${videoId}/analysis-progress`)
        if (cancelled) return
        if (!res.ok) {
          setUnreachable(true)
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
          return
        }
        const data = (await res.json()) as DeepAnalysisProgressResponse
        if (cancelled) return
        setUnreachable(false)
        setProgress(data)
        // Stop once the run has genuinely settled, or failed outright — either
        // way there's no more live work to reflect. A degraded read is not
        // settled: we still can't see the stages, so keep watching for recovery.
        const done =
          (data.complete && !data.degraded) ||
          data.pipelineRun?.status === "failed"
        if (!done) {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
        }
      } catch {
        if (cancelled) return
        setUnreachable(true)
        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [videoId])

  const pipelineRun = progress?.pipelineRun ?? null
  const failed = pipelineRun?.status === "failed"

  // Analysing whenever a run is genuinely in flight, the endpoint gave a
  // degraded read, or we simply can't reach it yet — anything but a confirmed
  // settled state — and never while we're showing a failure to retry.
  const analysing =
    !failed &&
    (progress == null ||
      progress.degraded === true ||
      (progress.active && !progress.complete) ||
      unreachable ||
      pipelineRun?.status === "running")

  return { analysing, failed, progress }
}

// The per-stage checklist rendered under the source-file card while deep
// analysis runs. Presentational only — it reads the status the card already
// polled. Renders nothing unless there's a live, fully-detailed breakdown to
// show; the card's own spinner covers the degraded/loading case.
export function DeepAnalysisProgressList({
  progress,
}: {
  progress: DeepAnalysisProgressResponse | null
}) {
  if (
    !progress?.active ||
    !progress.stages ||
    progress.complete ||
    progress.degraded
  ) {
    return null
  }

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
