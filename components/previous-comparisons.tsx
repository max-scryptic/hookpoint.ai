"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import { HistoryIcon, PlayIcon } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { SavedComparison } from "@/lib/video-comparisons"

// The Video Comparator's history: every head-to-head the creator has already
// generated (and paid for), laid out as a table that mirrors the analysed-video
// list. Each row shows both videos (thumbnail and title) and when they were
// compared; clicking the row re-opens that report for free, so this doubles as
// the free re-entry point into any past comparison.
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

// A compact thumbnail-plus-title cell for one side of a comparison. Not a link
// (the whole row is clickable), so it never nests an anchor inside the row.
function VideoCell({
  title,
  thumbnailUrl,
}: {
  title: string | null
  thumbnailUrl: string | null
}) {
  const label = title ?? "Untitled video"
  return (
    <div className="flex items-center gap-3">
      <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-muted sm:w-28">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt=""
            fill
            sizes="112px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <PlayIcon className="size-5" />
          </div>
        )}
      </div>
      <p className="line-clamp-2 min-w-0 text-sm font-medium">{label}</p>
    </div>
  )
}

export function PreviousComparisons({
  comparisons,
}: {
  comparisons: SavedComparison[]
}) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-3">
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
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="text-left">
            <TableHeader>
              <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
                <TableHead className="px-4 py-3 text-accent-foreground">
                  Video 1
                </TableHead>
                <TableHead className="px-4 py-3 text-accent-foreground">
                  Video 2
                </TableHead>
                <TableHead className="hidden px-4 py-3 text-right text-accent-foreground sm:table-cell">
                  Compared on
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisons.map((comparison) => {
                const href = `/dashboard/video-comparator/report?a=${encodeURIComponent(
                  comparison.videoAId,
                )}&b=${encodeURIComponent(comparison.videoBId)}`
                const aTitle = comparison.videoATitle ?? "Untitled video"
                const bTitle = comparison.videoBTitle ?? "Untitled video"
                return (
                  <TableRow
                    key={comparison.id}
                    className="cursor-pointer align-top hover:bg-muted/40"
                    onClick={() => router.push(href)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        router.push(href)
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open comparison report for ${aTitle} vs ${bTitle}`}
                  >
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <VideoCell
                        title={comparison.videoATitle}
                        thumbnailUrl={comparison.videoAThumbnailUrl}
                      />
                    </TableCell>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <VideoCell
                        title={comparison.videoBTitle}
                        thumbnailUrl={comparison.videoBThumbnailUrl}
                      />
                    </TableCell>
                    <TableCell className="hidden px-4 py-3 text-right align-middle text-sm text-muted-foreground sm:table-cell">
                      {formatDate(comparison.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
