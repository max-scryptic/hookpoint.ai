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
// product surfaces read as one system. Each deeply-analysed row opens the
// video's deep-analysis detail page; the external icon still opens the source
// video on YouTube in a new tab, and the per-video light/deep spend rolls up
// alongside the events.
//
// A video counts as "deeply analysed" once its raw source file has been
// uploaded — the same signal the front-end browser uses to distinguish a
// deeply-analysed video from one that's only been retention-scanned, and the
// prerequisite for the deep-analysis pipeline that fills the detail page.
// Rows that haven't cleared that bar aren't linked or clickable: their detail
// page would only show the "no deep-analysis evidence yet" empty state, so
// there's nothing to route to.
export function AdminVideoAnalysesTable({
  userId,
  videos,
}: {
  userId: string
  videos: AdminVideoAnalysis[]
}) {
  const router = useRouter()

  if (videos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This user hasn&rsquo;t analysed any videos yet.
      </p>
    )
  }

  return (
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
          {videos.map((video) => {
            // Only deeply-analysed videos (raw source file uploaded) route to a
            // detail page worth opening; the rest render as an inert row.
            const deeplyAnalysed = video.rawFileUploadedAt != null
            const href = deeplyAnalysed
              ? `/admin/users/${userId}/videos/${video.id}`
              : null
            return (
              <TableRow
                key={video.id}
                onClick={href ? () => router.push(href) : undefined}
                className={
                  href
                    ? "cursor-pointer hover:bg-muted/40"
                    : undefined
                }
              >
                <TableCell className="max-w-[360px] px-4 py-3">
                  <div className="flex items-center gap-2">
                    {/* A real anchor keeps the row keyboard-focusable and
                        supports middle/cmd-click; the row's onClick handles
                        clicks elsewhere. Both land on the deep-analysis detail
                        page. Videos that haven't been deeply analysed have no
                        detail page to open, so their title is plain text. */}
                    {href ? (
                      <Link
                        href={href}
                        className="min-w-0 font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        <span className="block truncate">{video.title}</span>
                      </Link>
                    ) : (
                      <span
                        className="block min-w-0 truncate font-medium"
                        title="Deep analysis hasn't run for this video yet"
                      >
                        {video.title}
                      </span>
                    )}
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
  )
}
