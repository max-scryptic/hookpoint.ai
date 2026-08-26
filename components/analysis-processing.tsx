"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleCheckBigIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { AnalysisStageUpdate } from "@/lib/analysis-progress-stream"

// "analysing" shows the spinner + stage copy; "done" snaps the bar to 100%,
// swaps in a checkmark and the completion copy. The launcher flips to "done" the
// moment /api/analyze resolves so the user gets a beat of celebration (and
// confetti) before we navigate to the report. "error" replaces the spinner with
// a warning and a dismiss button when the analysis request fails.
export type AnalysisStatus = "analysing" | "done" | "error"

// Fallback copy for when we have no live stage from the server (the stream
// hasn't produced its first event yet, or a caller renders this popup without
// one). They loosely track the work /api/analyze does, in order.
const STAGES = [
  "Fetching your video details…",
  "Pulling audience retention from YouTube…",
  "Mapping where viewers drop off…",
  "Reading through the transcript…",
  "Analysing narrative pacing…",
  "Putting your report together…",
] as const

const STAGE_INTERVAL_MS = 2600

// Ceiling for the fallback (server-less) climb, well short of 100% so the page
// swap delivers the visual "complete".
const PROGRESS_CEILING = 92
const PROGRESS_INTERVAL_MS = 250
const INITIAL_PROGRESS = 4

// How aggressively the bar approaches the current stage's end. The eased
// fraction is 1 - e^(-DECAY × elapsed/estimated), so a stage that takes exactly
// as long as we estimated lands ~90% of the way through its slice, and one that
// runs long keeps inching forward instead of freezing - without ever spilling
// into the next stage's slice.
const STAGE_EASE_DECAY = 2.4

// Full-screen backdrop + centred popup. Shown from the Analyse a Video form the
// moment the user presses "Analyse Video" and kept up while the analysis runs,
// so the user waits on a clear "analysing your video" spinner rather than an
// empty page, and is taken to the report only once it's ready.
export function AnalysisProcessingOverlay({
  status = "analysing",
  stage = null,
  error = null,
  onDismiss,
}: {
  status?: AnalysisStatus
  stage?: AnalysisStageUpdate | null
  error?: string | null
  onDismiss?: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <AnalysisProcessing
        status={status}
        stage={stage}
        error={error}
        onDismiss={onDismiss}
      />
    </div>
  )
}

export function AnalysisProcessing({
  status = "analysing",
  stage = null,
  error = null,
  onDismiss,
}: {
  // The latest stage streamed by /api/analyze. Every event is a fresh object,
  // so re-entering the same stage (sub-progress within a fan-out) restarts the
  // animation from the new floor.
  stage?: AnalysisStageUpdate | null
  status?: AnalysisStatus
  error?: string | null
  onDismiss?: () => void
}) {
  const isDone = status === "done"
  const isError = status === "error"
  const [fallbackStage, setFallbackStage] = useState(0)
  const [progress, setProgress] = useState(INITIAL_PROGRESS)
  // Mirrors `progress` so the animation can read it without re-running its
  // effect on every tick.
  const progressRef = useRef(INITIAL_PROGRESS)

  // The bar only ever moves forward: a late-arriving event, or a stage whose
  // easing has already passed the incoming floor, must never rewind it.
  const advanceTo = useCallback((value: number) => {
    if (value <= progressRef.current) return
    progressRef.current = value
    setProgress(value)
  }, [])

  // Rotate the fallback wording when there's no live stage to show. Stops on the
  // final message so it sits there until the server says otherwise.
  useEffect(() => {
    if (stage || isDone || isError) return
    const id = setInterval(() => {
      setFallbackStage((current) => Math.min(current + 1, STAGES.length - 1))
    }, STAGE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [stage, isDone, isError])

  // Live mode: ease through the slice of the bar the current stage owns, paced
  // by how long that stage usually takes. The next stage event snaps us to its
  // start, so the bar advances because the server advanced.
  useEffect(() => {
    if (!stage || isDone || isError) return
    advanceTo(stage.start)
    const from = progressRef.current
    const startedAt = Date.now()
    const id = setInterval(() => {
      const ratio =
        stage.estimatedMs > 0 ? (Date.now() - startedAt) / stage.estimatedMs : 1
      const eased = 1 - Math.exp(-STAGE_EASE_DECAY * ratio)
      advanceTo(from + (stage.end - from) * eased)
    }, PROGRESS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [stage, isDone, isError, advanceTo])

  // Fallback mode: no stage events (yet), so decelerate toward a fixed ceiling.
  useEffect(() => {
    if (stage || isDone || isError) return
    const id = setInterval(() => {
      const current = progressRef.current
      if (current >= PROGRESS_CEILING) return
      advanceTo(current + Math.max(0.25, (PROGRESS_CEILING - current) * 0.04))
    }, PROGRESS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [stage, isDone, isError, advanceTo])

  // Snap the bar to 100% the instant the analysis lands, completing the climb.
  const displayProgress = isDone ? 100 : progress

  // The analysis request failed: swap the spinner for a warning and let the user
  // dismiss the popup to return to the Analyse a Video page and try again.
  if (isError) {
    return (
      <div
        role="alert"
        className="mx-4 flex w-full max-w-sm flex-col items-center gap-5 rounded-xl bg-card p-8 text-center shadow-lg ring-1 ring-foreground/10"
      >
        <div className="flex size-20 items-center justify-center">
          <TriangleAlertIcon className="size-10 text-destructive" />
        </div>
        <div className="space-y-1.5">
          <p className="font-heading text-base font-medium">
            We couldn&apos;t analyse that video
          </p>
          <p className="text-sm text-muted-foreground">
            {error ?? "Something went wrong. Please try again."}
          </p>
        </div>
        <Button variant="outline" onClick={onDismiss}>
          Close
        </Button>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-4 flex w-full max-w-sm flex-col items-center gap-5 rounded-xl bg-card p-8 text-center shadow-lg ring-1 ring-foreground/10"
    >
      {/* ────────────────────────────────────────────────────────────────
          SVG ANIMATION SLOT
          Drop the animated SVG in here (e.g. <Image src="/processing.svg" …/>
          or an inline component) to replace the fallback spinner below.
          Keep it within this fixed box so the popup doesn't jump.
          ──────────────────────────────────────────────────────────────── */}
      <div className="flex size-20 items-center justify-center">
        {isDone ? (
          <CircleCheckBigIcon className="size-12 text-emerald-600 dark:text-emerald-500" />
        ) : (
          <Loader2Icon className="size-10 animate-spin text-primary" />
        )}
      </div>

      <div className="space-y-1.5">
        <p className="font-heading text-base font-medium">
          {isDone ? "Analysis complete!" : "Analysing your video"}
        </p>
        <p className="min-h-[1.25rem] text-sm text-muted-foreground transition-opacity">
          {isDone
            ? "Taking you to your report…"
            : (stage?.label ?? STAGES[fallbackStage])}
        </p>
      </div>

      <div className="w-full space-y-1.5">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(displayProgress)}
          aria-label="Analysis progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${displayProgress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {isDone
            ? "All done. Opening your report."
            : "This can take a moment. You'll be taken to your report automatically."}
        </p>
      </div>
    </div>
  )
}
