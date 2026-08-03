"use client"

import { format } from "date-fns"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PlayIcon } from "lucide-react"

import type {
  AdminComparisonVideo,
  AdminVideoComparison,
} from "@/lib/admin/video-comparisons"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  TablePagination,
  usePagination,
} from "@/components/ui/table-pagination"
import { cn } from "@/lib/utils"

// The admin user-detail "Video comparisons" listing: every head-to-head this
// user has generated in the Video Comparator, newest first. Mirrors the
// analysed-videos table beside it (card surface, accent header, clickable rows)
// and the creator's own comparison history (thumbnail plus title per side), so
// the two read as one system. Every row opens the comparison's admin report
// page: the same retention, packaging and script read the creator sees,
// read-only.
//
// Comparison spend is deliberately not a column here: the two written
// head-to-heads are logged against the account rather than a video or a
// comparison row, so no per-pair figure exists to show. The account-wide total
// is in the Cost logs tab, filtered to the two comparison call types.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// A compact thumbnail-plus-title cell for one side of a comparison. Not a link
// (the whole row is clickable), so it never nests an anchor inside the row.
function VideoCell({ video }: { video: AdminComparisonVideo }) {
  return (
    <div className="flex items-start gap-3">
      <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-muted sm:w-28">
        {video.thumbnailUrl ? (
          <Image
            src={video.thumbnailUrl}
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
      <p className="line-clamp-2 min-w-0 text-sm font-medium">
        {video.title ?? "Untitled video"}
      </p>
    </div>
  )
}

// Whether each written head-to-head made it onto the row, at the shape the
// report renders. A missing one is the signal an admin is looking for here: the
// pair either predates that report or its generation failed, and re-opening the
// pair in the Video Comparator writes it for free.
function ReportStatus({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        ready
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-500",
      )}
    >
      {label}
      {ready ? "" : " missing"}
    </span>
  )
}

export function AdminVideoComparisonsTable({
  userId,
  comparisons,
}: {
  userId: string
  comparisons: AdminVideoComparison[]
}) {
  const router = useRouter()
  const { pageRows, currentPage, pageCount, setPageNumber } =
    usePagination(comparisons)

  if (comparisons.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This user hasn&rsquo;t compared any videos yet.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table className="text-left">
          <TableHeader>
            <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
              <TableHead className="px-4 py-3 text-accent-foreground">
                Video A
              </TableHead>
              <TableHead className="px-4 py-3 text-accent-foreground">
                Video B
              </TableHead>
              <TableHead className="px-4 py-3 text-accent-foreground">
                Compared
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-accent-foreground sm:table-cell">
                Reports
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((comparison) => {
              const href = `/admin/users/${userId}/comparisons/${comparison.id}`
              const aTitle = comparison.a.title ?? "Untitled video"
              const bTitle = comparison.b.title ?? "Untitled video"
              return (
                <TableRow
                  key={comparison.id}
                  onClick={() => router.push(href)}
                  className="cursor-pointer align-top hover:bg-muted/40"
                >
                  <TableCell className="max-w-[280px] px-4 py-3 whitespace-normal">
                    {/* A real anchor keeps the row keyboard-focusable and
                        supports middle/cmd-click; the row's onClick handles
                        clicks elsewhere. Both land on the report page. */}
                    <Link
                      href={href}
                      aria-label={`Open comparison report for ${aTitle} vs ${bTitle}`}
                      className="block focus-visible:underline focus-visible:outline-none"
                    >
                      <VideoCell video={comparison.a} />
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[280px] px-4 py-3 whitespace-normal">
                    <VideoCell video={comparison.b} />
                  </TableCell>
                  <TableCell className="px-4 py-3 align-middle text-sm text-muted-foreground">
                    {format(new Date(comparison.createdAt), "d MMM yyyy, HH:mm")}
                  </TableCell>
                  <TableCell className="hidden px-4 py-3 align-middle sm:table-cell">
                    <div className="flex flex-wrap gap-1.5">
                      <ReportStatus
                        ready={comparison.scriptReportReady}
                        label="Script"
                      />
                      <ReportStatus
                        ready={comparison.packagingReportReady}
                        label="Packaging"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <TablePagination
        currentPage={currentPage}
        pageCount={pageCount}
        onPageChange={setPageNumber}
      />
    </div>
  )
}
