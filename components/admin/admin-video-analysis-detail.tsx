"use client"

import { Loader2Icon } from "lucide-react"

import { AnalysisCostKpis } from "@/components/admin/analysis-cost-kpis"
import { AdminCostLogsPanel } from "@/components/admin/admin-cost-logs-panel"
import { LightAnalysisEvidenceView } from "@/components/admin/light-analysis-evidence"
import { DeepAnalysisEvidence } from "@/components/deep-analysis-evidence"
import { DeepAnalysisStageChecklist } from "@/components/deep-analysis-progress"
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
import { useProcessingRefresh } from "@/hooks/use-processing-refresh"
import type { DeepAnalysisProgress } from "@/lib/retention-window-media-progress"

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
  sourceFileUploaded,
  deepAnalysisProgress = null,
  costLogRows,
  costLogsTruncated = false,
}: {
  videoId: string
  costs: AnalysisCostBreakdown
  lightEvidence: LightAnalysisEvidence
  deepEvidence: DeepAnalysisEvidenceData | null
  // Whether the user has uploaded a raw source file. The deep-analysis pipeline
  // only runs off an uploaded file, so the Deep Analysis tab and its events stay
  // hidden entirely until the upload has landed.
  sourceFileUploaded: boolean
  // The per-stage snapshot of the deep-analysis pipeline, when a raw file has
  // landed. When it's still in flight the Deep Analysis tab leads with a live
  // checklist showing which step is running, mirroring the front-end view.
  deepAnalysisProgress?: DeepAnalysisProgress | null
  costLogRows: CostLogRow[]
  costLogsTruncated?: boolean
}) {
  const lightLines = costs.lines.filter((line) => line.bucket === "light")
  const deepLines = costs.lines.filter((line) => line.bucket === "deep")
  const hasDeepWindows = Boolean(
    deepEvidence && deepEvidence.windows.length > 0,
  )
  // The pipeline is still running when it's active but hasn't settled every
  // stage. The stages snapshot is server-rendered, so re-fetch fresh server data
  // while it's in flight to keep the checklist moving — and to swap in the
  // evidence once the run lands.
  const analysisInProgress = Boolean(
    deepAnalysisProgress?.active &&
      !deepAnalysisProgress.complete &&
      deepAnalysisProgress.stages,
  )

  useProcessingRefresh(analysisInProgress)

  return (
    <Tabs defaultValue="light" className="gap-4">
      <TabsList>
        <TabsTrigger value="light">Light Analysis</TabsTrigger>
        {sourceFileUploaded && (
          <TabsTrigger value="deep">Deep Analysis</TabsTrigger>
        )}
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

      {sourceFileUploaded && (
        <TabsContent value="deep" className="flex flex-col gap-4">
          <AnalysisCostKpis
            totalLabel="Total deep-analysis cost"
            totalCostUsd={costs.deepCostUsd}
            lines={deepLines}
          />
          {analysisInProgress && deepAnalysisProgress?.stages && (
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 shrink-0 animate-spin" />
                <span>
                  This video is still being deep-analysed. Steps update
                  automatically.
                </span>
              </div>
              <DeepAnalysisStageChecklist
                stages={deepAnalysisProgress.stages}
                title="Deep-analysis progress"
              />
            </div>
          )}
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
              Events and their supporting signals appear here once the
              deep-analysis pipeline has run.
            </p>
          )}
        </TabsContent>
      )}

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
