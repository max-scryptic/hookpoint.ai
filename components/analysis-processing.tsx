"use client"

import { useEffect, useState } from "react"
import { CircleCheckBigIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

// "analysing" shows the spinner + rotating stages; "done" snaps the bar to 100%,
// swaps in a checkmark and the completion copy. The launcher flips to "done" the
// moment /api/analyze resolves so the user gets a beat of celebration (and
// confetti) before we navigate to the report. "error" replaces the spinner with
// a warning and a dismiss button when the analysis request fails.
export type AnalysisStatus = "analysing" | "done" | "error"

// The messages we cycle through while the analysis server render is in flight.
// They loosely track the work the page does (see app/api/analyze/route.ts and
// the analysed-video page): fetch details → retention → drop-offs → transcript.
// The wording is reassuring rather than a literal progress feed, since we can't
// observe the server's exact stage from here.
const STAGES = [
  "Fetching your video details…",
  "Pulling audience retention from YouTube…",
  "Mapping where viewers drop off…",
  "Reading through the transcript…",
  "Analysing narrative pacing…",
  "Putting your report together…",
] as const

const STAGE_INTERVAL_MS = 2600

// The progress bar is simulated: the request duration is unknown, so we ease
// toward a ceiling well short of 100% and let the page swap (Next replaces this
// loading UI with the finished page) deliver the visual "complete". Climbing
// then slowing avoids both a frozen bar and a bar that hits 100% and waits.
const PROGRESS_CEILING = 92
const PROGRESS_INTERVAL_MS = 400

// Full-screen backdrop + centred popup. Shown from the Analyse Video form the
// moment the user presses "Analyse Video" and kept up while the analysis runs,
// so the user waits on a clear "analysing your video" spinner rather than an
// empty page, and is taken to the report only once it's ready.
export function AnalysisProcessingOverlay({
  status = "analysing",
  error = null,
  onDismiss,
}: {
  status?: AnalysisStatus
  error?: string | null
  onDismiss?: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <AnalysisProcessing status={status} error={error} onDismiss={onDismiss} />
    </div>
  )
}

export function AnalysisProcessing({
  status = "analysing",
  error = null,
  onDismiss,
}: {
  status?: AnalysisStatus
  error?: string | null
  onDismiss?: () => void
}) {
  const isDone = status === "done"
  const isError = status === "error"
  const [stage, setStage] = useState(0)
  const [progress, setProgress] = useState(8)

  // Rotate the wording. We stop advancing once we reach the final message so it
  // sits on "Putting your report together…" until the page is ready. Frozen once
  // we're done — the completion copy takes over.
  useEffect(() => {
    if (isDone || isError) return
    const id = setInterval(() => {
      setStage((current) => Math.min(current + 1, STAGES.length - 1))
    }, STAGE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isDone, isError])

  // Advance the bar by a shrinking fraction of the remaining distance to the
  // ceiling, so it decelerates as it approaches and never quite arrives.
  useEffect(() => {
    if (isDone || isError) return
    const id = setInterval(() => {
      setProgress((current) => {
        if (current >= PROGRESS_CEILING) return current
        return current + Math.max(0.5, (PROGRESS_CEILING - current) * 0.08)
      })
    }, PROGRESS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isDone, isError])

  // Snap the bar to 100% the instant the analysis lands, completing the climb.
  const displayProgress = isDone ? 100 : progress

  // The analysis request failed: swap the spinner for a warning and let the user
  // dismiss the popup to return to the Analyse Video page and try again.
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
          {isDone ? "Taking you to your report…" : STAGES[stage]}
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
            ? "All done — opening your report."
            : "This can take a moment — you'll be taken to your report automatically."}
        </p>
      </div>
    </div>
  )
}
