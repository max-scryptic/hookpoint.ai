import {
  costLogBreakdown,
  type CostLogBreakdownInput,
} from "@/lib/cost-log-breakdown"
import { COST_TYPE_LABELS, LLM_CALL_GROUP_LABELS } from "@/lib/llm-call-types"

// Enough precision for the sub-cent figures a single call is, without trailing
// noise for larger totals. Shared by both cost-log surfaces.
function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

// The summary line above a cost-log table: how many entries are listed on the
// left, and on the right the per-cost-type spend followed by the grand total.
// The LLM figure carries its analysis/comparison split in brackets, so an admin
// can see at a glance how much of the LLM bill is the analysis pipeline and how
// much is comparison reports without changing the filter. The per-type figures
// are muted so the total stands out as the headline number.
//
// Rendered by both the account-wide cost-log page (server-filtered) and the
// per-user/per-video panel (filtered in memory), so the two always read the
// same. Totals are summed from the rows passed in, which are the same rows the
// table lists — so the parts always add up to what is on screen.
export function CostLogSummary({
  rows,
  totalCostUsd,
  truncated = false,
}: {
  rows: CostLogBreakdownInput[]
  totalCostUsd: number
  truncated?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
      <span className="text-muted-foreground">
        {rows.length.toLocaleString()} entr{rows.length === 1 ? "y" : "ies"}
        {truncated ? " (showing the most recent 1,000)" : ""}
      </span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {costLogBreakdown(rows).map((entry) => (
          <span key={entry.type} className="text-muted-foreground">
            {COST_TYPE_LABELS[entry.type] ?? entry.type}:{" "}
            <span className="tabular-nums">{formatUsd(entry.total)}</span>
            {entry.groups.length > 0 ? (
              <>
                {" ("}
                {entry.groups.map((group, index) => (
                  <span key={group.group}>
                    {index > 0 ? " · " : ""}
                    {LLM_CALL_GROUP_LABELS[group.group]}{" "}
                    <span className="tabular-nums">
                      {formatUsd(group.total)}
                    </span>
                  </span>
                ))}
                {")"}
              </>
            ) : null}
          </span>
        ))}
        <span className="font-medium">
          Total cost:{" "}
          <span className="tabular-nums">{formatUsd(totalCostUsd)}</span>
        </span>
      </div>
    </div>
  )
}
