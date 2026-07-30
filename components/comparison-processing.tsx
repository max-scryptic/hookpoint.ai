"use client"

import { useEffect, useState } from "react"
import {
  ArrowRightIcon,
  CircleCheckBigIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"

// The full-screen popup the Video Comparator shows while a head-to-head is
// being written. Generating a comparison runs two model passes (both full
// transcripts for the script read, both thumbnails plus each opening for the
// packaging read), so it can take a while: the creator waits on this rather
// than on a button spinner, and only lands on the report once every part of it
// is finished and stored.
//
// "generating" shows the spinner plus the rotating stages; "done" snaps the bar
// to 100%, swaps in a checkmark and offers the button through to the finished
// report (the caller fires confetti at the same moment); "error" replaces the
// spinner with a warning and a dismiss button.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.
export type ComparisonStatus = "generating" | "done" | "error"

// The messages we cycle through while the comparison is generated. They loosely
// track the work the endpoint does (see app/api/video-comparisons/route.ts):
// retention curves, then the packaging head-to-head over both thumbnails and
// openings, then the script head-to-head over both transcripts. The wording is
// reassuring rather than a literal progress feed, since we cannot observe the
// server's exact stage from here.
const STAGES = [
  "Lining up both retention curves...",
  "Marking where each video loses viewers...",
  "Reading both thumbnails and titles...",
  "Comparing how each video opens...",
  "Working through both transcripts...",
  "Writing the script head-to-head...",
  "Putting your comparison report together...",
] as const

const STAGE_INTERVAL_MS = 6000

// The progress bar is simulated: the request duration is unknown, so we ease
// toward a ceiling well short of 100% and let the "done" state deliver the
// visual complete. Climbing then slowing avoids both a frozen bar and a bar
// that hits 100% and waits. A comparison is slower than a single analysis, so
// this creeps more gently than the analysis popup does.
const PROGRESS_CEILING = 94
const PROGRESS_INTERVAL_MS = 700

// Full-screen backdrop plus centred popup, shown from the Video Comparator the
// moment the creator presses "Generate report".
export function ComparisonProcessingOverlay({
  status = "generating",
  error = null,
  partial = false,
  opening = false,
  onDismiss,
  onOpenReport,
}: {
  status?: ComparisonStatus
  error?: string | null
  // True when the run finished but a section could not be written, so the done
  // state promises a little less than a clean run does. The report page fills a
  // missing section in when it opens.
  partial?: boolean
  // True once the creator has pressed through to the report and the navigation
  // is in flight, so the button reads as busy instead of looking unresponsive.
  opening?: boolean
  onDismiss?: () => void
  onOpenReport?: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <ComparisonProcessing
        status={status}
        error={error}
        partial={partial}
        opening={opening}
        onDismiss={onDismiss}
        onOpenReport={onOpenReport}
      />
    </div>
  )
}

export function ComparisonProcessing({
  status = "generating",
  error = null,
  partial = false,
  opening = false,
  onDismiss,
  onOpenReport,
}: {
  status?: ComparisonStatus
  error?: string | null
  partial?: boolean
  opening?: boolean
  onDismiss?: () => void
  onOpenReport?: () => void
}) {
  const isDone = status === "done"
  const isError = status === "error"
  const [stage, setStage] = useState(0)
  const [progress, setProgress] = useState(5)

  // Rotate the wording. We stop advancing once we reach the final message so it
  // sits on "Putting your comparison report together..." until the report
  // lands. Frozen once we are done: the completion copy takes over.
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
        return current + Math.max(0.3, (PROGRESS_CEILING - current) * 0.02)
      })
    }, PROGRESS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isDone, isError])

  // Snap the bar to 100% the instant the report lands, completing the climb.
  const displayProgress = isDone ? 100 : progress

  // Generation failed: swap the spinner for a warning and let the creator
  // dismiss the popup to return to the picker and try again.
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
            We couldn&apos;t generate that comparison
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
      <div className="flex size-20 items-center justify-center">
        {isDone ? (
          <CircleCheckBigIcon className="size-12 text-emerald-600 dark:text-emerald-500" />
        ) : (
          <Loader2Icon className="size-10 animate-spin text-primary" />
        )}
      </div>

      <div className="space-y-1.5">
        <p className="font-heading text-base font-medium">
          {isDone ? "Comparison report ready!" : "Building your comparison"}
        </p>
        <p className="min-h-[1.25rem] text-sm text-muted-foreground transition-opacity">
          {isDone
            ? partial
              ? "One section is still being written and will fill in when you open the report."
              : "Retention, packaging and script are all written up."
            : STAGES[stage]}
        </p>
      </div>

      <div className="w-full space-y-1.5">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(displayProgress)}
          aria-label="Comparison progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${displayProgress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {isDone
            ? "All done. Your report is saved, so you can re-open it any time."
            : "This takes a couple of minutes. Keep this tab open and we'll show you the report the moment it's ready."}
        </p>
      </div>

      {isDone && (
        <Button onClick={onOpenReport} disabled={opening}>
          {opening ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ArrowRightIcon className="size-4" />
          )}
          View comparison report
        </Button>
      )}
    </div>
  )
}
