import Link from "next/link"
import { HistoryIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { isSamePair, type SavedComparison } from "@/lib/video-comparisons"

// The Video Comparator's history: every head-to-head the creator has already
// generated (and paid for). Selecting one prefills the selectors and re-opens
// its report for free, so this doubles as the free re-entry point into any past
// comparison. Rendered below the selectors on every visit.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}

export function PreviousComparisons({
  comparisons,
  activePair,
}: {
  comparisons: SavedComparison[]
  activePair: { a: string; b: string } | null
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <HistoryIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Previous comparisons</h2>
      </div>

      {comparisons.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Comparisons you generate show up here so you can re-open them any time
          without spending more credits.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {comparisons.map((comparison) => {
            const pair = { a: comparison.videoAId, b: comparison.videoBId }
            const isActive =
              activePair != null && isSamePair(activePair, pair)
            return (
              <li key={comparison.id}>
                <Link
                  href={`/dashboard/video-comparator?a=${encodeURIComponent(
                    comparison.videoAId,
                  )}&b=${encodeURIComponent(comparison.videoBId)}`}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent",
                    isActive ? "border-primary bg-accent" : "bg-card",
                  )}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">
                      {comparison.videoATitle ?? "Untitled video"}
                    </span>
                    <span className="text-muted-foreground"> vs </span>
                    <span className="font-medium">
                      {comparison.videoBTitle ?? "Untitled video"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(comparison.createdAt)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
