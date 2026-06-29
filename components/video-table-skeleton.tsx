import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Placeholder for the video tables (Analyse Video + Analysed Videos) shown while
// the list data loads. It mirrors the real filter bar + table layout so a route's
// loading.tsx can render the page's static chrome immediately and leave only this
// region as a skeleton — when the data lands the populated table drops straight in
// with no layout shift. The column set matches both tables; the slightly different
// header labels between them don't matter at skeleton size.
export function VideoTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 min-w-[12rem] flex-1" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-36" />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table className="text-left">
          <TableHeader>
            <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
              <TableHead className="px-4 py-3 text-accent-foreground">
                Video
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-accent-foreground md:table-cell">
                Visibility
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-accent-foreground lg:table-cell">
                Published
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-right text-accent-foreground sm:table-cell">
                Views
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-right text-accent-foreground lg:table-cell">
                Comments
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-accent-foreground sm:table-cell">
                Analysed
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, index) => (
              <TableRow key={index} className="align-top">
                <TableCell className="px-4 py-3">
                  <div className="flex gap-3 sm:gap-4">
                    <Skeleton className="aspect-video w-32 shrink-0 rounded-lg sm:w-40" />
                    <div className="min-w-0 flex-1 space-y-2 py-0.5">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden px-4 py-3 md:table-cell">
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell className="hidden px-4 py-3 lg:table-cell">
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell className="hidden px-4 py-3 sm:table-cell">
                  <Skeleton className="ml-auto h-4 w-12" />
                </TableCell>
                <TableCell className="hidden px-4 py-3 lg:table-cell">
                  <Skeleton className="ml-auto h-4 w-10" />
                </TableCell>
                <TableCell className="hidden px-4 py-3 sm:table-cell">
                  <Skeleton className="h-4 w-16" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
