// What a retention window's feedback amounts to once the report's dedupe passes
// have run over it: which of its deep insights earn a tab, and whether the
// window has anything to say at all.
//
// This lives outside the detail component because the last question is asked
// before a row exists rather than while one renders — a hold with nothing said
// about it is dropped from the list, from the chart's markers and from the tab
// strip together (see AnalysedVideoDetail) — and the answer has to be the same
// in all four places as what WindowFeedback would actually draw.

import type { RetentionMomentAttribution } from "@/lib/retention-attribution"
import type { DeepWindowFeedback } from "@/lib/report-tip-uniqueness"

// Reduce a window's raw per-event deep feedback to just the entries that earn
// their own tab. Only an insight that produced an actionable tip is worth a
// tab (the reasoning is shown above the tip inside it), and each distinct tip
// gets a single tab — several events in one window often synthesise the same
// recommendation, and a tipless event would render an empty tab.
export function dedupeDeepFeedback(
  deepFeedback: DeepWindowFeedback[],
): DeepWindowFeedback[] {
  const seenTips = new Set<string>()

  return deepFeedback.filter(({ recommendation }) => {
    const tip = recommendation?.action.trim()
    if (!tip || seenTips.has(tip)) return false
    seenTips.add(tip)
    return true
  })
}

// Whether the window's transcript reading is worth a showing of its own — the
// one that becomes the "Script" tab.
export function hasScriptFeedback(
  attribution: RetentionMomentAttribution | undefined,
): attribution is RetentionMomentAttribution {
  return attribution != null && attribution.explanation !== ""
}

// Whether the window has any feedback left to show: a transcript reading, or at
// least one deep insight that survived the dedupe. False means every branch of
// WindowFeedback renders its header and nothing under it.
//
// A window can arrive here empty for reasons that are working as intended. Deep
// analysis is capped, and reserves only the single strongest hold per video (see
// selectDeepAnalysisWindows), so the rest never get frames or audio read at all.
// The script pass skips any window carrying fewer than MINIMUM_TRANSCRIPT_WORDS
// and drops the tips it wrote without warrant (see THE WARRANT in
// lib/retention-attribution.ts). And the report's own uniqueness pass strips a
// recommendation that repeats one made higher up the page. Any of those can
// leave a window with a measurement and no reading of it.
export function hasWindowFeedback(
  attribution: RetentionMomentAttribution | undefined,
  deepFeedback: DeepWindowFeedback[],
): boolean {
  return (
    hasScriptFeedback(attribution) || dedupeDeepFeedback(deepFeedback).length > 0
  )
}
