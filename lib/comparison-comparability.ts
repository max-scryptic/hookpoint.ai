// =============================================================================
// COMPARABILITY - WHAT A PAIR OF VIDEOS IS ALLOWED TO BE COMPARED ON
//
// Every head-to-head on the site ends in advice, and advice has to be pointed
// somewhere. The obvious place to point it is at whichever video performed
// better, and for most pairs that is right. For a pair whose two videos reached
// very differently sized audiences it is wrong, and wrong in a way that is
// invisible on the page: the report reads as confidently as any other, and
// every tip on it argues for copying a video that was never shown to be better.
//
// The failure that produced this module: 1,100 views at 16% average watched
// against 73 views at 19%. The script head-to-head named the 73 view video the
// stronger retention play and wrote every tip toward it. Neither half of that
// 3 point gap survives contact with the numbers.
//
// TWO SEPARATE PROBLEMS, AND ONLY ONE OF THEM IS SAMPLING
//
//   1. Noise. A watch figure from 73 viewers carries a 95% margin of about 9
//      points; the margin on the difference against a 1,100 view video is about
//      9.3. A 3 point gap is not a gap. This is what the intervals below
//      measure, and a bigger audience fixes it.
//
//   2. Composition. A video with far fewer views reached a different mix of
//      traffic, weighted toward subscribers and notifications rather than
//      browse and suggested. An audience that already follows the channel
//      watches longer than traffic that has never seen it, so the low view
//      video shows the better watch figure for reasons that have nothing to do
//      with its writing, packaging or edit. This is a confounder, not noise: it
//      pushes the same direction every time, and no audience size fixes it.
//      Where both videos have a stored traffic breakdown this is measured
//      rather than assumed (see trafficMixOverlap); where they do not, a large
//      view ratio stands in for it.
//
// WHAT THIS MODULE DECIDES
//
// A verdict per pair, `anchor`, computed server-side and handed to the report
// writers already resolved. It has two working values:
//
//   anchored  The performance difference is real and reachable. Advice may be
//             oriented toward the video that performed better, which is what
//             every report did unconditionally before this existed.
//   contrast  There is no usable performance anchor. The comparison is still
//             worth reading, but as two different plays rather than a winner
//             and a loser, and every tip has to stand on the craft evidence
//             alone. (`unknown`, for a pair with nothing stored to check, is
//             treated exactly the same way.)
//
// One verdict per QUESTION, not one per pair, because "did this hold its
// audience better" and "did this earn the click better" are different questions
// that the same two videos can answer differently. The 1,100 against 73 pair
// cannot answer the first: the smaller watch figure is noise on top of a
// different traffic mix. It can still be informative about the second, since a
// view gap is the outcome packaging is supposed to move rather than a confound
// sitting on top of it. See ComparisonQuestion.
//
// Belt and braces: in contrast mode the callers also withhold the per video
// performance figures from the model input entirely. A rule the model is asked
// to follow can be followed imperfectly; a number it never receives cannot sway
// it at all. The rules below are the second line of defence, not the first.
//
// RELATION TO lib/retention-sample-size.ts
//
// That module got here first and solves the same problem for the Retention tab
// specifically, where the inputs are two survival curves and the question is
// what may be claimed about their levels. It owns the statistical primitives
// and the thresholds, which this module imports rather than restates, and its
// caveat names are reused here verbatim so the two surfaces can never describe
// the same pair in different words. What is new here is that the verdict is
// pair level rather than curve level, so the Script and Packaging reports can
// be bound by it too, and that the traffic mix is measured.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any generated
// or literal text in this file. Hyphens are fine.
// =============================================================================

import {
  differenceMarginOfError,
  LOPSIDED_SAMPLE_RATIO,
  LOW_SAMPLE_VIEWS,
} from "@/lib/retention-sample-size"
import type { TrafficSource } from "@/lib/youtube/youtube"

// ---------------------------------------------------------------------------
// Thresholds

// Overlap between two traffic mixes, at or below which the two videos reached
// different enough audiences that composition is a live explanation for any
// performance gap between them. An overlap of 0.6 means four in ten views on
// the smaller side came from somewhere the larger side barely reached.
export const SIMILAR_TRAFFIC_MIX_OVERLAP = 0.6

// A traffic breakdown built from a handful of views is itself too noisy to
// compare, so below this the mix is treated as unknown and the view ratio is
// left to stand in for it.
export const MIN_VIEWS_FOR_TRAFFIC_MIX = 50

// Below this many impressions a click-through rate moves by more than a
// realistic difference between two thumbnails: at 1,000 impressions the 95%
// margin on a 5% rate is about 1.4 points, and at 200 it is about 3.
export const LOW_SAMPLE_IMPRESSIONS = 1_000

// ---------------------------------------------------------------------------
// Types

// Why a pair carries no usable performance anchor. The first two names are
// shared with lib/retention-sample-size.ts on purpose.
export type ComparabilityCaveat =
  // One side has too few viewers (or too few impressions) for any rate measured
  // on it to be stable.
  | "small_sample"
  // The two audiences differ enough in size that their traffic mixes, rather
  // than anything in the videos, may explain the gap.
  | "lopsided_samples"
  // Measured rather than inferred: the two videos were actually reached by
  // different mixes of traffic.
  | "different_traffic_mix"
  // The two figures being compared sit inside each other's margin of error, so
  // the difference between them is not distinguishable from noise.
  | "gap_within_noise"
  // The click question was answered from view counts because no impression data
  // is stored, so how often each video was offered is unknown.
  | "no_impression_data"

// What the pair's performance figures may be used for.
export type PerformanceAnchor =
  // Advice may be oriented toward the video that performed better.
  | "anchored"
  // No usable anchor: compare the two as different plays, never as a ranking.
  | "contrast"
  // Nothing was stored to check, so nothing could be. Handled as contrast.
  | "unknown"

// Which question a report is asking of the pair, and therefore which anchor
// binds it.
//
// These are not the same question and they do not have the same answer, which
// is the mistake this type exists to make impossible. A pair on 1,100 and 73
// views cannot be compared on how well each one held its audience: the smaller
// figure is noise sitting on top of a different traffic mix. The same pair can
// still be informative about which one earned its way in front of people,
// because a view gap is the outcome packaging is supposed to move rather than a
// confound on it. Handing one blended verdict to both reports would either gag
// the packaging comparison or let the script comparison crown a winner.
export type ComparisonQuestion =
  // Did one video hold its audience better? Asked by the script head-to-head.
  | "watch"
  // Did one video earn the click better? Asked by the packaging head-to-head.
  | "click"

export interface AnchorVerdict {
  anchor: PerformanceAnchor
  caveats: ComparabilityCaveat[]
}

export interface PairComparability {
  // Whether one video can be said to have held its audience better.
  watch: AnchorVerdict
  // Whether one video can be said to have earned the click better.
  click: AnchorVerdict
  viewsA: number | null
  viewsB: number | null
  // Larger audience divided by smaller. Null when either count is unknown.
  viewRatio: number | null
  // Average watched, in percent (0..100), exactly as YouTube reports it.
  averageWatchedPercentA: number | null
  averageWatchedPercentB: number | null
  // The gap between those two figures, and the 95% margin on that gap. A gap
  // smaller than its margin is not evidence that either video was watched for
  // longer.
  averageWatchedGapPoints: number | null
  averageWatchedGapMarginPoints: number | null
  averageWatchedGapIsSignificant: boolean | null
  // Impressions and click-through, when the reporting job has served them. The
  // honest click anchor: a click-through rate is a proportion of impressions,
  // so it separates what the packaging did from how often YouTube offered it,
  // which a view count cannot.
  impressionsA: number | null
  impressionsB: number | null
  clickThroughRateA: number | null
  clickThroughRateB: number | null
  clickThroughGapPoints: number | null
  clickThroughGapMarginPoints: number | null
  clickThroughGapIsSignificant: boolean | null
  // Share of the two traffic mixes that overlaps, 0..1. Null when either side
  // has no usable breakdown stored.
  trafficMixOverlap: number | null
  topTrafficSourceA: string | null
  topTrafficSourceB: string | null
}

export interface PairComparabilityInput {
  viewsA: number | null
  viewsB: number | null
  averageWatchedPercentA: number | null
  averageWatchedPercentB: number | null
  trafficSourcesA?: TrafficSource[] | null
  trafficSourcesB?: TrafficSource[] | null
  // Both optional: the impressions report is asynchronous and only covers a
  // retention window, so plenty of real pairs have neither. Their absence
  // narrows the click verdict rather than blocking it.
  impressionsA?: number | null
  impressionsB?: number | null
  // 0..1, as YouTube reports it.
  clickThroughRateA?: number | null
  clickThroughRateB?: number | null
}

// ---------------------------------------------------------------------------
// Traffic mix

// Studio's names for the codes the Analytics API returns, so the note and the
// model input both read the way the creator's own dashboard does. Anything not
// listed falls back to the prettified code, which is always better than
// printing YT_OTHER_PAGE at someone.
const TRAFFIC_SOURCE_LABEL: Record<string, string> = {
  ADVERTISING: "Advertising",
  ANNOTATION: "Cards and annotations",
  CAMPAIGN_CARD: "Campaign cards",
  END_SCREEN: "End screens",
  EXT_URL: "External sites",
  HASHTAGS: "Hashtag pages",
  IMMERSIVE: "Immersive feeds",
  LIVE_REDIRECT: "Live redirects",
  NO_LINK_EMBEDDED: "Embedded players",
  NO_LINK_OTHER: "Direct or unknown",
  NOTIFICATION: "Notifications",
  PLAYLIST: "Playlists",
  PRODUCT_PAGE: "Product pages",
  PROMOTED: "Promoted",
  RELATED_VIDEO: "Suggested videos",
  SHORTS: "Shorts feed",
  SOUND_PAGE: "Sound pages",
  // The Analytics API's SUBSCRIBER bucket is what Studio labels "Browse
  // features": the home feed and the subscriptions feed, not every view by a
  // subscriber. Named the way Studio names it so the note never contradicts the
  // dashboard the creator will check it against.
  SUBSCRIBER: "Browse features",
  VIDEO_REMIXES: "Remixes",
  YT_CHANNEL: "Channel pages",
  YT_OTHER_PAGE: "Other YouTube pages",
  YT_PLAYLIST_PAGE: "Playlist pages",
  YT_SEARCH: "YouTube search",
}

export function trafficSourceLabel(source: string): string {
  const known = TRAFFIC_SOURCE_LABEL[source]
  if (known) return known
  const spaced = source.replace(/_/g, " ").trim().toLowerCase()
  if (spaced.length === 0) return source
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function totalTrafficViews(sources: TrafficSource[]): number {
  return sources.reduce((sum, entry) => sum + Math.max(0, entry.views), 0)
}

// Each source's share of that video's traffic, 0..1.
function trafficShares(sources: TrafficSource[]): Map<string, number> {
  const total = totalTrafficViews(sources)
  const shares = new Map<string, number>()
  if (total <= 0) return shares
  for (const entry of sources) {
    if (entry.views <= 0) continue
    shares.set(entry.source, (shares.get(entry.source) ?? 0) + entry.views / total)
  }
  return shares
}

// How much of the two videos' traffic came from the same places: the sum over
// every source of the smaller of the two shares. 1 means identical mixes, 0
// means the two videos reached completely different audiences. This is the
// overlapping coefficient of the two distributions, which is the complement of
// their total variation distance, and it is the one number that says whether a
// watch figure from one is readable against a watch figure from the other.
//
// Null when either side is missing a breakdown or is too small for its own mix
// to mean anything, which is the signal to fall back to the view ratio.
export function trafficMixOverlap(
  a: TrafficSource[] | null | undefined,
  b: TrafficSource[] | null | undefined,
): number | null {
  if (a == null || b == null || a.length === 0 || b.length === 0) return null
  if (
    totalTrafficViews(a) < MIN_VIEWS_FOR_TRAFFIC_MIX ||
    totalTrafficViews(b) < MIN_VIEWS_FOR_TRAFFIC_MIX
  ) {
    return null
  }
  const sharesA = trafficShares(a)
  const sharesB = trafficShares(b)
  if (sharesA.size === 0 || sharesB.size === 0) return null

  let overlap = 0
  for (const [source, shareA] of sharesA) {
    overlap += Math.min(shareA, sharesB.get(source) ?? 0)
  }
  return Math.min(1, Math.max(0, overlap))
}

// The single biggest source of a video's views, as a readable label. Null when
// no breakdown is stored.
export function topTrafficSource(
  sources: TrafficSource[] | null | undefined,
): string | null {
  if (sources == null || sources.length === 0) return null
  let best: TrafficSource | null = null
  for (const entry of sources) {
    if (entry.views <= 0) continue
    if (best == null || entry.views > best.views) best = entry
  }
  return best == null ? null : trafficSourceLabel(best.source)
}

// ---------------------------------------------------------------------------
// The verdict

// Average watched is a mean of per viewer watch fractions rather than a
// proportion of viewers, so the binomial margin used here is not its exact
// standard error. It is, however, an upper bound on it: a variable bounded to
// 0..1 has its variance maximised by a Bernoulli with the same mean, so the
// true margin is always at or under this one. For a guardrail that is the right
// direction to be wrong in, since it can only ever refuse to call a difference
// real, never invent one.
function watchGapMarginPoints(
  percentA: number,
  viewsA: number | null,
  percentB: number,
  viewsB: number | null,
): number | null {
  const margin = differenceMarginOfError(
    percentA / 100,
    viewsA,
    percentB / 100,
    viewsB,
  )
  return margin == null ? null : margin * 100
}

// The 95% margin on the gap between two click-through rates, in percentage
// points. A click-through rate is a genuine proportion of impressions, so
// unlike the watch figure above this is the exact arithmetic rather than a
// bound on it.
function clickGapMarginPoints(
  rateA: number,
  impressionsA: number | null,
  rateB: number,
  impressionsB: number | null,
): number | null {
  const margin = differenceMarginOfError(rateA, impressionsA, rateB, impressionsB)
  return margin == null ? null : margin * 100
}

// Reads a pair's audience sizes, watch figures, traffic mixes and click-through
// into the two verdicts the written head-to-heads are bound by. Pure
// arithmetic, so it is exercised directly by tests and never needs a model.
export function assessPairComparability(
  input: PairComparabilityInput,
): PairComparability {
  const {
    viewsA,
    viewsB,
    averageWatchedPercentA,
    averageWatchedPercentB,
    trafficSourcesA,
    trafficSourcesB,
    impressionsA = null,
    impressionsB = null,
    clickThroughRateA = null,
    clickThroughRateB = null,
  } = input

  const overlap = trafficMixOverlap(trafficSourcesA, trafficSourcesB)

  const viewsKnown = viewsA != null && viewsB != null
  const smallestViews = viewsKnown ? Math.min(viewsA, viewsB) : null
  const largestViews = viewsKnown ? Math.max(viewsA, viewsB) : null
  const viewRatio =
    smallestViews != null && largestViews != null && smallestViews > 0
      ? largestViews / smallestViews
      : null

  // ---- Did one video hold its audience better?
  //
  // Every failure mode bites here: too few viewers to measure a rate, audiences
  // too differently sized or differently mixed to read one rate against the
  // other, and a gap too small to be a gap.

  const watchGapPoints =
    averageWatchedPercentA != null && averageWatchedPercentB != null
      ? Math.abs(averageWatchedPercentA - averageWatchedPercentB)
      : null
  const watchGapMargin =
    averageWatchedPercentA != null && averageWatchedPercentB != null
      ? watchGapMarginPoints(
          averageWatchedPercentA,
          viewsA,
          averageWatchedPercentB,
          viewsB,
        )
      : null
  const watchGapIsSignificant =
    watchGapPoints != null && watchGapMargin != null
      ? watchGapPoints > watchGapMargin
      : null

  const watchCaveats: ComparabilityCaveat[] = []
  if (smallestViews != null && smallestViews < LOW_SAMPLE_VIEWS) {
    watchCaveats.push("small_sample")
  }
  if (viewRatio != null && viewRatio > LOPSIDED_SAMPLE_RATIO) {
    watchCaveats.push("lopsided_samples")
  }
  if (overlap != null && overlap <= SIMILAR_TRAFFIC_MIX_OVERLAP) {
    watchCaveats.push("different_traffic_mix")
  }
  if (watchGapIsSignificant === false) watchCaveats.push("gap_within_noise")

  // ---- Did one video earn the click better?
  //
  // A different question with a different answer. Where impressions are stored
  // this is settled properly, on two click-through rates against the margin
  // their impression counts allow. Where they are not, views stand in, and the
  // only disqualifier is one side being too small to read: a lopsided view gap
  // is NOT a caveat here, because a view gap is the outcome packaging is meant
  // to move rather than a confound sitting on top of it.

  const impressionsKnown = impressionsA != null && impressionsB != null
  const ratesKnown = clickThroughRateA != null && clickThroughRateB != null
  const clickMeasurable = impressionsKnown && ratesKnown

  const clickGapPoints = ratesKnown
    ? Math.abs(clickThroughRateA - clickThroughRateB) * 100
    : null
  const clickGapMargin = clickMeasurable
    ? clickGapMarginPoints(
        clickThroughRateA,
        impressionsA,
        clickThroughRateB,
        impressionsB,
      )
    : null
  const clickGapIsSignificant =
    clickGapPoints != null && clickGapMargin != null
      ? clickGapPoints > clickGapMargin
      : null

  const clickCaveats: ComparabilityCaveat[] = []
  if (clickMeasurable) {
    if (Math.min(impressionsA, impressionsB) < LOW_SAMPLE_IMPRESSIONS) {
      clickCaveats.push("small_sample")
    }
    if (clickGapIsSignificant === false) clickCaveats.push("gap_within_noise")
  } else {
    clickCaveats.push("no_impression_data")
    if (smallestViews != null && smallestViews < LOW_SAMPLE_VIEWS) {
      clickCaveats.push("small_sample")
    }
  }

  // no_impression_data on its own narrows the click verdict without voiding it:
  // views are a weaker anchor than click-through, and they are still an anchor.
  const clickBlockers = clickCaveats.filter(
    (caveat) => caveat !== "no_impression_data",
  )
  const clickKnown = clickMeasurable || viewsKnown

  return {
    watch: {
      anchor: !viewsKnown
        ? "unknown"
        : watchCaveats.length > 0
          ? "contrast"
          : "anchored",
      caveats: watchCaveats,
    },
    click: {
      anchor: !clickKnown
        ? "unknown"
        : clickBlockers.length > 0
          ? "contrast"
          : "anchored",
      caveats: clickCaveats,
    },
    viewsA,
    viewsB,
    viewRatio,
    averageWatchedPercentA,
    averageWatchedPercentB,
    averageWatchedGapPoints: watchGapPoints,
    averageWatchedGapMarginPoints: watchGapMargin,
    averageWatchedGapIsSignificant: watchGapIsSignificant,
    impressionsA,
    impressionsB,
    clickThroughRateA,
    clickThroughRateB,
    clickThroughGapPoints: clickGapPoints,
    clickThroughGapMarginPoints: clickGapMargin,
    clickThroughGapIsSignificant: clickGapIsSignificant,
    trafficMixOverlap: overlap,
    topTrafficSourceA: topTrafficSource(trafficSourcesA),
    topTrafficSourceB: topTrafficSource(trafficSourcesB),
  }
}

// The verdict for the question a given report is asking.
export function verdictFor(
  comparability: PairComparability,
  question: ComparisonQuestion,
): AnchorVerdict {
  return question === "watch" ? comparability.watch : comparability.click
}

// True when advice on this pair may point at the video that performed better on
// the question being asked.
export function isAnchored(
  comparability: PairComparability,
  question: ComparisonQuestion,
): boolean {
  return verdictFor(comparability, question).anchor === "anchored"
}

// ---------------------------------------------------------------------------
// What the model is told

// The resolved verdict for one report's question, as that report hands it over.
// Deliberately thin: in contrast mode the per video performance figures are
// withheld from the model entirely (see the file header), so nothing here
// reintroduces them, and the model is left with the verdict and the reason for
// it rather than with the numbers it would otherwise be tempted to rank.
export function comparabilityForModel(
  comparability: PairComparability,
  question: ComparisonQuestion,
) {
  const verdict = verdictFor(comparability, question)
  const anchored = verdict.anchor === "anchored"
  const watch = question === "watch"
  return {
    // The question this verdict answers, spelled out so the model is never
    // guessing which of the two it has been handed.
    question: watch
      ? "whether one video held its audience better"
      : "whether one video earned the click better",
    anchor: verdict.anchor,
    caveats: verdict.caveats,
    // Named the way the rules refer to it, so the reason the report has to
    // hedge is legible without the arithmetic behind it.
    reason: comparabilityReason(comparability, question),
    videoAViews: anchored ? comparability.viewsA : null,
    videoBViews: anchored ? comparability.viewsB : null,
    // Both pairs of figures are always present as keys and null unless this
    // question earned them, so the shape the model sees does not change between
    // reports and a missing figure is never ambiguous with an absent field.
    videoAAverageWatchedPercent:
      anchored && watch ? comparability.averageWatchedPercentA : null,
    videoBAverageWatchedPercent:
      anchored && watch ? comparability.averageWatchedPercentB : null,
    videoAClickThroughPercent:
      anchored && !watch && comparability.clickThroughRateA != null
        ? comparability.clickThroughRateA * 100
        : null,
    videoBClickThroughPercent:
      anchored && !watch && comparability.clickThroughRateB != null
        ? comparability.clickThroughRateB * 100
        : null,
  }
}

// The one clause a report may use to state its limit, written here rather than
// left to the model so that every report states the same limit the same way.
// Null when the pair is anchored on this question and has no limit to state.
export function comparabilityReason(
  comparability: PairComparability,
  question: ComparisonQuestion,
): string | null {
  const { caveats, anchor } = verdictFor(comparability, question)
  if (anchor === "anchored") return null
  if (anchor === "unknown") return "nothing is stored about how either did"

  const { viewsA, viewsB } = comparability
  const smallest =
    viewsA != null && viewsB != null ? Math.min(viewsA, viewsB) : null
  const audience =
    smallest != null
      ? `only ${smallest.toLocaleString("en")} people`
      : "very few people"

  if (question === "click") {
    if (caveats.includes("small_sample")) {
      return comparability.impressionsA != null &&
        comparability.impressionsB != null
        ? "one of these videos was shown too few times for its click-through rate to mean anything"
        : `one of these videos reached ${audience}, which is too few to tell a thumbnail that failed from one that was barely offered`
    }
    return "the two videos' click-through rates sit inside each other's margin of error"
  }

  if (caveats.includes("small_sample")) {
    return `one of these videos was watched by ${audience}`
  }
  if (caveats.includes("different_traffic_mix")) {
    return "these two videos were reached by different mixes of traffic"
  }
  if (caveats.includes("lopsided_samples")) {
    return "these two videos reached very differently sized audiences"
  }
  return "the two videos' watch figures sit inside each other's margin of error"
}

/**
 * The rules every report that writes advice about a pair is bound by, as the
 * lines they are handed to a model as. Split so a prompt can quote one of them
 * in a surface-specific instruction, and so a failure in the generated copy
 * points at one rule rather than at a wall of text.
 *
 * These are universal. Anything true of only one report (which field carries
 * the verdict, what its sections are called) belongs in that report's own
 * instructions, not here. Modelled on lib/tip-voice.ts, which solved the same
 * drift problem for the voice of a tip.
 */
export const COMPARABILITY_RULES: readonly string[] = [
  // 1. What the verdict is, and that it is not up for debate.
  "You are given comparability, a verdict on what this pair of videos may honestly be compared on. It names the question this report is asking (comparability.question) and answers it in comparability.anchor. It is computed from each video's audience size, watch figures, traffic mix and click-through before you see any of them, the arithmetic is already settled, and it is not negotiable: never redo it, never overrule it, and never write about the statistics themselves as a subject.",

  // 2. Why the verdict exists, so the model reasons with it rather than around
  //    it. Both failure modes, in the terms the report can actually use.
  "Two videos can only be compared on how well they performed when both audiences are large enough to measure and similar enough to each other. A watch figure from a few dozen viewers moves by several points on chance alone, so two such figures that look different are usually the same figure. Separately, a video with far fewer views was reached by a different mix of traffic, weighted toward people who already follow the channel rather than toward browse and suggested, and an audience that already follows a channel watches longer than traffic that has never seen it. That difference is not caused by the writing, the packaging or the edit, and a video with few views will therefore often show the better watch figure while being no better in any way you can act on.",

  // 3. The permissive branch.
  "When comparability.anchor is 'anchored' the performance difference between these two videos is real and large enough to read. Name the video that performed better, explain what in it plausibly did that, and orient your advice toward what it did.",

  // 4. The restrictive branch. The one this module exists for.
  "When comparability.anchor is 'contrast' or 'unknown' this pair carries no usable performance anchor, and the report changes shape. Never name either video the better performer, the stronger play, the more engaging one or the winner, in any field. Never present one video's views, average watched, watch time or audience as evidence that something in it worked, and never write that a trait supports, drives, sustains, explains or is why one video held its audience better than the other. Do not build any field on the gap between the two videos' performance figures. Their performance figures have been withheld from you for this pair, so if you find yourself reaching for one, that is the rule working rather than data missing.",

  // 5. What to write instead. Without this the model just hedges everything and
  //    the report becomes mush.
  "In that mode write the comparison as a contrast between two different approaches rather than as a ranking. Say concretely what each video does on the theme at hand, and where they differ, say what each approach trades away and what it buys, since two videos genuinely doing different things is a finding on its own and it is the finding this pair supports. Be as specific and as confident about what each video does as you would be in any other report: the limit is on ranking them, not on describing them.",

  // 6. The tip filter. This is what actually fixes the tips.
  "Every tip in that mode has to stand on the craft evidence alone. Before writing one, check it against this: if the only reason to follow it is that one of these two videos performed better, it is not a tip, and what belongs there instead is the advice that the writing, the packaging or the structure supports by itself. Advice that only holds if the comparison had a winner does not go on the page. A tip may also be written as something to try and measure on the next upload rather than as a settled rule, which is often the honest form here.",

  // 7. Where the hedge goes, and how much of it. A limit restated in every
  //    section reads as an apology and buries the comparison.
  "State the limit exactly once, in the summary or verdict, as a single short clause naming the reason given in comparability.reason, and then get on with the comparison. Do not repeat it in later sections, do not apologise for it, do not pad any field with it, and never discuss margins of error, sample sizes, statistical significance or traffic mixes as topics in their own right beyond that one clause.",

  // 8. Craft verdicts survive; performance verdicts do not. Without this a
  //    schema with a required stronger-side field gets filled in from nothing.
  "Where this report has a field naming a stronger side, that field judges the craft in front of you and never reports which video performed better. In contrast mode decide it on the evidence you can see and read, with performance set aside completely, and where the report also asks you for a confidence, lower it to reflect that no performance figure stands behind the judgement.",

  // 9. Within-video evidence is still fair game, and saying so keeps the
  //    reports from throwing away the good half of their evidence.
  "One thing this limit never touches: how a single video behaved against itself. Where a video loses its own audience, which of its own stretches held and which shed viewers, and how its opening did against the rest of it are all measured inside that one video, so they stay usable in full, in every mode, and they are the strongest evidence available for a pair with no performance anchor.",
]

/**
 * The comparability rules as one block of prompt text, which is how every
 * prompt that writes advice about a pair includes them. Prompts here are
 * assembled as arrays of sentences joined by a space, so this drops straight
 * into one as a single element.
 */
export const COMPARABILITY_PROMPT = COMPARABILITY_RULES.join(" ")

// ---------------------------------------------------------------------------
// What the reader is told

// The sentence a report shows above itself when its pair carries no usable
// performance anchor, so the reader knows why nothing on the page crowns a
// winner. Null for an anchored pair, which needs no warning. Kept here rather
// than in the components so the copy and the verdict it describes cannot drift
// apart, and so both written head-to-heads say it identically.
export function comparabilityNote(
  comparability: PairComparability,
  question: ComparisonQuestion,
): string | null {
  const { anchor, caveats } = verdictFor(comparability, question)
  if (anchor === "anchored") return null

  const { viewsA, viewsB, trafficMixOverlap: overlap } = comparability
  const read =
    "Read this as two different approaches rather than as a winner, and take each tip on whether it holds up on its own."

  if (anchor === "unknown") {
    return `Nothing is stored about how these two videos did, so neither one can be shown to have performed better than the other. ${read}`
  }

  const smallest =
    viewsA != null && viewsB != null ? Math.min(viewsA, viewsB) : null
  const audience =
    smallest != null
      ? `only ${smallest.toLocaleString("en")} people`
      : "very few people"

  if (question === "click") {
    if (caveats.includes("small_sample")) {
      return comparability.impressionsA != null &&
        comparability.impressionsB != null
        ? `One of these videos was shown too few times for its click-through rate to be read against the other's. ${read}`
        : `One of these videos reached ${audience}, and without impression data there is no way to tell a thumbnail that failed to earn clicks from one YouTube barely offered. ${read}`
    }
    return `These two videos' click-through rates sit inside each other's margin of error, so neither thumbnail and title pair earned measurably more clicks than the other. ${read}`
  }

  if (caveats.includes("small_sample")) {
    const mix =
      caveats.includes("different_traffic_mix") ||
      caveats.includes("lopsided_samples")
        ? " The two also reached different mixes of traffic, and an audience that already follows the channel watches longer than traffic that has never seen it, which moves a watch figure on its own."
        : ""
    return (
      `One of these videos was watched by ${audience}, so its watch figures carry a margin of several points and cannot be read against the other's.` +
      mix +
      ` ${read}`
    )
  }

  if (caveats.includes("different_traffic_mix")) {
    const measured =
      overlap != null
        ? ` Only about ${Math.round(overlap * 100)}% of their traffic came from the same places.`
        : ""
    return (
      "These two videos were reached by different mixes of traffic, and an audience that already follows the channel watches longer than traffic that has never seen it, so the gap between their watch figures is not a fair read on the videos themselves." +
      measured +
      ` ${read}`
    )
  }

  if (caveats.includes("lopsided_samples")) {
    return `These two videos reached very differently sized audiences, so their traffic mixes differ too, and that alone moves a watch figure. ${read}`
  }

  return `These two videos' watch figures sit inside each other's margin of error, so neither one was watched measurably longer than the other. ${read}`
}
