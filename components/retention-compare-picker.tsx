"use client"

import { useRouter } from "next/navigation"
import { ArrowLeftRightIcon } from "lucide-react"

import type { ComparableVideo } from "@/lib/retention-comparison"

// The Video Comparator's video selectors: two native selects that rewrite the
// page's query string, so the chosen pair is shareable and the server
// component reloads the comparison. Kept deliberately plain - the page is
// server-rendered and this is its only interactive control.
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
  selectedA,
  selectedB,
}: {
  videos: ComparableVideo[]
  selectedA: string
  selectedB: string
}) {
  const router = useRouter()

  const navigate = (a: string, b: string) => {
    router.push(
      `/dashboard/video-comparator?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    )
  }

  const selectClass =
    "h-9 w-full min-w-0 rounded-md border bg-card px-2 text-sm"

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <select
        aria-label="First video"
        className={selectClass}
        value={selectedA}
        onChange={(event) => navigate(event.target.value, selectedB)}
      >
        {videos.map((video) => (
          <option
            key={video.id}
            value={video.id}
            disabled={video.id === selectedB}
          >
            {optionLabel(video)}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Swap the two videos"
        className="mx-auto flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
        onClick={() => navigate(selectedB, selectedA)}
      >
        <ArrowLeftRightIcon className="size-4" />
      </button>
      <select
        aria-label="Second video"
        className={selectClass}
        value={selectedB}
        onChange={(event) => navigate(selectedA, event.target.value)}
      >
        {videos.map((video) => (
          <option
            key={video.id}
            value={video.id}
            disabled={video.id === selectedA}
          >
            {optionLabel(video)}
          </option>
        ))}
      </select>
    </div>
  )
}
