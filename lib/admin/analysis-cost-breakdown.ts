import { createAdminClient } from "@/lib/supabase/admin"
import {
  analysisCostBucket,
  type AnalysisCostBucket,
  type CostType,
  type LlmCallType,
} from "@/lib/llm-call-types"

// Read-side helper for the admin video-analysis detail tabs: the authoritative
// per-section cost breakdown for a single video, read straight from the
// append-only cost_logs (the same figures the account-wide cost log shows),
// rolled up per call type and split into the light/deep analysis buckets.
//
// Uses the service-role client (bypassing RLS) and MUST only be called from
// server code that has already verified the caller is an admin.

// The stable key a cost line rolls up under: an LLM call type, or the transcode
// cost type (which has no call_type of its own).
export type AnalysisCostSection = LlmCallType | "qencode_transcode"

// Short, tab-local section labels — the account-wide cost log uses the longer
// "Light analysis · pacing" wording, but inside a bucket's own tab that prefix
// is redundant, so each section is named for the work it does.
export const ANALYSIS_COST_SECTION_LABELS: Record<AnalysisCostSection, string> =
  {
    pacing: "Pacing",
    packaging_alignment: "Packaging alignment",
    packaging_taxonomy: "Packaging taxonomy",
    script_taxonomy: "Script taxonomy",
    script_comparison: "Script comparison",
    packaging_comparison: "Packaging comparison",
    retention_comparison: "Retention comparison",
    retention_attribution: "Retention attribution",
    snapshot: "Snapshots (vision)",
    audio: "Audio",
    transcript_taxonomy: "Transcript taxonomy",
    event_synthesis: "Event synthesis",
    // Never billed against a video: the examples behind a tip are written when
    // a creator opens one, long after the run, and are logged against them
    // rather than against the analysis (see lib/tip-examples-generation.ts). It
    // is named here because the section type covers every call type, not
    // because a line for it can appear on this tab.
    tip_examples: "Tip examples",
    qencode_transcode: "Transcoding",
  }

// One section's rolled-up spend: every cost_logs row that shares this call type,
// summed. callCount is how many individual calls were logged (each attempt is
// its own row), so a section that was retried reads higher than one that ran
// once.
export interface AnalysisCostLine {
  section: AnalysisCostSection
  label: string
  bucket: AnalysisCostBucket
  costUsd: number
  callCount: number
  inputTokens: number
  outputTokens: number
  // The distinct models billed for this section, in first-seen order. Empty for
  // a transcode (which has no model).
  models: string[]
}

// A video's full cost breakdown: the per-section lines plus the bucket and grand
// totals the KPI row shows. Lines are ordered by their bucket's canonical
// pipeline order so the light tab reads pacing → packaging → retention and the
// deep tab reads transcode → snapshot → audio → synthesis.
export interface AnalysisCostBreakdown {
  lines: AnalysisCostLine[]
  lightCostUsd: number
  deepCostUsd: number
  totalCostUsd: number
}

// The order sections are presented in within each bucket — the order the
// pipeline runs them in, so the breakdown reads top-to-bottom as the work
// happens rather than in whatever order the rows came back.
const SECTION_ORDER: AnalysisCostSection[] = [
  "pacing",
  "packaging_taxonomy",
  "packaging_alignment",
  "script_taxonomy",
  "script_comparison",
  "packaging_comparison",
  "retention_comparison",
  "retention_attribution",
  "qencode_transcode",
  "snapshot",
  "audio",
  "transcript_taxonomy",
  "event_synthesis",
]

interface CostLogRow {
  cost_type: CostType
  call_type: LlmCallType | null
  model: string | null
  input_tokens: number | string | null
  output_tokens: number | string | null
  cost_usd: number | string | null
}

// The section a cost row rolls up under: its call type for an LLM call, or the
// transcode section for a Qencode transcode (which carries no call type).
function sectionForRow(row: CostLogRow): AnalysisCostSection | null {
  if (row.cost_type === "qencode_transcode") return "qencode_transcode"
  if (row.call_type) return row.call_type
  return null
}

// Loads and rolls up a video's cost_logs into per-section lines and bucket
// totals. The lookup is scoped to the owning user so an admin viewing one
// account can never fold in another account's spend. A query failure resolves
// to an empty breakdown (all zeroes) rather than throwing — a missing cost
// roll-up should never sink the evidence tabs it sits above.
export async function getAnalysisCostBreakdown(
  userId: string,
  analysedVideoId: string,
): Promise<AnalysisCostBreakdown> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("cost_logs")
    .select("cost_type, call_type, model, input_tokens, output_tokens, cost_usd")
    .eq("user_id", userId)
    .eq("analysed_video_id", analysedVideoId)

  if (error) {
    console.error("Failed to load cost breakdown for video", error)
    return {
      lines: [],
      lightCostUsd: 0,
      deepCostUsd: 0,
      totalCostUsd: 0,
    }
  }

  const bySection = new Map<AnalysisCostSection, AnalysisCostLine>()
  for (const row of (data ?? []) as CostLogRow[]) {
    const section = sectionForRow(row)
    if (!section) continue

    const line =
      bySection.get(section) ??
      ({
        section,
        label: ANALYSIS_COST_SECTION_LABELS[section],
        bucket: analysisCostBucket(row.cost_type, row.call_type),
        costUsd: 0,
        callCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        models: [],
      } satisfies AnalysisCostLine)

    line.costUsd += Number(row.cost_usd ?? 0)
    line.callCount += 1
    line.inputTokens += Number(row.input_tokens ?? 0)
    line.outputTokens += Number(row.output_tokens ?? 0)
    if (row.model && !line.models.includes(row.model)) {
      line.models.push(row.model)
    }

    bySection.set(section, line)
  }

  const lines = [...bySection.values()].sort(
    (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section),
  )

  const lightCostUsd = lines
    .filter((line) => line.bucket === "light")
    .reduce((sum, line) => sum + line.costUsd, 0)
  const deepCostUsd = lines
    .filter((line) => line.bucket === "deep")
    .reduce((sum, line) => sum + line.costUsd, 0)

  return {
    lines,
    lightCostUsd,
    deepCostUsd,
    totalCostUsd: lightCostUsd + deepCostUsd,
  }
}
