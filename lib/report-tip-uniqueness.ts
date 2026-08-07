// The last pass over a video report's tips: no two of them may say the same
// thing.
//
// A report carries advice from three writers that cannot see each other. The
// retention attribution writes one tip per moment from the transcript, the deep
// analysis synthesises one per multimodal insight, and the pacing pass writes
// one per slow stretch. Each is asked about its own moment in isolation, so a
// weakness that shows up at 0:40, 3:09 and 5:38 comes back as the same sentence
// three times. Stacked down one page, identical tips read as a template rather
// than as analysis, and the reader learns nothing from the second and third.
//
// Each writer already keeps its own advice distinct: the prompts ask for it, and
// lib/deep-analysis-recommendations.ts moves a repeated branch onto a different
// action. What none of them can do is see the other two. So the page assembles
// every tip it is about to render and runs them through here first.
//
// THE RULE: the first wording of a piece of advice is kept, and any later
// restatement is dropped. Applied in the order a reader meets the tips, which is
// why the caller passes the sections in page order and this walks each section
// by window index, script tip before deep tips. Nothing is rewritten and nothing
// is regenerated: a repeat simply loses its "Try:" line, keeping its explanation
// and its evidence. That is the honest outcome, since the advice is already on
// the page a screen further up.
//
// Sameness is isNearDuplicateAdvice, not string equality: three writers phrase
// one idea three ways, and a rewording is still a repeat.

import { createAdviceDeduper } from "@/lib/advice-similarity"
import type { RankedRetentionWindowEvent } from "@/lib/deep-analysis-insight-ranking"
import type { DeepAnalysisRecommendation } from "@/lib/deep-analysis-recommendations"
import type { PacingAnalysis } from "@/lib/pacing-analysis"
import type { RetentionMomentAttribution } from "@/lib/retention-attribution"

// One deep insight for a window, with the recommendation synthesised from it
// when it produced one.
export type DeepWindowFeedback = {
  insight: RankedRetentionWindowEvent
  recommendation?: DeepAnalysisRecommendation
}

// The feedback shown against the windows of one retention section (the hooks,
// the drop-offs, the gains or the holds), keyed by window index.
export type RetentionSectionFeedback = {
  attribution: Map<number, RetentionMomentAttribution>
  deepFeedback: Map<number, DeepWindowFeedback[]>
}

/**
 * Whether a tip is the first time this report has given that advice. It records
 * as it goes, so call it exactly once per tip, in the order they are read.
 */
export type FirstSaying = (tip: string | null | undefined) => boolean

export function createFirstSaying(): FirstSaying {
  return createAdviceDeduper()
}

/**
 * One retention section with its repeated tips removed. The maps and the
 * entries that change are copied rather than mutated, since they are built from
 * server-rendered props.
 */
export function dedupeSectionTips(
  section: RetentionSectionFeedback,
  isFirstSaying: FirstSaying,
): RetentionSectionFeedback {
  const attribution = new Map(section.attribution)
  const deepFeedback = new Map(section.deepFeedback)
  const windowIndexes = [
    ...new Set([...attribution.keys(), ...deepFeedback.keys()]),
  ].sort((a, b) => a - b)

  for (const windowIndex of windowIndexes) {
    // A gain's tip is the one the attribution guarantees is never null, since a
    // gain exists to leave the uploader something to reuse. Dropping a repeat of
    // it costs nothing: the same instruction is still on the page above.
    const moment = attribution.get(windowIndex)
    if (moment?.tip && !isFirstSaying(moment.tip)) {
      attribution.set(windowIndex, { ...moment, tip: null })
    }

    const feedback = deepFeedback.get(windowIndex)
    if (feedback) {
      deepFeedback.set(
        windowIndex,
        // Only the recommendation goes. What is left is an insight with no tip,
        // which the page already knows how to render.
        feedback.map((entry) =>
          entry.recommendation && !isFirstSaying(entry.recommendation.action)
            ? { insight: entry.insight }
            : entry,
        ),
      )
    }
  }

  return { attribution, deepFeedback }
}

/**
 * The pacing analysis with any suggestion the report has already made blanked,
 * which is how that list hides a tip it has nothing to show for.
 */
export function dedupePacingTips(
  analysis: PacingAnalysis | null,
  isFirstSaying: FirstSaying,
): PacingAnalysis | null {
  if (!analysis) return null
  return {
    ...analysis,
    // Sorted the way the list renders them, so "first wording wins" means the
    // one the reader reaches first rather than whichever the model wrote first.
    slowOrRepetitiveStretches: [...analysis.slowOrRepetitiveStretches]
      .sort((a, b) => a.startSeconds - b.startSeconds)
      .map((stretch) =>
        isFirstSaying(stretch.suggestion) ? stretch : { ...stretch, suggestion: "" },
      ),
  }
}
