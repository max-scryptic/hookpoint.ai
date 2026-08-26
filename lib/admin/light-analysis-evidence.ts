// Aggregates every piece of "light analysis" evidence a video has accumulated -
// the source-file-free reads the initial analysis produces from the video's
// metadata, thumbnail and caption transcript alone: its pacing analysis, its
// packaging alignment and the categorical packaging taxonomy generated
// alongside it, and its retention attribution. This is the light-analysis
// counterpart to lib/deep-analysis-evidence.ts, for the admin oversight tabs.
//
// Purely read-only: it renders whatever the initial-analysis path has already
// generated and stored, however partial, and never triggers a generation.
//
// Uses the caller's Supabase client; the admin detail page passes the
// service-role client (behind the admin auth check), scoped to the owning user.

import type { SupabaseClient } from "@supabase/supabase-js"

import { getPacingAnalysis } from "@/lib/pacing-analyses"
import { getPackagingAlignment } from "@/lib/packaging-alignments"
import { getScriptTaxonomy } from "@/lib/script-taxonomies"
import { getRetentionAttribution } from "@/lib/retention-attributions"
import type { PacingAnalysis } from "@/lib/pacing-analysis"
import type { PackagingAlignment } from "@/lib/packaging-alignment"
import type { ScriptTaxonomy } from "@/lib/script-taxonomy"
import type { RetentionAttribution } from "@/lib/retention-attribution"

// A video's full light-analysis evidence set. Each field is null until the
// initial-analysis path has generated and stored that read (or when its
// generation failed); the UI renders an empty state per section rather than
// hiding the whole tab.
export interface LightAnalysisEvidence {
  pacing: PacingAnalysis | null
  packaging: PackagingAlignment | null
  script: ScriptTaxonomy | null
  retention: RetentionAttribution | null
}

// True when at least one light-analysis read exists - used by the detail page
// to choose between the evidence sections and a "nothing generated yet" empty
// state.
export function hasLightAnalysisEvidence(
  evidence: LightAnalysisEvidence,
): boolean {
  return Boolean(
    evidence.pacing ||
      evidence.packaging ||
      evidence.script ||
      evidence.retention,
  )
}

// Loads a video's light-analysis reads in one round-trip. Each read is
// independent, so a failure in one (they throw on a query error) is caught and
// downgraded to null rather than sinking the others - an admin should still see
// the pacing analysis even if, say, the packaging column can't be read.
export async function getLightAnalysisEvidence(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<LightAnalysisEvidence> {
  const [pacing, packaging, script, retention] = await Promise.all([
    getPacingAnalysis(supabase, userId, analysedVideoId).catch((error) => {
      console.error("Failed to load pacing analysis for admin", error)
      return null
    }),
    getPackagingAlignment(supabase, userId, analysedVideoId).catch((error) => {
      console.error("Failed to load packaging alignment for admin", error)
      return null
    }),
    getScriptTaxonomy(supabase, userId, analysedVideoId).catch((error) => {
      console.error("Failed to load script taxonomy for admin", error)
      return null
    }),
    getRetentionAttribution(supabase, userId, analysedVideoId).catch(
      (error) => {
        console.error("Failed to load retention attribution for admin", error)
        return null
      },
    ),
  ])

  return { pacing, packaging, script, retention }
}
