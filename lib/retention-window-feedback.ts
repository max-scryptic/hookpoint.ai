// What a retention window's feedback amounts to once the report's dedupe passes
// have run over it: which of its deep insights and which of its script reading
// earn a tab, and so whether the window has any advice to give at all.
//
// This lives outside the detail component because the last question is asked
// before a row exists rather than while one renders - a window with no tip on it
// is dropped from its list, from the chart's markers and from the tab strip
// together (see AnalysedVideoDetail) - and the answer has to be the same in all
// four places as what WindowFeedback would actually draw.

import type { RetentionMomentAttribution } from "@/lib/retention-attribution"
import type { DeepWindowFeedback } from "@/lib/report-tip-uniqueness"

// Reduce a window's raw per-event deep feedback to just the entries that earn
// their own tab. Only an insight that produced an actionable tip is worth a
// tab (the reasoning is shown above the tip inside it), and each distinct tip
// gets a single tab - several events in one window often synthesise the same
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

// Whether the window's transcript reading has a body to show at all: the
// explanation that opens the "Script" tab. Whether that reading earns the tab is
// a further question - see resolveWindowFeedback.
export function hasScriptFeedback(
  attribution: RetentionMomentAttribution | undefined,
): attribution is RetentionMomentAttribution {
  return attribution != null && attribution.explanation !== ""
}

// Whether one of the window's deep tabs already carries this tip, in which case
// the script reading drops its own copy of it: a tip measured off the frames and
// the audio is the better-evidenced version of the same advice, and it is the
// one that can show its working. lib/report-tip-uniqueness.ts settles this for
// the report as a whole, in the same direction and against near-duplicates
// rather than exact ones; this is the last check before the tabs are built.
function deepFeedbackCarriesTip(
  deepFeedback: DeepWindowFeedback[],
  tip: string,
): boolean {
  return deepFeedback.some(
    ({ recommendation }) => recommendation?.action.trim() === tip,
  )
}

// What a window actually shows: the script reading when it earns a showing, and
// the deep insights that earn one each. One entry here is one tab, or - where
// only a single entry survives - the one flat block the row renders instead.
export interface ResolvedWindowFeedback {
  // The transcript reading, or null where it has nothing left to say.
  script: RetentionMomentAttribution | null
  // The deep insights that survived the dedupe, in the order they were given.
  deep: DeepWindowFeedback[]
}

// EVERY SHOWING CARRIES A TIP. The script reading earns its place only when it
// has a "Try:" line of its own that no deep tab already carries; the deep
// insights already answer to the same rule through dedupeDeepFeedback. An
// explanation with no advice under it is dropped whole rather than shown
// tipless, because the reader can see the curve already: a tab that restates
// where retention fell, next to tabs that say what to do about it, is a tab
// worth opening once and never again.
//
// This is the single answer the whole report reads off - the rows, the chart's
// markers, the retention tabs and the tab strip itself - so a window that shows
// nothing here shows nothing anywhere.
export function resolveWindowFeedback(
  attribution: RetentionMomentAttribution | undefined,
  deepFeedback: DeepWindowFeedback[],
): ResolvedWindowFeedback {
  const deep = dedupeDeepFeedback(deepFeedback)
  const tip = hasScriptFeedback(attribution)
    ? (attribution.tip ?? "").trim()
    : ""
  const script =
    hasScriptFeedback(attribution) &&
    tip !== "" &&
    !deepFeedbackCarriesTip(deep, tip)
      ? attribution
      : null

  return { script, deep }
}

// Whether the window has a tip on it: a "Try:" line the creator can act on,
// written either from the transcript or from one of the deep insights that
// survived the dedupe. This is what decides whether the window gets a row at
// all, so an explanation with no advice under it counts as nothing: the reader
// already has the curve, and a timestamp restating what it shows is not a
// finding.
//
// A window can arrive here tipless for reasons that are all working as intended.
// Deep analysis is capped, and reserves only the single strongest hold per video
// (see selectDeepAnalysisWindows), so the rest never get frames or audio read at
// all. The script pass skips any window carrying fewer than
// MINIMUM_TRANSCRIPT_WORDS and drops the tips it wrote without warrant (see THE
// WARRANT in lib/retention-attribution.ts). And the report's own uniqueness pass
// strips a recommendation that repeats one made higher up the page, which is the
// one case where the advice is still on the report, a screen further up, rather
// than missing from it.
export function hasWindowTip(
  attribution: RetentionMomentAttribution | undefined,
  deepFeedback: DeepWindowFeedback[],
): boolean {
  // Asked of the resolved feedback rather than of the raw passes, so the row is
  // kept exactly when WindowFeedback would have something to draw in it. A
  // script tip a deep tab already carries is not lost by being resolved away:
  // the tab carrying it keeps the window on the page.
  const { script, deep } = resolveWindowFeedback(attribution, deepFeedback)
  return script != null || deep.length > 0
}
