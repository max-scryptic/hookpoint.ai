"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeftRightIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { VIDEO_COMPARISON_CREDIT_COST } from "@/lib/plans"
import type { ComparableVideo } from "@/lib/retention-comparison"
import { isSamePair } from "@/lib/video-comparisons"

// The Video Comparator's video selectors and report trigger. Both selects start
// empty, and picking a pair does not load anything on its own: a comparison
// costs deep-dive credits, so the report is only generated when the creator
// presses the button. A pair that was already generated (in either order)
// re-opens for free, and the button says so.
//
// Selecting a pair is local state here; generating (or re-opening) a report is a
// navigation to the dedicated report page at
// video-comparator/report?a=..&b=.. so the report renders on its own page and
// the URL stays shareable.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

function optionLabel(video: ComparableVideo): string {
  const title = video.title ?? "Untitled video"
  return video.averageViewPercentage != null
    ? `${title} (${Math.round(video.averageViewPercentage)}% avg watched)`
    : title
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bothPicked = a !== "" && b !== "" && a !== b
  const alreadyGenerated =
    bothPicked && savedPairs.some((pair) => isSamePair(pair, { a, b }))

  const open = (nextA: string, nextB: string) => {
    router.push(
      `/dashboard/video-comparator/report?a=${encodeURIComponent(nextA)}&b=${encodeURIComponent(nextB)}`,
    )
    router.refresh()
  }

  const generate = async () => {
    if (!bothPicked) return
    // A pair already paid for just re-opens; no round-trip needed.
    if (alreadyGenerated) {
      open(a, b)
      return
    }

    setPending(true)
    setError(null)
    try {
      const response = await fetch("/api/video-comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoAId: a, videoBId: b }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      if (!response.ok) {
        setError(payload?.error ?? "We couldn't generate that comparison.")
        return
      }
      open(a, b)
    } catch {
      setError("We couldn't reach the server. Please try again.")
    } finally {
      setPending(false)
    }
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
          className="mx-auto flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
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
          disabled={!bothPicked || pending}
          className="shrink-0 sm:w-auto"
        >
          {pending && <Loader2Icon className="size-4 animate-spin" />}
          {alreadyGenerated ? "View report" : "Generate report"}
        </Button>
      </div>

      {(!alreadyGenerated || error) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {!alreadyGenerated && (
            <p className="text-xs text-muted-foreground">
              A comparison costs {VIDEO_COMPARISON_CREDIT_COST} deep-dive
              credits.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
