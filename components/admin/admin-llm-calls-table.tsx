"use client"

import { format } from "date-fns"
import Link from "next/link"

import { COST_TYPE_LABELS, LLM_CALL_TYPE_LABELS } from "@/lib/llm-call-types"
import type { CostLogRow } from "@/lib/admin/llm-calls"
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

// Formats a dollar cost with enough precision for the sub-cent figures a single
// call usually is, without trailing noise for larger totals.
function formatUsd(value: number): string {
  if (value === 0) return "$0"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

export function AdminLlmCallsTable({ rows }: { rows: CostLogRow[] }) {
  const { pageRows, currentPage, pageCount, setPageNumber } =
    usePagination(rows)

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No cost logs match these filters yet.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border bg-card dark:bg-transparent">
        <Table>
          <TableHeader>
            <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
              <TableHead className="text-accent-foreground">User</TableHead>
              <TableHead className="text-accent-foreground">Video</TableHead>
              <TableHead className="text-accent-foreground">Cost type</TableHead>
              <TableHead className="text-accent-foreground">
                Type of call
              </TableHead>
              <TableHead className="text-accent-foreground">Model</TableHead>
              <TableHead className="text-right text-accent-foreground">
                Tokens (in / out)
              </TableHead>
              <TableHead className="text-right text-accent-foreground">
                Cost
              </TableHead>
              <TableHead className="text-accent-foreground">
                Date &amp; time
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-[220px] truncate">
                {row.userEmail ? (
                  row.userId ? (
                    <Link
                      href={`/admin/users/${row.userId}`}
                      className="font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {row.userEmail}
                    </Link>
                  ) : (
                    row.userEmail
                  )
                ) : (
                  <span className="text-muted-foreground">Unknown user</span>
                )}
              </TableCell>
              <TableCell className="max-w-[220px] truncate">
                {row.analysedVideoId && row.userId ? (
                  <Link
                    href={`/admin/users/${row.userId}/videos/${row.analysedVideoId}`}
                    className="hover:underline focus-visible:underline focus-visible:outline-none"
                    title={row.videoTitle ?? undefined}
                  >
                    {row.videoTitle ?? "View video"}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>{COST_TYPE_LABELS[row.costType] ?? row.costType}</TableCell>
              <TableCell>
                {row.callType ? (
                  LLM_CALL_TYPE_LABELS[row.callType] ?? row.callType
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {row.model ?? "—"}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                {row.callType
                  ? `${row.inputTokens.toLocaleString()} / ${row.outputTokens.toLocaleString()}`
                  : "—"}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatUsd(row.costUsd)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {format(new Date(row.createdAt), "d MMM yyyy, HH:mm")}
              </TableCell>
            </TableRow>
          ))}
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
