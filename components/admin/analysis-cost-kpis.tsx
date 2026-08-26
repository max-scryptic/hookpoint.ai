import { CoinsIcon } from "lucide-react"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { AnalysisCostLine } from "@/lib/admin/analysis-cost-breakdown"

// Enough precision for the sub-cent figures a single video's calls cost,
// without trailing noise on larger totals - matches the deep-analysis evidence
// cost formatting so both tabs read the same.
function formatUsd(value: number): string {
  if (value <= 0) return "$0"
  if (value < 0.0001) return "<$0.0001"
  return `$${value.toFixed(4)}`
}

function formatTokens(value: number): string {
  return value.toLocaleString()
}

// The cost KPIs at the top of an analysis tab: a single row with a prominent
// "Total" tile on the left for the bucket's grand total, then the per-section
// breakdown (pacing, packaging, …) filling the rest of the row - each with its
// own spend, how many calls it took, and the tokens it moved. The total is
// tinted and pulled out to its own column so it reads apart from the component
// costs, giving an admin an at-a-glance read of what this slice cost and where
// the money went before they scroll into the evidence itself. On narrow
// viewports the breakdown wraps beneath the total.
export function AnalysisCostKpis({
  totalLabel,
  totalCostUsd,
  lines,
}: {
  totalLabel: string
  totalCostUsd: number
  lines: AnalysisCostLine[]
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      <Card
        size="sm"
        className="bg-primary/[0.07] ring-2 ring-primary/30 lg:w-60 lg:shrink-0 dark:bg-primary/10"
      >
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <CoinsIcon className="size-4" />
            {totalLabel}
          </CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {formatUsd(totalCostUsd)}
          </CardTitle>
        </CardHeader>
      </Card>

      <div className="flex flex-1 flex-wrap gap-3">
        {lines.map((line) => (
          <Card key={line.section} size="sm" className="min-w-40 flex-1 basis-40">
            <CardHeader>
              <CardDescription>{line.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatUsd(line.costUsd)}
              </CardTitle>
              <p className="text-xs text-muted-foreground tabular-nums">
                {line.callCount} call{line.callCount === 1 ? "" : "s"}
                {line.inputTokens + line.outputTokens > 0 ? (
                  <>
                    {" · "}
                    {formatTokens(line.inputTokens)} in /{" "}
                    {formatTokens(line.outputTokens)} out
                  </>
                ) : null}
              </p>
              {line.models.length > 0 ? (
                <p className="truncate text-xs text-muted-foreground">
                  {line.models.join(", ")}
                </p>
              ) : null}
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  )
}
