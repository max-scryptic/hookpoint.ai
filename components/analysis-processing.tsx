"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2Icon } from "lucide-react"

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
  "Putting your report together…",
] as const

const STAGE_INTERVAL_MS = 2600

// The progress bar is simulated: the request duration is unknown, so we ease
// toward a ceiling well short of 100% and let the page swap (Next replaces this
// loading UI with the finished page) deliver the visual "complete". Climbing
// then slowing avoids both a frozen bar and a bar that hits 100% and waits.
const PROGRESS_CEILING = 92
const PROGRESS_INTERVAL_MS = 400

// Full-screen backdrop + centred popup. Used both as the route loading fallback
// (components/.../loading.tsx) and as an instant client-side overlay the moment
// the user presses "Analyse Video" (analyse-video-form.tsx), so the two hand off
// seamlessly — the user never sees a blank screen between press and report.
export function AnalysisProcessingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <AnalysisProcessing />
    </div>
  )
}

// The route's loading.tsx fallback renders for *every* navigation to the
// analysed-video page, including opening a video that's already analysed (a fast
// cache read). We only want the processing popup when a brand-new analysis is
// actually running, so the form tags fresh-analysis navigations with
// `?analysing=1` (see analyse-video-form.tsx) and we show the overlay only then.
// Without the marker the loading boundary stays a bare shell — no misleading
// "Analysing…" popup over a video that's already done.
function AnalysisProcessingGateInner() {
  const params = useSearchParams()
  if (params.get("analysing") !== "1") return null
  return <AnalysisProcessingOverlay />
}

export function AnalysisProcessingGate() {
  // useSearchParams must sit under a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <AnalysisProcessingGateInner />
    </Suspense>
  )
}

// Rendered on the finished analysed-video page to drop the `?analysing=1` marker
// from the URL once we've arrived. We use history.replaceState rather than
// router.replace so it just rewrites the address bar without kicking off another
// navigation (which would re-trigger the loading boundary). This keeps the URL
// clean and stops a later refresh/share from flashing the popup over a cached
// video.
export function StripAnalysingParam() {
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has("analysing")) {
      url.searchParams.delete("analysing")
      window.history.replaceState(null, "", url.pathname + url.search + url.hash)
    }
  }, [])
  return null
}

export function AnalysisProcessing() {
  const [stage, setStage] = useState(0)
  const [progress, setProgress] = useState(8)

  // Rotate the wording. We stop advancing once we reach the final message so it
  // sits on "Putting your report together…" until the page is ready.
  useEffect(() => {
    const id = setInterval(() => {
      setStage((current) => Math.min(current + 1, STAGES.length - 1))
    }, STAGE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // Advance the bar by a shrinking fraction of the remaining distance to the
  // ceiling, so it decelerates as it approaches and never quite arrives.
  useEffect(() => {
    const id = setInterval(() => {
      setProgress((current) => {
        if (current >= PROGRESS_CEILING) return current
        return current + Math.max(0.5, (PROGRESS_CEILING - current) * 0.08)
      })
    }, PROGRESS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

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
        <Loader2Icon className="size-10 animate-spin text-primary" />
      </div>

      <div className="space-y-1.5">
        <p className="font-heading text-base font-medium">
          Analysing your video
        </p>
        <p className="min-h-[1.25rem] text-sm text-muted-foreground transition-opacity">
          {STAGES[stage]}
        </p>
      </div>

      <div className="w-full space-y-1.5">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label="Analysis progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          This can take a moment — you&apos;ll be taken to your report
          automatically.
        </p>
      </div>
    </div>
  )
}
