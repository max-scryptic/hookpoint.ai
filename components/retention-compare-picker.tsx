"use client"

import { useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeftRightIcon } from "lucide-react"

import { ComparisonProcessingOverlay } from "@/components/comparison-processing"
import { ConfettiBurst } from "@/components/confetti-burst"
import { Button } from "@/components/ui/button"
import { useNavigationGuard } from "@/hooks/use-navigation-guard"
import { VIDEO_COMPARISON_CREDIT_COST } from "@/lib/plans"
import type { ComparableVideo } from "@/lib/retention-comparison"
import { isSamePair } from "@/lib/video-comparisons"

// The Video Comparator's video selectors and report trigger. Both selects start
// empty, and picking a pair does not load anything on its own: a comparison
// costs deep-dive credits, so the report is only generated when the creator
// presses the button. A pair that was already generated (in either order)
// re-opens for free, and the button says so.
//
// Generating never navigates early. Writing a head-to-head runs two model
// passes (see app/api/video-comparisons/route.ts), so pressing "Generate
// report" raises the full-screen popup and holds it for the whole run, the same
// way analysing a video does. Only once the endpoint has finished and stored
// every part of the report does the popup flip to its done state: confetti,
// then a button through to the finished report. That way the creator never
// lands on a report page that is still writing itself.
//
// Selecting a pair is local state here; opening a finished report (or
// re-opening a paid-for one) is a navigation to the dedicated report page at
// video-comparator/report?a=..&b=.. so the report renders on its own page and
// the URL stays shareable.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

type Phase = "idle" | "generating" | "done" | "error"

const LEAVE_WARNING =
  "Your comparison report is still being generated. Leaving now will stop it, and the credits you just spent will be used up."

function optionLabel(video: ComparableVideo): string {
  const title = video.title ?? "Untitled video"
  return video.averageViewPercentage != null
    ? `${title} (${Math.round(video.averageViewPercentage)}% avg watched)`
    : title
}

function reportHref(a: string, b: string): string {
  return `/dashboard/video-comparator/report?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
}

export function RetentionComparePicker({
  videos,
  savedPairs,
}: {
  videos: ComparableVideo[]
  // The unordered pairs the creator has already generated, so the button can
  // offer a free re-open instead of another charge.
  savedPairs: Array<{ a: string; b: string }>
}) {
  const router = useRouter()
  const [a, setA] = useState("")
  const [b, setB] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True when the run finished but a section could not be written, so the done
  // state promises a little less than a clean run does.
  const [partial, setPartial] = useState(false)
  // Guards against re-entrant generates (for example a double click) without
  // waiting on the async state updates.
  const activeRef = useRef(false)

  const bothPicked = a !== "" && b !== "" && a !== b
  const alreadyGenerated =
    bothPicked && savedPairs.some((pair) => isSamePair(pair, { a, b }))
  const busy = phase === "generating" || phase === "done"

  // A reload or a tab close mid-generation abandons a run that has already been
  // charged for, so warn before the page goes away. Only while the work is
  // actually in flight: once the report is written there is nothing to lose.
  useNavigationGuard(phase === "generating", LEAVE_WARNING)

  const open = useCallback(
    (nextA: string, nextB: string) => {
      router.push(reportHref(nextA, nextB))
      router.refresh()
    },
    [router],
  )

  const generate = async () => {
    if (!bothPicked || activeRef.current) return
    // A pair already paid for has its report stored, so it just re-opens; no
    // generation and no round-trip needed.
    if (alreadyGenerated) {
      open(a, b)
      return
    }

    activeRef.current = true
    setError(null)
    setPhase("generating")
    try {
      const response = await fetch("/api/video-comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoAId: a, videoBId: b }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        reportsReady?: boolean
      } | null
      if (!response.ok) {
        setError(payload?.error ?? "We couldn't generate that comparison.")
        setPhase("error")
        activeRef.current = false
        return
      }
      // The endpoint only resolves once both head-to-heads have been written
      // and stored, so by here the report is finished. reportsReady is false
      // only when a section could not be written at all, in which case the
      // report page fills it in on open and the popup says so. Warm the route
      // while the creator reads the done state so pressing through is instant.
      setPartial(payload?.reportsReady === false)
      router.prefetch(reportHref(a, b))
      setPhase("done")
    } catch {
      setError("We couldn't reach the server. Please try again.")
      setPhase("error")
      activeRef.current = false
    }
  }

  const dismiss = () => {
    setPhase("idle")
    setError(null)
    setPartial(false)
    activeRef.current = false
  }

  // The popup stays up through the navigation (it only unmounts when this page
  // does), so the creator never sees a flash of the picker on the way out.
  const openReport = () => {
    setOpening(true)
    open(a, b)
  }

  const selectClass =
    "h-9 w-full min-w-0 rounded-md border bg-card px-2 text-sm"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <select
          aria-label="First video"
          className={selectClass}
          value={a}
          disabled={busy}
          onChange={(event) => setA(event.target.value)}
        >
          <option value="">Select a video</option>
          {videos.map((video) => (
            <option key={video.id} value={video.id} disabled={video.id === b}>
              {optionLabel(video)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Swap the two videos"
          disabled={busy}
          className="mx-auto flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-foreground disabled:opacity-50"
          onClick={() => {
            setA(b)
            setB(a)
          }}
        >
          <ArrowLeftRightIcon className="size-4" />
        </button>
        <select
          aria-label="Second video"
          className={selectClass}
          value={b}
          disabled={busy}
          onChange={(event) => setB(event.target.value)}
        >
          <option value="">Select a video</option>
          {videos.map((video) => (
            <option key={video.id} value={video.id} disabled={video.id === a}>
              {optionLabel(video)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          onClick={generate}
          disabled={!bothPicked || busy}
          className="shrink-0 sm:w-auto"
        >
          {alreadyGenerated ? "View report" : "Generate report"}
        </Button>
      </div>

      {!alreadyGenerated && (
        <p className="text-xs text-muted-foreground">
          A comparison costs {VIDEO_COMPARISON_CREDIT_COST} deep-dive credits,
          and takes a couple of minutes to write.
        </p>
      )}

      {phase !== "idle" && (
        <ComparisonProcessingOverlay
          status={
            phase === "done"
              ? "done"
              : phase === "error"
                ? "error"
                : "generating"
          }
          error={error}
          partial={partial}
          opening={opening}
          onDismiss={dismiss}
          onOpenReport={openReport}
        />
      )}
      {phase === "done" && <ConfettiBurst />}
    </div>
  )
}
