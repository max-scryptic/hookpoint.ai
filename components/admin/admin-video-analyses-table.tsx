"use client"

import { format } from "date-fns"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ExternalLinkIcon } from "lucide-react"

import type { AdminVideoAnalysis } from "@/lib/admin/video-analysis"
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

// Enough precision for the sub-cent figures a single video can cost, without
// trailing noise on larger totals. Matches the cost-log table's formatting.
function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

// A right-aligned currency cell that mutes an em-dash when nothing has been
// spent in that bucket, so real costs stay scannable against the empty rows.
function CostCell({ value }: { value: number }) {
  return (
    <TableCell className="hidden px-4 py-3 text-right text-sm tabular-nums sm:table-cell">
      {value > 0 ? (
        formatUsd(value)
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </TableCell>
  )
}

// A timestamp cell that mutes an em-dash when the date is absent (e.g. a video
// whose raw source file hasn't been uploaded yet), matching how empty cost and
// event cells read.
function DateCell({ value }: { value: string | null }) {
  return (
    <TableCell className="px-4 py-3 text-sm text-muted-foreground">
      {value ? (
        format(new Date(value), "d MMM yyyy, HH:mm")
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </TableCell>
  )
}

// The admin user-detail "Analysed videos" listing. Adopts the shared front-end
// table baseline (card surface, accent header, clickable rows) so admin and
// product surfaces read as one system. Every row opens the video's analysis
// detail page — its Light Analysis / Deep Analysis oversight tabs — since even
// a video that's only had the initial light analysis has evidence worth
// inspecting there. The external icon still opens the source video on YouTube
// in a new tab, and the per-video light/deep spend rolls up alongside the
// events. The "Raw file uploaded" column stays as the signal for whether the
// deep-analysis pipeline could have run.
export function AdminVideoAnalysesTable({
  userId,
  videos,
}: {
  userId: string
  videos: AdminVideoAnalysis[]
}) {
  const router = useRouter()
  const { pageRows, currentPage, pageCount, setPageNumber } =
    usePagination(videos)

  if (videos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This user hasn&rsquo;t analysed any videos yet.
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
                Video
              </TableHead>
              <TableHead className="px-4 py-3 text-accent-foreground">
                Analysed
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-right text-accent-foreground sm:table-cell">
                Light analysis
              </TableHead>
              <TableHead className="px-4 py-3 text-accent-foreground">
                Raw file uploaded
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-right text-accent-foreground sm:table-cell">
                Deep analysis
              </TableHead>
              <TableHead className="px-4 py-3 text-right text-accent-foreground">
                Events generated
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((video) => {
            // Every analysed video has an oversight detail page (at minimum its
            // light-analysis evidence), so every row routes there.
            const href = `/admin/users/${userId}/videos/${video.id}`
            return (
              <TableRow
                key={video.id}
                onClick={() => router.push(href)}
                className="cursor-pointer hover:bg-muted/40"
              >
                <TableCell className="max-w-[360px] px-4 py-3">
                  <div className="flex items-center gap-2">
                    {/* A real anchor keeps the row keyboard-focusable and
                        supports middle/cmd-click; the row's onClick handles
                        clicks elsewhere. Both land on the analysis detail
                        page. */}
                    <Link
                      href={href}
                      className="min-w-0 font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      <span className="block truncate">{video.title}</span>
                    </Link>
                    {/* Opens the source video on YouTube in a new tab. Stops
                        propagation so it doesn't also trigger the row's
                        navigation to the detail page. */}
                    <a
                      href={`https://www.youtube.com/watch?v=${video.videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open on YouTube"
                      onClick={(event) => event.stopPropagation()}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                  </div>
                </TableCell>
                <DateCell value={video.dateAnalysed} />
                <CostCell value={video.lightCostUsd} />
                <DateCell value={video.rawFileUploadedAt} />
                <CostCell value={video.deepCostUsd} />
                <TableCell className="px-4 py-3 text-right tabular-nums">
                  {video.eventCount > 0 ? (
                    video.eventCount.toLocaleString()
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
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
