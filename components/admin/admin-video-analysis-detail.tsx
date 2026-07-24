"use client"

import { AnalysisCostKpis } from "@/components/admin/analysis-cost-kpis"
import { AdminCostLogsPanel } from "@/components/admin/admin-cost-logs-panel"
import { LightAnalysisEvidenceView } from "@/components/admin/light-analysis-evidence"
import { DeepAnalysisEvidence } from "@/components/deep-analysis-evidence"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import type { AnalysisCostBreakdown } from "@/lib/admin/analysis-cost-breakdown"
import type { CostLogRow } from "@/lib/admin/llm-calls"
import type { LightAnalysisEvidence } from "@/lib/admin/light-analysis-evidence"
import type { DeepAnalysisEvidence as DeepAnalysisEvidenceData } from "@/lib/deep-analysis-evidence"

// The admin video-analysis oversight view: a Light Analysis / Deep Analysis
// tab split. Each tab leads with the cost KPIs for that bucket (its total plus
// a per-section breakdown from the append-only cost_logs) and then the full
// evidence captured for that half of the pipeline — every read for light, the
// per-window signals for deep — so an admin has complete oversight of what was
// generated and what it cost. All data is loaded server-side (behind the admin
// auth check) and passed in; this component is purely presentational.
export function AdminVideoAnalysisDetail({
  videoId,
  costs,
  lightEvidence,
  deepEvidence,
  costLogRows,
  costLogsTruncated = false,
}: {
  videoId: string
  costs: AnalysisCostBreakdown
  lightEvidence: LightAnalysisEvidence
  deepEvidence: DeepAnalysisEvidenceData | null
  costLogRows: CostLogRow[]
  costLogsTruncated?: boolean
}) {
  const lightLines = costs.lines.filter((line) => line.bucket === "light")
  const deepLines = costs.lines.filter((line) => line.bucket === "deep")
  const hasDeepWindows = Boolean(
    deepEvidence && deepEvidence.windows.length > 0,
  )

  return (
    <Tabs defaultValue="light" className="gap-4">
      <TabsList>
        <TabsTrigger value="light">Light Analysis</TabsTrigger>
        <TabsTrigger value="deep">Deep Analysis</TabsTrigger>
        <TabsTrigger value="cost-logs">Cost logs</TabsTrigger>
      </TabsList>

      <TabsContent value="light" className="flex flex-col gap-4">
        <AnalysisCostKpis
          totalLabel="Total light-analysis cost"
          totalCostUsd={costs.lightCostUsd}
          lines={lightLines}
        />
        <LightAnalysisEvidenceView evidence={lightEvidence} />
      </TabsContent>

      <TabsContent value="deep" className="flex flex-col gap-4">
        <AnalysisCostKpis
          totalLabel="Total deep-analysis cost"
          totalCostUsd={costs.deepCostUsd}
          lines={deepLines}
        />
        {hasDeepWindows && deepEvidence ? (
          <DeepAnalysisEvidence
            evidence={deepEvidence}
            videoId={videoId}
            readOnly
            tabbed
          />
        ) : (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No deep-analysis evidence has been generated for this video yet.
            Events and their supporting signals appear here once the user has
            uploaded a source file and the deep-analysis pipeline has run.
          </p>
        )}
      </TabsContent>

      <TabsContent value="cost-logs" className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Every paid AI/media cost logged against this video.
          {costLogsTruncated ? " Showing the most recent 1,000." : ""}
        </p>
        <AdminCostLogsPanel
          rows={costLogRows}
          truncated={costLogsTruncated}
        />
      </TabsContent>
    </Tabs>
  )
}
