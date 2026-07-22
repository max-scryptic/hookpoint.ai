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

// Formats a dollar cost with enough precision for the sub-cent figures a single
// call usually is, without trailing noise for larger totals.
function formatUsd(value: number): string {
  if (value === 0) return "$0"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

export function AdminLlmCallsTable({ rows }: { rows: CostLogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No cost logs match these filters yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card dark:bg-transparent">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Video</TableHead>
            <TableHead>Cost type</TableHead>
            <TableHead>Type of call</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Tokens (in / out)</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead>Date &amp; time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
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
  )
}
