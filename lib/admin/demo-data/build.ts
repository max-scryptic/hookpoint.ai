// Pure builders for the demo library: given a concept and a seed, produce every
// payload one analysed video needs, with no database and no network involved.
//
// The point of keeping this pure is that the numbers stay checkable. A demo
// retention curve is not decoration: it is fed through the SAME detectors the
// real pipeline uses (buildRetentionWindows, which calls computeRetentionWindows
// / detectSignificantDropOffs / detectRetentionGains / detectRetentionHolds), so
// the windows a demo video ends up with are the windows the product would have
// derived from that curve. Anything shaped by hand here is shaped upstream of
// those detectors, in the curve itself.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013) in this file.

import {
  DEMO_ATTRIBUTION_MOMENTS,
  DEMO_CHANNEL_ID,
  DEMO_EVENT_NARRATIVES,
  DEMO_PACING_PATTERNS,
  DEMO_PACING_STRETCHES,
  DEMO_PACKAGING_COPY,
  DEMO_TRANSCRIPT_LINES,
  type DemoVideoConcept,
} from "@/lib/admin/demo-data/content"
import { Rng } from "@/lib/admin/demo-data/random"
import type { PacingAnalysis, PacingWindow } from "@/lib/pacing-analysis"
import type { PackagingAlignment } from "@/lib/packaging-alignment"
import {
  CLICK_DRIVERS,
  EMOTIONAL_VALENCES,
  HOOK_DELIVERIES,
  OPENING_TYPES,
  PACKAGING_ARCHETYPES,
  PACKAGING_TAXONOMY_SCHEMA_VERSION,
  PERSONAL_FRAMINGS,
  POWER_DEVICES,
  PROMISE_TYPES,
  SCENE_TYPES,
  THUMBNAIL_EMOTIONS,
  THUMBNAIL_MOODS,
  TITLE_STYLES,
  type PackagingTaxonomy,
} from "@/lib/packaging-taxonomy"
import {
  RETENTION_ATTRIBUTION_SCHEMA_VERSION,
  type RetentionAttribution,
  type RetentionMomentAttribution,
} from "@/lib/retention-attribution"
import {
  buildRetentionWindows,
  type RetentionWindow,
} from "@/lib/retention-windows"
import type { RetentionWindowEventType } from "@/lib/retention-window-events"
import {
  ARC_SHAPES,
  DOMINANT_EMOTIONS,
  ENGAGEMENT_DRIVERS,
  HUMOR_STYLES,
  NARRATIVE_VOICES,
  PERSUASION_DEVICES,
  SCRIPT_ARCHETYPES,
  SCRIPT_FORMATS,
  SCRIPT_TAXONOMY_SCHEMA_VERSION,
  type ScriptTaxonomy,
} from "@/lib/script-taxonomy"
import type {
  RetentionPoint,
  TranscriptCue,
  VideoAnalyticsSummary,
  VideoDetails,
} from "@/lib/youtube/youtube"

// Stamped on everything the synthesiser writes, so a row that turns up in a
// cost report or an admin table says what it is without anyone having to trace
// it back. Never a real model id.
export const DEMO_MODEL = "demo-synthesiser"

// Every demo video id starts with this. It is the only marker the cleanup path
// needs: the child tables all hang off analysed_videos by foreign key, so the
// set of demo videos is the set of demo everything.
export const DEMO_VIDEO_ID_PREFIX = "demo_"

// A YouTube video id is 11 characters, and several surfaces build URLs out of
// one, so demo ids keep that width. They are not valid YouTube ids, which is
// deliberate: a stats refresh that reaches YouTube with one gets nothing back
// and leaves the seeded numbers exactly as they are (see
// lib/analysed-video-stats.ts).
export function demoVideoId(slug: string): string {
  const body = slug.replace(/[^a-z0-9]/g, "").slice(0, 6).padEnd(6, "0")
  return `${DEMO_VIDEO_ID_PREFIX}${body}`
}

export function isDemoVideoId(videoId: string): boolean {
  return videoId.startsWith(DEMO_VIDEO_ID_PREFIX)
}

// One synthesized event, before it has a window row to hang off.
export interface DemoEvent {
  eventIndex: number
  eventType: RetentionWindowEventType
  timestampSeconds: number
  narrative: string
  primaryEvidence: "editing" | "visual" | "audio" | "transcript" | "combined"
  confidence: number
}

// The events belonging to one window, addressed the way the window itself is
// (kind plus index) because the window's row id does not exist until it has
// been inserted.
export interface DemoWindowEvents {
  kind: RetentionWindow["kind"]
  windowIndex: number
  events: DemoEvent[]
}

export interface DemoVideoPayload {
  videoId: string
  title: string
  publishedAt: string
  dateAnalysed: string
  videoDetails: VideoDetails
  retention: RetentionPoint[]
  transcript: TranscriptCue[]
  analyticsSummary: VideoAnalyticsSummary
  packagingAlignment: PackagingAlignment
  scriptTaxonomy: ScriptTaxonomy
  retentionAttribution: RetentionAttribution
  pacing: PacingAnalysis
  windows: RetentionWindow[]
  windowEvents: DemoWindowEvents[]
  // Only some of a library is ever deep-analysed, because deep credits cost
  // money. A video that is not deep-analysed has no source file and no
  // synthesized events, which is also what makes the trends page's "N of your M
  // videos" wording show a real fraction rather than always reading N of N.
  deepAnalysed: boolean
  // What the seeded upload weighed, for the source-file row.
  sourceFileBytes: number
}

// --- the retention curve -----------------------------------------------------

// Samples per curve. YouTube reports audience retention in percentage-point
// buckets, so 101 points from 0 to 1 is the real resolution, not a choice.
const CURVE_POINTS = 101

interface CurveFeature {
  // Where the feature starts, as a share of the video elapsed.
  at: number
  // How many samples it runs over.
  steps: number
  // Signed change in watch ratio across it.
  change: number
}

// Builds one video's curve: a steep opening decay, a slow baseline decline, and
// a handful of deliberate features (sharp drops, small gains) laid over it. The
// stretches between features are close enough to flat that the hold detector
// finds something, which is what a real curve looks like too.
function buildRetentionCurve(
  concept: DemoVideoConcept,
  rng: Rng,
): RetentionPoint[] {
  const { durationSeconds, retention: quality } = concept

  // Where the opening decay bottoms out, and where the curve ends up. Both
  // scale with the concept's retention dial so the library has a genuine spread
  // for the trends page to split into bands.
  const hookEnd = 0.5 + 0.32 * quality
  const finalRatio = Math.min(hookEnd - 0.08, 0.16 + 0.34 * quality)
  // The opening decay is over within the first 6 to 9 percent of the runtime.
  const hookEndIndex = rng.int(6, 9)

  // Two or three sharp drops and one or two gains, placed in the body of the
  // video and kept away from each other so a detector reads them separately.
  const features: CurveFeature[] = []
  const dropCount = rng.int(2, 3)
  const gainCount = rng.int(1, 2)
  const slots = rng.sample([18, 28, 38, 48, 58, 68, 78, 88], dropCount + gainCount)
  slots.sort((a, b) => a - b)
  slots.forEach((slot, index) => {
    const isGain = index >= dropCount
    features.push({
      at: slot,
      steps: rng.int(2, 3),
      // A gain has to clear both the detector's per-step floor and its total,
      // so it is deliberately punchier than a drop of the same nominal size.
      change: isGain
        ? rng.round(0.05, 0.08, 4)
        : -rng.round(0.04, 0.08, 4),
    })
  })

  // Whatever the features do not account for is spread evenly across the rest
  // of the curve as the baseline decline.
  const featureTotal = features.reduce((sum, feature) => sum + feature.change, 0)
  const baselineSteps = CURVE_POINTS - 1 - hookEndIndex
  const baselineTotal = finalRatio - hookEnd - featureTotal
  const baselinePerStep = baselineTotal / baselineSteps

  const points: RetentionPoint[] = []
  let watchRatio = 1
  for (let index = 0; index < CURVE_POINTS; index += 1) {
    if (index > 0 && index <= hookEndIndex) {
      // The opening decay is front-loaded: most of it happens in the first
      // couple of samples, which is what makes the Initial Hook window the
      // steepest stretch of almost every real video. Set rather than
      // accumulated, so the opening lands exactly on hookEnd however many
      // samples it was spread over.
      const progress = index / hookEndIndex
      watchRatio = 1 + (hookEnd - 1) * (1 - (1 - progress) ** 0.45)
    } else if (index > hookEndIndex) {
      watchRatio += baselinePerStep
      for (const feature of features) {
        if (index > feature.at && index <= feature.at + feature.steps) {
          watchRatio += feature.change / feature.steps
        }
      }
    }

    const elapsedRatio = Math.round((index / (CURVE_POINTS - 1)) * 100) / 100
    const clamped = Math.min(1, Math.max(0.02, watchRatio))
    watchRatio = clamped
    points.push({
      elapsedRatio,
      watchRatio: Math.round(clamped * 10000) / 10000,
      // YouTube's 0..1 read of this video against others of similar length.
      // Correlated with the concept's retention dial, jittered per sample so a
      // window average is not the same number every time.
      relativePerformance:
        Math.round(
          Math.min(
            0.97,
            Math.max(0.05, 0.2 + 0.6 * quality + rng.float(-0.06, 0.06)),
          ) * 10000,
        ) / 10000,
      timestampSeconds:
        Math.round(elapsedRatio * durationSeconds * 100) / 100,
    })
  }

  return points
}

// --- the transcript ----------------------------------------------------------

// Roughly one spoken line every few seconds, drawn from the pool that matches
// where in the runtime the line lands. Long enough that the attribution's
// minimum word count is met for every window, which is what a real transcript
// has to clear too.
function buildTranscript(
  concept: DemoVideoConcept,
  rng: Rng,
): TranscriptCue[] {
  const cues: TranscriptCue[] = []
  const { durationSeconds } = concept
  let startSeconds = 0

  while (startSeconds < durationSeconds - 2) {
    const length = rng.round(3.5, 6.5, 2)
    const endSeconds = Math.min(durationSeconds, startSeconds + length)
    const elapsed = startSeconds / durationSeconds
    const pool =
      elapsed < 0.06
        ? DEMO_TRANSCRIPT_LINES.opening
        : elapsed < 0.18
          ? DEMO_TRANSCRIPT_LINES.setup
          : elapsed < 0.75
            ? DEMO_TRANSCRIPT_LINES.middle
            : elapsed < 0.93
              ? DEMO_TRANSCRIPT_LINES.payoff
              : DEMO_TRANSCRIPT_LINES.closing
    cues.push({
      startSeconds: Math.round(startSeconds * 100) / 100,
      endSeconds: Math.round(endSeconds * 100) / 100,
      text: rng.pick(pool),
    })
    startSeconds = endSeconds + rng.round(0.1, 0.9, 2)
  }

  return cues
}

// --- the analytics snapshot --------------------------------------------------

const TRAFFIC_SOURCE_CODES = [
  "SUBSCRIBER",
  "RELATED_VIDEO",
  "YT_SEARCH",
  "NOTIFICATION",
  "EXT_URL",
  "YT_CHANNEL",
] as const

function buildAnalyticsSummary(
  concept: DemoVideoConcept,
  ageDays: number,
  fetchedAt: string,
  rng: Rng,
): VideoAnalyticsSummary {
  const views = Math.round(
    (400 + concept.reach * 46_000) * (0.35 + Math.min(1, ageDays / 45)),
  )
  const averageViewPercentage =
    Math.round((22 + concept.retention * 42 + rng.float(-3, 3)) * 100) / 100
  const averageViewDurationSeconds = Math.round(
    (concept.durationSeconds * averageViewPercentage) / 100,
  )

  // Split the views across sources, weighted so a high-reach video leans on
  // browse and suggested (the packaging-driven surfaces the trends page reads)
  // and a low-reach one leans on subscribers and search.
  const weights = [
    0.18 + concept.reach * 0.24,
    0.12 + concept.reach * 0.26,
    0.3 - concept.reach * 0.18,
    0.14,
    0.06,
    0.08,
  ]
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  const trafficSources = TRAFFIC_SOURCE_CODES.map((source, index) => ({
    source,
    views: Math.max(1, Math.round((views * weights[index]) / weightTotal)),
  })).sort((a, b) => b.views - a.views)

  const impressions = Math.round(views * rng.float(7, 16))

  return {
    views,
    estimatedMinutesWatched: Math.round(
      (views * averageViewDurationSeconds) / 60,
    ),
    averageViewDurationSeconds,
    averageViewPercentage,
    likes: Math.round(views * rng.float(0.02, 0.06)),
    comments: Math.round(views * rng.float(0.002, 0.008)),
    shares: Math.round(views * rng.float(0.001, 0.005)),
    subscribersGained: Math.round(
      views * rng.float(0.001, 0.004) * (0.4 + concept.retention),
    ),
    subscribersLost: Math.round(views * rng.float(0.0001, 0.0009)),
    impressions,
    impressionClickThroughRate:
      Math.round((0.02 + concept.reach * 0.07) * 10000) / 10000,
    trafficSources,
    fetchedAt,
    reachAttemptedAt: fetchedAt,
    trafficSourcesFetchedAt: fetchedAt,
  }
}

// --- the taxonomies ----------------------------------------------------------

// A 0-10 ordinal correlated with a 0..1 dial, so a video that reached further
// really does score higher on the axes packaging is judged on. Jittered, or
// every high-reach video would carry an identical profile and the contrast the
// trends page reports would be an artefact of this function.
function ordinal(dial: number, rng: Rng, spread = 2.5): number {
  const centre = 1.5 + dial * 7
  return Math.min(10, Math.max(0, Math.round(centre + rng.float(-spread, spread))))
}

function buildPackagingTaxonomy(
  concept: DemoVideoConcept,
  generatedAt: string,
  rng: Rng,
): PackagingTaxonomy {
  const reach = concept.reach
  return {
    titleStyles: rng.sample(TITLE_STYLES, rng.int(1, 2)),
    thumbnailHasFace: rng.bool(0.3 + reach * 0.5),
    thumbnailEmotion: rng.pick(THUMBNAIL_EMOTIONS),
    thumbnailTextWordCount: rng.int(0, 5),
    promiseType: rng.pick(PROMISE_TYPES),
    hookDelivery: rng.pick(HOOK_DELIVERIES),
    alignmentScore: ordinal(concept.retention, rng, 1.5),
    topics: concept.topics,
    schemaVersion: PACKAGING_TAXONOMY_SCHEMA_VERSION,
    model: DEMO_MODEL,
    generatedAt,
    detail: {
      title: {
        specificity: ordinal(reach, rng),
        curiosityGap: ordinal(reach, rng),
        emotionalCharge: ordinal(reach, rng),
        emotionalValence: rng.pick(EMOTIONAL_VALENCES),
        stakes: ordinal(reach, rng),
        personalFraming: rng.pick(PERSONAL_FRAMINGS),
        relatability: ordinal(reach, rng),
        novelty: ordinal(reach, rng),
        clarity: ordinal(reach, rng),
        targetIdentity: "hobby woodworkers setting up a small home shop",
        concreteAnchors: rng.sample(
          ["a whole sheet of plywood", "5 joints", "£40 vs £300", "30 days"],
          rng.int(1, 2),
        ),
        powerDevices: rng.sample(POWER_DEVICES, rng.int(0, 3)),
        characterLength: concept.title.length,
      },
      thumbnail: {
        faceProminence: ordinal(reach, rng),
        eyeContact: rng.bool(0.4 + reach * 0.4),
        emotionIntensity: ordinal(reach, rng),
        sceneType: rng.pick(SCENE_TYPES),
        mood: rng.pick(THUMBNAIL_MOODS),
        colorContrast: ordinal(reach, rng),
        visualComplexity: rng.int(2, 9),
        textVerbatim: rng.pick([
          "WHOLE SHEET",
          "DO NOT DO THIS",
          "£40 vs £300",
          "",
          "5 JOINTS",
        ]),
        impliedPromise:
          "You will see exactly what went wrong and what to do instead.",
      },
      hook: {
        openingType: rng.pick(OPENING_TYPES),
        payoffSpeed: ordinal(concept.retention, rng),
        restatesPromise: ordinal(concept.retention, rng),
        stakesEstablished: ordinal(concept.retention, rng),
        personalDisclosure: rng.int(0, 10),
        specificity: ordinal(concept.retention, rng),
        genericFiller: rng.bool(0.5 - concept.retention * 0.35),
        firstSentence: "Right, so this went wrong in a way I did not expect.",
      },
      cross: {
        titleThumbnailMatch: ordinal(concept.retention, rng, 1.8),
        hookDeliversPromise: ordinal(concept.retention, rng, 1.8),
        singleClearPromise:
          "Show the mistake, then show the setup change that prevents it.",
        contradiction: rng.bool(0.15),
        contradictionNote: "",
      },
      drivers: {
        clickDrivers: rng.sample(CLICK_DRIVERS, rng.int(1, 3)),
        primaryDriver: rng.pick(CLICK_DRIVERS),
        archetype: rng.pick(PACKAGING_ARCHETYPES),
        trendRelevance: ordinal(reach, rng),
        trendRelevanceConfidence: rng.round(0.3, 0.9, 2),
      },
    },
  }
}

function buildPackagingAlignment(
  concept: DemoVideoConcept,
  generatedAt: string,
  rng: Rng,
): PackagingAlignment {
  const copy = DEMO_PACKAGING_COPY
  return {
    overall: rng.pick(copy.overall),
    components: {
      // Each summary is the short characterisation the component tab uses as
      // its subtitle, so these stay to a handful of words.
      title: {
        summary: rng.pick([
          "One promise, clear stake",
          "Specific, slightly overlong",
          "Direct claim, strong number",
        ]),
        whatWorked: rng.sample(copy.titleWorked, 2),
        whatCouldBeBetter: rng.sample(copy.titleBetter, 1),
        examples: [],
      },
      thumbnail: {
        summary: rng.pick([
          "Readable subject, redundant text",
          "High contrast, busy frame",
          "Single subject, calm mood",
        ]),
        whatWorked: rng.sample(copy.thumbnailWorked, 2),
        whatCouldBeBetter: rng.sample(copy.thumbnailBetter, 1),
        examples: [],
      },
      hook: {
        summary: rng.pick([
          "Fast confirmation, slow setup",
          "Direct delivery, clear stake",
          "Delayed payoff, generic opening",
        ]),
        whatWorked: rng.sample(copy.hookWorked, 2),
        whatCouldBeBetter: rng.sample(copy.hookBetter, 1),
        examples: [],
      },
    },
    taxonomy: buildPackagingTaxonomy(concept, generatedAt, rng),
    model: DEMO_MODEL,
    generatedAt,
  }
}

function buildScriptTaxonomy(
  concept: DemoVideoConcept,
  transcript: TranscriptCue[],
  generatedAt: string,
  rng: Rng,
): ScriptTaxonomy {
  const wordCount = transcript.reduce(
    (total, cue) => total + cue.text.split(/\s+/).length,
    0,
  )
  const segmentCount = rng.int(3, 7)
  const segments = Array.from({ length: segmentCount }, (_, index) => ({
    approxStartSeconds: Math.round(
      (concept.durationSeconds / segmentCount) * index,
    ),
    label: rng.pick([
      "the mistake",
      "setting up the cut",
      "first attempt",
      "what went wrong",
      "the fix",
      "side by side",
      "what i would do next time",
    ]),
  }))

  return {
    format: rng.pick(SCRIPT_FORMATS),
    oneLineSummary: concept.description,
    segments,
    topics: concept.topics,
    wordCount,
    schemaVersion: SCRIPT_TAXONOMY_SCHEMA_VERSION,
    model: DEMO_MODEL,
    generatedAt,
    detail: {
      structure: {
        segmentCount,
        topicCohesion: ordinal(concept.retention, rng),
        openLoops: ordinal(concept.retention, rng),
        payoffPlacement: rng.int(0, 10),
        hasCta: rng.bool(0.7),
      },
      substance: {
        substanceDensity: ordinal(concept.retention, rng),
        concreteness: ordinal(concept.retention, rng),
        noveltyOfIdeas: ordinal(concept.reach, rng),
        educationalValue: ordinal(concept.retention, rng),
        entertainmentValue: ordinal(concept.reach, rng),
        fillerLevel: ordinal(1 - concept.retention, rng),
      },
      emotion: {
        dominantEmotion: rng.pick(DOMINANT_EMOTIONS),
        energy: ordinal(concept.reach, rng),
        emotionalRange: ordinal(concept.retention, rng),
        arcShape: rng.pick(ARC_SHAPES),
        vulnerability: rng.int(0, 10),
      },
      humor: {
        humorDensity: rng.int(0, 8),
        humorStyle: rng.bool(0.7) ? rng.pick(HUMOR_STYLES) : null,
      },
      rhetoric: {
        narrativeVoice: rng.pick(NARRATIVE_VOICES),
        directAddress: ordinal(concept.retention, rng),
        persuasionDevices: rng.sample(PERSUASION_DEVICES, rng.int(1, 3)),
        stakes: ordinal(concept.reach, rng),
        relatability: ordinal(concept.reach, rng),
      },
      drivers: {
        scriptArchetype: rng.pick(SCRIPT_ARCHETYPES),
        primaryEngagementDriver: rng.pick(ENGAGEMENT_DRIVERS),
      },
    },
  }
}

// --- retention attribution ---------------------------------------------------

function buildRetentionAttribution(
  windows: RetentionWindow[],
  generatedAt: string,
  rng: Rng,
): RetentionAttribution {
  const moments: RetentionMomentAttribution[] = windows.map((window) => {
    const source = rng.pick(DEMO_ATTRIBUTION_MOMENTS)
    const hasTip = source.tip != null
    return {
      kind: window.kind,
      windowIndex: window.windowIndex,
      fromSeconds: window.fromSeconds,
      toSeconds: window.toSeconds,
      explanation: source.explanation,
      tip: source.tip,
      tipExamples: [],
      // The warrant gate keeps anything under 0.6, so a stored tip always
      // carries a score above it and a silent moment always carries zero.
      tipWarrant: hasTip ? rng.round(0.62, 0.95, 2) : 0,
      confidence: rng.round(0.45, 0.92, 2),
    }
  })

  return {
    schemaVersion: RETENTION_ATTRIBUTION_SCHEMA_VERSION,
    overview:
      "The opening holds better than the channel average, and most of what is lost afterwards goes in two places: a long silent working stretch, and the point where the script leaves its first comparison unfinished.",
    moments,
    model: DEMO_MODEL,
    generatedAt,
  }
}

// --- synthesized events ------------------------------------------------------

const EVENT_TYPES: RetentionWindowEventType[] = [
  "scene_cut",
  "topic_shift",
  "visual_change",
  "audio_change",
  "pacing_change",
  "on_screen_text_change",
  "other",
]

const EVIDENCE_SOURCES = [
  "editing",
  "visual",
  "audio",
  "transcript",
  "combined",
] as const

// Which event types a window kind tends to produce.
//
// The weighting is the whole reason the trends page has anything to say. It
// ranks a pattern on how LOPSIDED it is between kinds: the signature is a
// per-type drop-versus-gain share, and a playbook rule only fires when a type
// covers a much larger share of one kind's videos than of another's. A library
// where every kind drew uniformly from the vocabulary would compute a signature
// of nothing and an empty playbook, which is a demo of the page's empty state
// rather than of the page. So each kind gets types the others barely touch.
const EVENT_TYPE_WEIGHTS: Record<
  RetentionWindow["kind"],
  Partial<Record<RetentionWindowEventType, number>>
> = {
  hook: { scene_cut: 3, topic_shift: 2, on_screen_text_change: 2 },
  drop_off: { topic_shift: 5, audio_change: 3, pacing_change: 1, other: 1 },
  gain: { on_screen_text_change: 4, visual_change: 3, scene_cut: 2 },
  hold: { pacing_change: 4, visual_change: 2 },
}

function weightedEventType(
  kind: RetentionWindow["kind"],
  rng: Rng,
): RetentionWindowEventType {
  const weights = EVENT_TYPE_WEIGHTS[kind]
  const pool: RetentionWindowEventType[] = []
  for (const type of EVENT_TYPES) {
    for (let count = 0; count < (weights[type] ?? 0); count += 1) {
      pool.push(type)
    }
  }
  return pool.length > 0 ? rng.pick(pool) : rng.pick(EVENT_TYPES)
}

function buildWindowEvents(
  windows: RetentionWindow[],
  rng: Rng,
): DemoWindowEvents[] {
  return windows.map((window) => {
    const count = rng.int(1, 3)
    const span = Math.max(1, window.toSeconds - window.fromSeconds)
    const events: DemoEvent[] = Array.from({ length: count }, (_, index) => {
      const eventType = weightedEventType(window.kind, rng)
      return {
        eventIndex: index,
        eventType,
        timestampSeconds:
          Math.round(
            (window.fromSeconds + (span * (index + 0.5)) / count) * 100,
          ) / 100,
        narrative: rng.pick(DEMO_EVENT_NARRATIVES[eventType]),
        primaryEvidence: rng.pick(EVIDENCE_SOURCES),
        // Gains and holds read a little more confidently than drops, which is
        // what the real synthesizer tends to produce: something that visibly
        // happened is easier to stand behind than an absence.
        confidence: rng.round(
          window.kind === "drop_off" ? 0.42 : 0.55,
          0.95,
          2,
        ),
      }
    })
    return { kind: window.kind, windowIndex: window.windowIndex, events }
  })
}

// --- pacing ------------------------------------------------------------------

function buildPacing(
  concept: DemoVideoConcept,
  transcript: TranscriptCue[],
  generatedAt: string,
  rng: Rng,
): PacingAnalysis {
  const minutes = Math.max(1, Math.floor(concept.durationSeconds / 60))
  const windows: PacingWindow[] = []

  windows.push({
    id: "hook",
    label: "Hook",
    kind: "hook",
    startSeconds: 0,
    endSeconds: 30,
    wordCount: rng.int(70, 110),
    wordsPerMinute: rng.round(150, 190, 1),
    role: "Sets up the mistake and promises the fix.",
    pace: "fast",
    informationDensity: "high",
    progression: "strong",
    pacingChange: "stable",
    evidence: [transcript[0]?.text ?? "Right, so this went wrong."],
    possibleIssue: null,
    confidence: rng.round(0.6, 0.95, 2),
  })

  for (let minute = 0; minute < minutes; minute += 1) {
    const wordsPerMinute = rng.round(105, 175, 1)
    const slow = wordsPerMinute < 125
    windows.push({
      id: `minute-${minute + 1}`,
      label: `Minute ${minute + 1}`,
      kind: "minute",
      startSeconds: minute * 60,
      endSeconds: Math.min(concept.durationSeconds, (minute + 1) * 60),
      wordCount: Math.round(wordsPerMinute),
      wordsPerMinute,
      role: rng.pick([
        "Works through the setup.",
        "Demonstrates the cut.",
        "Compares the two results.",
        "Explains why the first attempt failed.",
        "Wraps the section and moves on.",
      ]),
      pace: slow ? rng.pick(["very_slow", "slow"] as const) : rng.pick(["moderate", "fast"] as const),
      informationDensity: slow ? "low" : rng.pick(["moderate", "high"] as const),
      progression: slow
        ? rng.pick(["stalled", "limited"] as const)
        : rng.pick(["steady", "strong"] as const),
      pacingChange: rng.pick([
        "decelerating",
        "stable",
        "accelerating",
        "mixed",
      ] as const),
      evidence: [rng.pick(DEMO_TRANSCRIPT_LINES.middle)],
      possibleIssue: slow
        ? "Word rate drops well below the rest of the video here."
        : null,
      confidence: rng.round(0.5, 0.92, 2),
    })
  }

  const stretches = rng
    .sample(DEMO_PACING_STRETCHES, rng.int(1, 2))
    .map((stretch) => {
      const startSeconds = rng.int(
        60,
        Math.max(61, Math.floor(concept.durationSeconds * 0.8)),
      )
      return {
        startSeconds,
        endSeconds: startSeconds + rng.int(25, 70),
        reason: stretch.reason,
        suggestion: stretch.suggestion,
        examples: [],
      }
    })

  return {
    overallPacing: rng.pick([
      "Fast through the opening, then noticeably slower across the middle third before recovering into the close.",
      "Even for most of its runtime, with one long quiet stretch in the working sequence.",
      "Consistently quick, occasionally at the cost of leaving a measurement unexplained.",
    ]),
    videoWidePatterns: rng.sample(DEMO_PACING_PATTERNS, rng.int(2, 3)),
    notableTransitions: Array.from({ length: rng.int(1, 3) }, () => ({
      atSeconds: rng.int(30, Math.max(31, concept.durationSeconds - 30)),
      description: rng.pick([
        "The edit tightens sharply as the comparison begins.",
        "Narration stops for the length of the glue up.",
        "The pace lifts into the side by side reveal.",
      ]),
    })).sort((a, b) => a.atSeconds - b.atSeconds),
    slowOrRepetitiveStretches: stretches,
    windows,
    model: DEMO_MODEL,
    generatedAt,
  }
}

// --- the whole video ---------------------------------------------------------

// How far apart, in days, consecutive demo uploads are published. A real
// channel does not upload on a perfect cadence, so this is a base the generator
// jitters around.
const DAYS_BETWEEN_UPLOADS = 11

export interface BuildDemoVideoOptions {
  concept: DemoVideoConcept
  // Zero-based, oldest first. Drives the publish date and the seed.
  index: number
  // How many videos are in this library, so the oldest lands furthest back.
  total: number
  // Stable per-user seed, so re-seeding the same account reproduces it.
  seedKey: string
  now: Date
  deepAnalysed: boolean
}

export function buildDemoVideo(
  options: BuildDemoVideoOptions,
): DemoVideoPayload {
  const { concept, index, total, seedKey, now, deepAnalysed } = options
  const rng = new Rng(`${seedKey}:${concept.slug}`)

  const ageDays =
    (total - 1 - index) * DAYS_BETWEEN_UPLOADS + rng.int(0, 5) + 2
  const publishedAt = new Date(
    now.getTime() - ageDays * 24 * 60 * 60 * 1000,
  ).toISOString()
  // Analysed a few days after publishing, which is when a creator actually
  // looks: early enough to be recent, late enough for the curve to settle.
  const analysedAgeDays = Math.max(0, ageDays - rng.int(1, 4))
  const dateAnalysed = new Date(
    now.getTime() - analysedAgeDays * 24 * 60 * 60 * 1000,
  ).toISOString()
  const fetchedAt = now.toISOString()

  const retention = buildRetentionCurve(concept, rng)
  const transcript = buildTranscript(concept, rng)
  const analyticsSummary = buildAnalyticsSummary(concept, ageDays, fetchedAt, rng)
  const windows = buildRetentionWindows(retention, concept.durationSeconds)

  const videoDetails: VideoDetails = {
    id: demoVideoId(concept.slug),
    title: concept.title,
    channelId: DEMO_CHANNEL_ID,
    publishedAt,
    durationSeconds: concept.durationSeconds,
    // Demo videos carry no thumbnail on purpose. The only image hosts the app
    // is configured for are YouTube's, and a demo row has no real video behind
    // it to borrow one from, so every thumbnail slot renders its placeholder.
    thumbnailUrl: null,
    description: concept.description,
    viewCount: analyticsSummary.views,
    commentCount: analyticsSummary.comments,
    privacyStatus: "public",
    statisticsFetchedAt: fetchedAt,
  }

  return {
    videoId: videoDetails.id,
    title: concept.title,
    publishedAt,
    dateAnalysed,
    videoDetails,
    retention,
    transcript,
    analyticsSummary,
    packagingAlignment: buildPackagingAlignment(concept, dateAnalysed, rng),
    scriptTaxonomy: buildScriptTaxonomy(concept, transcript, dateAnalysed, rng),
    retentionAttribution: buildRetentionAttribution(windows, dateAnalysed, rng),
    pacing: buildPacing(concept, transcript, dateAnalysed, rng),
    windows,
    windowEvents: deepAnalysed ? buildWindowEvents(windows, rng) : [],
    deepAnalysed,
    sourceFileBytes: Math.round(
      concept.durationSeconds * rng.float(2_400_000, 5_200_000),
    ),
  }
}
