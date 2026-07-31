// The packaging head-to-head: two library videos diffed on their stored
// packaging taxonomies, with NO model call at comparison time. Every field the
// diff reads was scored once, per video, in isolation at analysis time
// (lib/packaging-taxonomy.ts); comparison is pure arithmetic and set logic
// over those absolute reads, which is what lets it run instantly and for free
// on any pair. The output is three layers: a ranked "biggest differences"
// list that tells the story, the full per-surface field-by-field diff, and the
// verbatim spans (real titles, thumbnail text, opening lines) side by side.
// Each side also carries the whole spoken first ten seconds, cut out of the
// stored transcript, so the report's hook surface can quote the hook in full
// rather than a single sentence off the taxonomy.
//
// Everything degrades: the v1 taxonomy (flat fields) still yields the title
// styles, promise, hook delivery and alignment diffs even when the enriched
// `detail` block is absent on one or both sides. Rows whose data one side
// lacks are simply omitted rather than faked.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included) - it feeds the Channel Trends compare surface. Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { PackagingTaxonomy } from "@/lib/packaging-taxonomy"
import { transcriptForSegment, type TranscriptCue } from "@/lib/youtube/youtube"

// The opening window the head-to-head argues about, in seconds. Same bounds as
// HOOK_EVIDENCE_FROM_SECONDS / HOOK_EVIDENCE_TO_SECONDS in
// lib/packaging-comparison-evidence.ts, restated here so this pure diff module
// does not pull in that module's Supabase and media dependencies. Kept in step
// with it: the two must always describe the same ten seconds.
const HOOK_TRANSCRIPT_FROM_SECONDS = 0
const HOOK_TRANSCRIPT_TO_SECONDS = 10

// ---------------------------------------------------------------------------
// Types

export type ComparisonSurface =
  | "title"
  | "thumbnail"
  | "hook"
  | "cross"
  | "drivers"
  | "overall"

export const SURFACE_LABEL: Record<ComparisonSurface, string> = {
  title: "Title",
  thumbnail: "Thumbnail",
  hook: "Opening / hook",
  cross: "Cross-surface",
  drivers: "What pulls the click",
  overall: "Overall",
}

export type Side = "a" | "b"

export interface PackagingComparisonSide {
  id: string
  title: string | null
  // The real thumbnail, so the surface the report argues about is on screen
  // next to the argument. Null when the video was analysed before thumbnails
  // were captured.
  thumbnailUrl: string | null
  views: number | null
  // Everything spoken in the first ten seconds, verbatim, cut out of the
  // video's stored transcript. This is the hook itself, so the report's hook
  // surface quotes it in full rather than the taxonomy's single opening line.
  // Null when the video has no transcript, or none of it lands in the window.
  hookTranscript: string | null
  hasTaxonomy: boolean
  hasDetail: boolean
}

// One 0-10 axis (or the alignment score scaled to 0-10) with both reads and
// their signed gap (a - b). Null when a side did not capture the axis.
export interface OrdinalComparisonRow {
  key: string
  label: string
  surface: ComparisonSurface
  // "higher" means a higher score generally pulls more clicks, so the gap can
  // be oriented toward a side; "neutral" axes are descriptive only.
  direction: "higher" | "neutral"
  a: number | null
  b: number | null
  delta: number | null
}

// One categorical axis: the pretty-printed values each side carries, and the
// set breakdown so the UI can show shared traits apart from the distinctive
// ones.
export interface CategoricalComparisonRow {
  key: string
  label: string
  surface: ComparisonSurface
  a: string[] | null
  b: string[] | null
  shared: string[]
  onlyA: string[]
  onlyB: string[]
  match: boolean
}

export interface FlagComparisonRow {
  key: string
  label: string
  surface: ComparisonSurface
  a: boolean | null
  b: boolean | null
  // Which side holds the favourable value, when both are captured.
  favours: Side | "both" | "neither" | null
}

export interface SpanComparisonRow {
  key: string
  label: string
  surface: ComparisonSurface
  a: string
  b: string
}

export interface PackagingHighlight {
  key: string
  label: string
  surface: ComparisonSurface
  kind: "ordinal" | "categorical" | "flag"
  // A deterministic, human-readable statement of the difference.
  detail: string
  // Ranking weight; larger sorts first.
  magnitude: number
  favours: Side | "neither"
}

export interface PackagingComparison {
  a: PackagingComparisonSide
  b: PackagingComparisonSide
  // The side with more views, for orientation. Null when views are unknown or
  // tied.
  higherViewsSide: Side | null
  detailCoverage: "both" | "one" | "none"
  ordinals: OrdinalComparisonRow[]
  categoricals: CategoricalComparisonRow[]
  flags: FlagComparisonRow[]
  spans: SpanComparisonRow[]
  // The ranked story: the differences most worth reading first.
  highlights: PackagingHighlight[]
}

export interface PackagingComparisonInput {
  id: string
  title: string | null
  thumbnailUrl: string | null
  views: number | null
  // The whole video's cue list, from which the opening ten seconds are cut.
  // Empty for a video whose transcript was never captured.
  transcript: TranscriptCue[]
  taxonomy: PackagingTaxonomy | null
}

// ---------------------------------------------------------------------------
// Labels

// Turns a snake_case enum token into readable words: "first_person_confession"
// becomes "first person confession". Deterministic, so the diff never needs a
// model to phrase itself.
export function prettyToken(token: string): string {
  const spaced = token.replace(/_/g, " ").trim()
  if (spaced.length === 0) return spaced
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function prettyList(tokens: string[]): string[] {
  return tokens.map(prettyToken)
}

// ---------------------------------------------------------------------------
// Axis descriptors: label + surface + how to read the value off a taxonomy,
// each degrading to null when its source is absent. One table per layer keeps
// the labels and the extraction in a single place.

interface OrdinalDescriptor {
  key: string
  label: string
  surface: ComparisonSurface
  direction: "higher" | "neutral"
  get: (taxonomy: PackagingTaxonomy) => number | null
}

const ORDINAL_AXES: OrdinalDescriptor[] = [
  // Overall (present on every taxonomy, v1 included).
  {
    key: "overall.alignment",
    label: "Title / thumbnail / hook alignment",
    surface: "overall",
    direction: "higher",
    get: (t) => Math.round(t.alignmentScore * 10),
  },
  // Title.
  {
    key: "title.specificity",
    label: "Specificity",
    surface: "title",
    direction: "higher",
    get: (t) => t.detail?.title.specificity ?? null,
  },
  {
    key: "title.curiosityGap",
    label: "Curiosity gap",
    surface: "title",
    direction: "higher",
    get: (t) => t.detail?.title.curiosityGap ?? null,
  },
  {
    key: "title.emotionalCharge",
    label: "Emotional charge",
    surface: "title",
    direction: "higher",
    get: (t) => t.detail?.title.emotionalCharge ?? null,
  },
  {
    key: "title.stakes",
    label: "Stakes",
    surface: "title",
    direction: "higher",
    get: (t) => t.detail?.title.stakes ?? null,
  },
  {
    key: "title.relatability",
    label: "Relatability",
    surface: "title",
    direction: "higher",
    get: (t) => t.detail?.title.relatability ?? null,
  },
  {
    key: "title.novelty",
    label: "Novelty",
    surface: "title",
    direction: "higher",
    get: (t) => t.detail?.title.novelty ?? null,
  },
  {
    key: "title.clarity",
    label: "Clarity of payoff",
    surface: "title",
    direction: "higher",
    get: (t) => t.detail?.title.clarity ?? null,
  },
  // Thumbnail.
  {
    key: "thumbnail.faceProminence",
    label: "Face prominence",
    surface: "thumbnail",
    direction: "higher",
    get: (t) => t.detail?.thumbnail.faceProminence ?? null,
  },
  {
    key: "thumbnail.emotionIntensity",
    label: "Expression intensity",
    surface: "thumbnail",
    direction: "higher",
    get: (t) => t.detail?.thumbnail.emotionIntensity ?? null,
  },
  {
    key: "thumbnail.colorContrast",
    label: "Colour contrast",
    surface: "thumbnail",
    direction: "higher",
    get: (t) => t.detail?.thumbnail.colorContrast ?? null,
  },
  {
    key: "thumbnail.visualComplexity",
    label: "Visual complexity",
    surface: "thumbnail",
    direction: "neutral",
    get: (t) => t.detail?.thumbnail.visualComplexity ?? null,
  },
  // Hook.
  {
    key: "hook.payoffSpeed",
    label: "Payoff speed",
    surface: "hook",
    direction: "higher",
    get: (t) => t.detail?.hook.payoffSpeed ?? null,
  },
  {
    key: "hook.restatesPromise",
    label: "Restates the promise",
    surface: "hook",
    direction: "higher",
    get: (t) => t.detail?.hook.restatesPromise ?? null,
  },
  {
    key: "hook.stakesEstablished",
    label: "Stakes established",
    surface: "hook",
    direction: "higher",
    get: (t) => t.detail?.hook.stakesEstablished ?? null,
  },
  {
    key: "hook.personalDisclosure",
    label: "Personal disclosure",
    surface: "hook",
    direction: "higher",
    get: (t) => t.detail?.hook.personalDisclosure ?? null,
  },
  {
    key: "hook.specificity",
    label: "Opening specificity",
    surface: "hook",
    direction: "higher",
    get: (t) => t.detail?.hook.specificity ?? null,
  },
  // Cross-surface.
  {
    key: "cross.titleThumbnailMatch",
    label: "Title / thumbnail match",
    surface: "cross",
    direction: "higher",
    get: (t) => t.detail?.cross.titleThumbnailMatch ?? null,
  },
  {
    key: "cross.hookDeliversPromise",
    label: "Hook delivers the promise",
    surface: "cross",
    direction: "higher",
    get: (t) => t.detail?.cross.hookDeliversPromise ?? null,
  },
  // Drivers.
  {
    key: "drivers.trendRelevance",
    label: "Trend relevance",
    surface: "drivers",
    direction: "higher",
    get: (t) => t.detail?.drivers.trendRelevance ?? null,
  },
]

interface CategoricalDescriptor {
  key: string
  label: string
  surface: ComparisonSurface
  // Null when the side did not capture this axis; an array (possibly empty)
  // when it did.
  get: (taxonomy: PackagingTaxonomy) => string[] | null
}

const CATEGORICAL_AXES: CategoricalDescriptor[] = [
  {
    key: "title.styles",
    label: "Title style",
    surface: "title",
    get: (t) => t.titleStyles,
  },
  {
    key: "title.personalFraming",
    label: "Framing",
    surface: "title",
    get: (t) => (t.detail ? [t.detail.title.personalFraming] : null),
  },
  {
    key: "title.emotionalValence",
    label: "Emotional tone",
    surface: "title",
    get: (t) => (t.detail ? [t.detail.title.emotionalValence] : null),
  },
  {
    key: "title.powerDevices",
    label: "Power devices",
    surface: "title",
    get: (t) => t.detail?.title.powerDevices ?? null,
  },
  {
    key: "promise.type",
    label: "Promise",
    surface: "cross",
    get: (t) => [t.promiseType],
  },
  {
    key: "thumbnail.emotion",
    label: "Thumbnail emotion",
    surface: "thumbnail",
    get: (t) => (t.thumbnailEmotion ? [t.thumbnailEmotion] : []),
  },
  {
    key: "thumbnail.sceneType",
    label: "Scene",
    surface: "thumbnail",
    get: (t) => (t.detail ? [t.detail.thumbnail.sceneType] : null),
  },
  {
    key: "thumbnail.mood",
    label: "Mood",
    surface: "thumbnail",
    get: (t) => (t.detail ? [t.detail.thumbnail.mood] : null),
  },
  {
    key: "hook.delivery",
    label: "Hook delivery",
    surface: "hook",
    get: (t) => [t.hookDelivery],
  },
  {
    key: "hook.openingType",
    label: "Opening type",
    surface: "hook",
    get: (t) => (t.detail ? [t.detail.hook.openingType] : null),
  },
  {
    key: "drivers.primary",
    label: "Primary driver",
    surface: "drivers",
    get: (t) => (t.detail ? [t.detail.drivers.primaryDriver] : null),
  },
  {
    key: "drivers.clickDrivers",
    label: "Click drivers",
    surface: "drivers",
    get: (t) => t.detail?.drivers.clickDrivers ?? null,
  },
  {
    key: "drivers.archetype",
    label: "Archetype",
    surface: "drivers",
    get: (t) => (t.detail ? [t.detail.drivers.archetype] : null),
  },
  {
    key: "topics",
    label: "Topics",
    surface: "overall",
    get: (t) => t.topics,
  },
]

interface FlagDescriptor {
  key: string
  label: string
  surface: ComparisonSurface
  get: (taxonomy: PackagingTaxonomy) => boolean | null
  // The value that reads as favourable for click-through.
  goodValue: boolean
  // Ranking weight when this flag differs between the two videos. A structural
  // fault (the surfaces contradicting) outranks the strongest single ordinal
  // gap; a cosmetic difference (eye contact) ranks well below one.
  highlightWeight: number
}

const FLAG_AXES: FlagDescriptor[] = [
  {
    key: "thumbnail.eyeContact",
    label: "Eye contact with viewer",
    surface: "thumbnail",
    get: (t) => t.detail?.thumbnail.eyeContact ?? null,
    goodValue: true,
    highlightWeight: 3,
  },
  {
    key: "hook.genericFiller",
    label: "Generic filler opening",
    surface: "hook",
    get: (t) => t.detail?.hook.genericFiller ?? null,
    goodValue: false,
    highlightWeight: 6,
  },
  {
    key: "cross.contradiction",
    label: "Surfaces contradict each other",
    surface: "cross",
    get: (t) => t.detail?.cross.contradiction ?? null,
    goodValue: false,
    highlightWeight: 11,
  },
]

const FLAG_HIGHLIGHT_WEIGHT_BY_KEY = new Map(
  FLAG_AXES.map((axis) => [axis.key, axis.highlightWeight]),
)

interface SpanDescriptor {
  key: string
  label: string
  surface: ComparisonSurface
  get: (taxonomy: PackagingTaxonomy) => string | null
}

const SPAN_AXES: SpanDescriptor[] = [
  {
    key: "title.targetIdentity",
    label: "Who it targets",
    surface: "title",
    get: (t) => t.detail?.title.targetIdentity ?? null,
  },
  {
    key: "title.concreteAnchors",
    label: "Concrete anchors",
    surface: "title",
    get: (t) => t.detail?.title.concreteAnchors.join(", ") ?? null,
  },
  {
    key: "thumbnail.textVerbatim",
    label: "Thumbnail text",
    surface: "thumbnail",
    get: (t) => t.detail?.thumbnail.textVerbatim ?? null,
  },
  {
    key: "thumbnail.impliedPromise",
    label: "What the image promises",
    surface: "thumbnail",
    get: (t) => t.detail?.thumbnail.impliedPromise ?? null,
  },
  {
    key: "hook.firstSentence",
    label: "Opening line",
    surface: "hook",
    get: (t) => t.detail?.hook.firstSentence ?? null,
  },
  {
    key: "cross.singleClearPromise",
    label: "The one promise",
    surface: "cross",
    get: (t) => t.detail?.cross.singleClearPromise ?? null,
  },
  {
    key: "cross.contradictionNote",
    label: "What contradicts",
    surface: "cross",
    get: (t) => t.detail?.cross.contradictionNote ?? null,
  },
]

// ---------------------------------------------------------------------------
// Diff builders

// Differences smaller than this on the 0-10 scale are noise, not story.
const ORDINAL_HIGHLIGHT_MIN_DELTA = 3
const MAX_HIGHLIGHTS = 6
// Fixed magnitudes so categorical and flag differences interleave sensibly
// with ordinal gaps in the ranked highlights.
const CATEGORICAL_HIGHLIGHT_WEIGHT = 4
// Fallback for a flag with no explicit weight in FLAG_AXES.
const FLAG_HIGHLIGHT_WEIGHT = 5

function ordinalRows(
  a: PackagingTaxonomy,
  b: PackagingTaxonomy,
): OrdinalComparisonRow[] {
  return ORDINAL_AXES.map((axis) => {
    const av = axis.get(a)
    const bv = axis.get(b)
    return {
      key: axis.key,
      label: axis.label,
      surface: axis.surface,
      direction: axis.direction,
      a: av,
      b: bv,
      delta: av != null && bv != null ? av - bv : null,
    }
  }).filter((row) => row.a != null || row.b != null)
}

function categoricalRows(
  a: PackagingTaxonomy,
  b: PackagingTaxonomy,
): CategoricalComparisonRow[] {
  return CATEGORICAL_AXES.map((axis) => {
    const av = axis.get(a)
    const bv = axis.get(b)
    const aSet = new Set(av ?? [])
    const bSet = new Set(bv ?? [])
    const shared = [...aSet].filter((v) => bSet.has(v))
    const onlyA = [...aSet].filter((v) => !bSet.has(v))
    const onlyB = [...bSet].filter((v) => !aSet.has(v))
    return {
      key: axis.key,
      label: axis.label,
      surface: axis.surface,
      a: av == null ? null : prettyList(av),
      b: bv == null ? null : prettyList(bv),
      shared: prettyList(shared),
      onlyA: prettyList(onlyA),
      onlyB: prettyList(onlyB),
      match: av != null && bv != null && onlyA.length === 0 && onlyB.length === 0,
    }
  }).filter((row) => row.a != null || row.b != null)
}

function flagFavours(
  descriptor: FlagDescriptor,
  a: boolean,
  b: boolean,
): Side | "both" | "neither" {
  if (a === b) return a === descriptor.goodValue ? "both" : "neither"
  return a === descriptor.goodValue ? "a" : "b"
}

function flagRows(
  a: PackagingTaxonomy,
  b: PackagingTaxonomy,
): FlagComparisonRow[] {
  return FLAG_AXES.map((axis) => {
    const av = axis.get(a)
    const bv = axis.get(b)
    return {
      key: axis.key,
      label: axis.label,
      surface: axis.surface,
      a: av,
      b: bv,
      favours: av != null && bv != null ? flagFavours(axis, av, bv) : null,
    }
  }).filter((row) => row.a != null || row.b != null)
}

function spanRows(
  a: PackagingTaxonomy,
  b: PackagingTaxonomy,
): SpanComparisonRow[] {
  return SPAN_AXES.map((axis) => ({
    key: axis.key,
    label: axis.label,
    surface: axis.surface,
    a: (axis.get(a) ?? "").trim(),
    b: (axis.get(b) ?? "").trim(),
  })).filter((row) => row.a.length > 0 || row.b.length > 0)
}

function buildHighlights(
  ordinals: OrdinalComparisonRow[],
  categoricals: CategoricalComparisonRow[],
  flags: FlagComparisonRow[],
): PackagingHighlight[] {
  const highlights: PackagingHighlight[] = []

  for (const row of ordinals) {
    if (row.delta == null || row.a == null || row.b == null) continue
    const magnitude = Math.abs(row.delta)
    if (magnitude < ORDINAL_HIGHLIGHT_MIN_DELTA) continue
    const favours: Side | "neither" =
      row.direction === "neutral" ? "neither" : row.a > row.b ? "a" : "b"
    highlights.push({
      key: row.key,
      label: row.label,
      surface: row.surface,
      kind: "ordinal",
      detail: `${row.label}: ${row.a} vs ${row.b} out of 10`,
      magnitude,
      favours,
    })
  }

  for (const row of categoricals) {
    if (row.a == null || row.b == null || row.match) continue
    if (row.onlyA.length === 0 && row.onlyB.length === 0) continue
    const magnitude =
      CATEGORICAL_HIGHLIGHT_WEIGHT + row.onlyA.length + row.onlyB.length - 1
    highlights.push({
      key: row.key,
      label: row.label,
      surface: row.surface,
      kind: "categorical",
      detail: `${row.label}: ${row.a.join(", ") || "none"} vs ${
        row.b.join(", ") || "none"
      }`,
      magnitude,
      favours: "neither",
    })
  }

  for (const row of flags) {
    if (row.favours == null || row.favours === "both" || row.favours === "neither") {
      continue
    }
    if (row.a === row.b) continue
    highlights.push({
      key: row.key,
      label: row.label,
      surface: row.surface,
      kind: "flag",
      detail: `${row.label}: only ${row.favours === "a" ? "B" : "A"} has it`,
      magnitude: FLAG_HIGHLIGHT_WEIGHT_BY_KEY.get(row.key) ?? FLAG_HIGHLIGHT_WEIGHT,
      favours: row.favours,
    })
  }

  return highlights
    .sort((x, y) => y.magnitude - x.magnitude || x.key.localeCompare(y.key))
    .slice(0, MAX_HIGHLIGHTS)
}

// The spoken opening, verbatim. Any cue overlapping the window is carried
// whole, so a sentence still running at the ten second mark is quoted to its
// end rather than cut mid-word; that is the same rule the stored hook evidence
// is clipped by, so the two never disagree about what was said.
function hookTranscriptFor(cues: TranscriptCue[]): string | null {
  const text = transcriptForSegment(
    cues,
    HOOK_TRANSCRIPT_FROM_SECONDS,
    HOOK_TRANSCRIPT_TO_SECONDS,
  ).trim()
  return text.length > 0 ? text : null
}

function sideFor(
  input: PackagingComparisonInput,
): PackagingComparisonSide {
  return {
    id: input.id,
    title: input.title,
    thumbnailUrl: input.thumbnailUrl,
    views: input.views,
    hookTranscript: hookTranscriptFor(input.transcript),
    hasTaxonomy: input.taxonomy != null,
    hasDetail: input.taxonomy?.detail != null,
  }
}

function higherViews(
  a: PackagingComparisonInput,
  b: PackagingComparisonInput,
): Side | null {
  if (a.views == null || b.views == null || a.views === b.views) return null
  return a.views > b.views ? "a" : "b"
}

// The pure diff: two videos in, one structured comparison out. Returns null
// only when neither video carries a taxonomy (nothing to compare); a single
// missing taxonomy still yields the identity and view context.
export function buildPackagingComparison(
  a: PackagingComparisonInput,
  b: PackagingComparisonInput,
): PackagingComparison | null {
  const sideA = sideFor(a)
  const sideB = sideFor(b)
  const base: PackagingComparison = {
    a: sideA,
    b: sideB,
    higherViewsSide: higherViews(a, b),
    detailCoverage:
      sideA.hasDetail && sideB.hasDetail
        ? "both"
        : sideA.hasDetail || sideB.hasDetail
          ? "one"
          : "none",
    ordinals: [],
    categoricals: [],
    flags: [],
    spans: [],
    highlights: [],
  }

  if (a.taxonomy == null || b.taxonomy == null) {
    // Nothing to diff without both taxonomies, but the identity and coverage
    // still tell the caller why the body is empty.
    return sideA.hasTaxonomy || sideB.hasTaxonomy ? base : null
  }

  const ordinals = ordinalRows(a.taxonomy, b.taxonomy)
  const categoricals = categoricalRows(a.taxonomy, b.taxonomy)
  const flags = flagRows(a.taxonomy, b.taxonomy)
  const spans = spanRows(a.taxonomy, b.taxonomy)

  return {
    ...base,
    ordinals,
    categoricals,
    flags,
    spans,
    highlights: buildHighlights(ordinals, categoricals, flags),
  }
}

// ---------------------------------------------------------------------------
// Loader

interface PackagingRow {
  id: string
  video_title: string | null
  thumbnail_url: string | null
  analytics_summary: { views?: number | null } | null
  transcript: TranscriptCue[] | null
  packaging_taxonomy: PackagingTaxonomy | null
}

// Loads the two videos' stored taxonomies (from the same
// packaging_alignment->taxonomy JSON path the channel trends page reads) plus
// their transcripts, from which each side's opening ten seconds is cut, and
// diffs them. Returns null when either video is missing or belongs to someone
// else (the user-scoped client cannot see it either way), or when neither
// carries a taxonomy.
export async function getPackagingComparison(
  supabase: SupabaseClient,
  userId: string,
  videoIdA: string,
  videoIdB: string,
): Promise<PackagingComparison | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select(
      "id, video_title, thumbnail_url:video_details->>thumbnailUrl, analytics_summary, transcript, packaging_taxonomy:packaging_alignment->taxonomy",
    )
    .eq("user_id", userId)
    .in("id", [videoIdA, videoIdB])

  if (error) {
    throw new Error(`Failed to load packaging comparison: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as PackagingRow[]
  const rowA = rows.find((row) => row.id === videoIdA)
  const rowB = rows.find((row) => row.id === videoIdB)
  if (!rowA || !rowB) return null

  const toInput = (row: PackagingRow): PackagingComparisonInput => ({
    id: row.id,
    title: row.video_title,
    thumbnailUrl: row.thumbnail_url,
    views: row.analytics_summary?.views ?? null,
    transcript: row.transcript ?? [],
    taxonomy: row.packaging_taxonomy,
  })

  return buildPackagingComparison(toInput(rowA), toInput(rowB))
}
