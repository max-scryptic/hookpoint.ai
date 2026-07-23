import { CoinsIcon } from "lucide-react"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { AnalysisCostLine } from "@/lib/admin/analysis-cost-breakdown"

// Enough precision for the sub-cent figures a single video's calls cost,
// without trailing noise on larger totals — matches the deep-analysis evidence
// cost formatting so both tabs read the same.
function formatUsd(value: number): string {
  if (value <= 0) return "$0"
  if (value < 0.0001) return "<$0.0001"
  return `$${value.toFixed(4)}`
}

function formatTokens(value: number): string {
  return value.toLocaleString()
}

// The cost KPIs at the top of an analysis tab: a prominent "Total" tile for the
// bucket's grand total, then one tile per section (pacing, packaging, …) with
// its own spend, how many calls it took, and the tokens it moved. Gives an
// admin an at-a-glance read of what this slice of the analysis cost and where
// the money went before they scroll into the evidence itself.
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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card size="sm" className="ring-foreground/20">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <CoinsIcon className="size-4" />
            {totalLabel}
          </CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {formatUsd(totalCostUsd)}
          </CardTitle>
        </CardHeader>
      </Card>

      {lines.map((line) => (
        <Card key={line.section} size="sm">
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
  )
}
