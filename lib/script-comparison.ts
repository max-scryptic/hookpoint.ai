// The script head-to-head: two library videos diffed on their stored script
// taxonomies, with NO model call at comparison time. Every field the diff reads
// was scored once, per video, in isolation at analysis time
// (lib/script-taxonomy.ts); comparison is pure arithmetic and set logic over
// those absolute reads, which is what lets it run instantly and for free on any
// pair. This is the script counterpart to lib/packaging-comparison.ts, and its
// output has the same three layers plus two script-specific extras: a ranked
// "biggest differences" list that tells the story, the full per-surface
// field-by-field diff, the raw content metrics (word count, segment count) side
// by side, and each video's topic map so the two can be read beat for beat.
//
// A missing taxonomy on one side is tolerated: the identity and metrics still
// render, and rows the missing side lacks are simply omitted rather than faked.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments included).
// Hyphens are fine.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ScriptSegment, ScriptTaxonomy } from "@/lib/script-taxonomy"

// ---------------------------------------------------------------------------
// Types

export type ScriptSurface =
  | "structure"
  | "substance"
  | "emotion"
  | "humor"
  | "rhetoric"
  | "overall"

export const SCRIPT_SURFACE_LABEL: Record<ScriptSurface, string> = {
  structure: "Structure",
  substance: "Substance",
  emotion: "Emotion & energy",
  humor: "Humour",
  rhetoric: "Rhetoric & voice",
  overall: "Overall",
}

export type Side = "a" | "b"

export interface ScriptComparisonSide {
  id: string
  title: string | null
  views: number | null
  hasTaxonomy: boolean
}

// Which way a higher score leans. "higher" means more of it generally pulls
// more engagement, "lower" means less of it does, and "neutral" axes are purely
// descriptive so the gap is never oriented toward a side.
export type OrdinalDirection = "higher" | "lower" | "neutral"

export interface OrdinalComparisonRow {
  key: string
  label: string
  surface: ScriptSurface
  direction: OrdinalDirection
  a: number | null
  b: number | null
  delta: number | null
}

// A raw count (not a 0-10 axis): word count, segment count. Rendered plainly
// rather than out of 10.
export interface MetricComparisonRow {
  key: string
  label: string
  surface: ScriptSurface
  a: number | null
  b: number | null
  delta: number | null
}

export interface CategoricalComparisonRow {
  key: string
  label: string
  surface: ScriptSurface
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
  surface: ScriptSurface
  a: boolean | null
  b: boolean | null
  favours: Side | "both" | "neither" | null
}

export interface SpanComparisonRow {
  key: string
  label: string
  surface: ScriptSurface
  a: string
  b: string
}

export interface ScriptHighlight {
  key: string
  label: string
  surface: ScriptSurface
  kind: "ordinal" | "categorical" | "flag"
  detail: string
  magnitude: number
  favours: Side | "neither"
}

export interface ScriptComparison {
  a: ScriptComparisonSide
  b: ScriptComparisonSide
  // The side with more views, for orientation. Null when unknown or tied.
  higherViewsSide: Side | null
  ordinals: OrdinalComparisonRow[]
  metrics: MetricComparisonRow[]
  categoricals: CategoricalComparisonRow[]
  flags: FlagComparisonRow[]
  spans: SpanComparisonRow[]
  // Each side's topic map, for a beat-for-beat strip in the UI.
  segments: { a: ScriptSegment[]; b: ScriptSegment[] }
  highlights: ScriptHighlight[]
}

export interface ScriptComparisonInput {
  id: string
  title: string | null
  views: number | null
  taxonomy: ScriptTaxonomy | null
}

// ---------------------------------------------------------------------------
// Labels

// Turns a snake_case enum token into readable words: "first_person_story"
// becomes "First person story". Deterministic, so the diff never needs a model
// to phrase itself.
export function prettyToken(token: string): string {
  const spaced = token.replace(/_/g, " ").trim()
  if (spaced.length === 0) return spaced
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function prettyList(tokens: string[]): string[] {
  return tokens.map(prettyToken)
}

// ---------------------------------------------------------------------------
// Axis descriptors

interface OrdinalDescriptor {
  key: string
  label: string
  surface: ScriptSurface
  direction: OrdinalDirection
  get: (taxonomy: ScriptTaxonomy) => number | null
}

const ORDINAL_AXES: OrdinalDescriptor[] = [
  // Structure.
  {
    key: "structure.topicCohesion",
    label: "Topic cohesion",
    surface: "structure",
    direction: "neutral",
    get: (t) => t.detail.structure.topicCohesion,
  },
  {
    key: "structure.openLoops",
    label: "Open loops",
    surface: "structure",
    direction: "higher",
    get: (t) => t.detail.structure.openLoops,
  },
  {
    key: "structure.payoffPlacement",
    label: "Payoff placement (front to back)",
    surface: "structure",
    direction: "neutral",
    get: (t) => t.detail.structure.payoffPlacement,
  },
  // Substance.
  {
    key: "substance.substanceDensity",
    label: "Substance density",
    surface: "substance",
    direction: "higher",
    get: (t) => t.detail.substance.substanceDensity,
  },
  {
    key: "substance.concreteness",
    label: "Concreteness",
    surface: "substance",
    direction: "higher",
    get: (t) => t.detail.substance.concreteness,
  },
  {
    key: "substance.noveltyOfIdeas",
    label: "Novelty of ideas",
    surface: "substance",
    direction: "higher",
    get: (t) => t.detail.substance.noveltyOfIdeas,
  },
  {
    key: "substance.educationalValue",
    label: "Educational value",
    surface: "substance",
    direction: "higher",
    get: (t) => t.detail.substance.educationalValue,
  },
  {
    key: "substance.entertainmentValue",
    label: "Entertainment value",
    surface: "substance",
    direction: "higher",
    get: (t) => t.detail.substance.entertainmentValue,
  },
  {
    key: "substance.fillerLevel",
    label: "Filler level",
    surface: "substance",
    direction: "lower",
    get: (t) => t.detail.substance.fillerLevel,
  },
  // Emotion.
  {
    key: "emotion.energy",
    label: "Energy",
    surface: "emotion",
    direction: "neutral",
    get: (t) => t.detail.emotion.energy,
  },
  {
    key: "emotion.emotionalRange",
    label: "Emotional range",
    surface: "emotion",
    direction: "higher",
    get: (t) => t.detail.emotion.emotionalRange,
  },
  {
    key: "emotion.vulnerability",
    label: "Vulnerability",
    surface: "emotion",
    direction: "higher",
    get: (t) => t.detail.emotion.vulnerability,
  },
  // Humour.
  {
    key: "humor.humorDensity",
    label: "Humour density",
    surface: "humor",
    direction: "neutral",
    get: (t) => t.detail.humor.humorDensity,
  },
  // Rhetoric.
  {
    key: "rhetoric.directAddress",
    label: "Direct address",
    surface: "rhetoric",
    direction: "neutral",
    get: (t) => t.detail.rhetoric.directAddress,
  },
  {
    key: "rhetoric.stakes",
    label: "Stakes",
    surface: "rhetoric",
    direction: "higher",
    get: (t) => t.detail.rhetoric.stakes,
  },
  {
    key: "rhetoric.relatability",
    label: "Relatability",
    surface: "rhetoric",
    direction: "higher",
    get: (t) => t.detail.rhetoric.relatability,
  },
]

interface MetricDescriptor {
  key: string
  label: string
  surface: ScriptSurface
  get: (taxonomy: ScriptTaxonomy) => number | null
}

const METRIC_AXES: MetricDescriptor[] = [
  {
    key: "overall.wordCount",
    label: "Word count",
    surface: "overall",
    get: (t) => t.wordCount,
  },
  {
    key: "structure.segmentCount",
    label: "Topic beats",
    surface: "structure",
    get: (t) => t.detail.structure.segmentCount,
  },
]

interface CategoricalDescriptor {
  key: string
  label: string
  surface: ScriptSurface
  get: (taxonomy: ScriptTaxonomy) => string[] | null
}

const CATEGORICAL_AXES: CategoricalDescriptor[] = [
  {
    key: "overall.format",
    label: "Format",
    surface: "overall",
    get: (t) => [t.format],
  },
  {
    key: "emotion.dominantEmotion",
    label: "Dominant emotion",
    surface: "emotion",
    get: (t) => [t.detail.emotion.dominantEmotion],
  },
  {
    key: "emotion.arcShape",
    label: "Emotional arc",
    surface: "emotion",
    get: (t) => [t.detail.emotion.arcShape],
  },
  {
    key: "humor.humorStyle",
    label: "Humour style",
    surface: "humor",
    get: (t) => (t.detail.humor.humorStyle ? [t.detail.humor.humorStyle] : []),
  },
  {
    key: "rhetoric.narrativeVoice",
    label: "Narrative voice",
    surface: "rhetoric",
    get: (t) => [t.detail.rhetoric.narrativeVoice],
  },
  {
    key: "rhetoric.persuasionDevices",
    label: "Persuasion devices",
    surface: "rhetoric",
    get: (t) => t.detail.rhetoric.persuasionDevices,
  },
  {
    key: "drivers.scriptArchetype",
    label: "Archetype",
    surface: "overall",
    get: (t) => [t.detail.drivers.scriptArchetype],
  },
  {
    key: "drivers.primaryEngagementDriver",
    label: "Primary driver",
    surface: "overall",
    get: (t) => [t.detail.drivers.primaryEngagementDriver],
  },
  {
    key: "overall.topics",
    label: "Topics",
    surface: "overall",
    get: (t) => t.topics,
  },
]

interface FlagDescriptor {
  key: string
  label: string
  surface: ScriptSurface
  get: (taxonomy: ScriptTaxonomy) => boolean | null
  goodValue: boolean
  highlightWeight: number
}

const FLAG_AXES: FlagDescriptor[] = [
  {
    key: "structure.hasCta",
    label: "Explicit call to action",
    surface: "structure",
    get: (t) => t.detail.structure.hasCta,
    goodValue: true,
    highlightWeight: 3,
  },
]

const FLAG_HIGHLIGHT_WEIGHT_BY_KEY = new Map(
  FLAG_AXES.map((axis) => [axis.key, axis.highlightWeight]),
)

interface SpanDescriptor {
  key: string
  label: string
  surface: ScriptSurface
  get: (taxonomy: ScriptTaxonomy) => string | null
}

const SPAN_AXES: SpanDescriptor[] = [
  {
    key: "overall.oneLineSummary",
    label: "What it is about",
    surface: "overall",
    get: (t) => t.oneLineSummary,
  },
]

// ---------------------------------------------------------------------------
// Diff builders

const ORDINAL_HIGHLIGHT_MIN_DELTA = 3
const MAX_HIGHLIGHTS = 6
const CATEGORICAL_HIGHLIGHT_WEIGHT = 4
const FLAG_HIGHLIGHT_WEIGHT = 5

function ordinalRows(
  a: ScriptTaxonomy,
  b: ScriptTaxonomy,
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

function metricRows(
  a: ScriptTaxonomy,
  b: ScriptTaxonomy,
): MetricComparisonRow[] {
  return METRIC_AXES.map((axis) => {
    const av = axis.get(a)
    const bv = axis.get(b)
    return {
      key: axis.key,
      label: axis.label,
      surface: axis.surface,
      a: av,
      b: bv,
      delta: av != null && bv != null ? av - bv : null,
    }
  }).filter((row) => row.a != null || row.b != null)
}

function categoricalRows(
  a: ScriptTaxonomy,
  b: ScriptTaxonomy,
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

function flagRows(a: ScriptTaxonomy, b: ScriptTaxonomy): FlagComparisonRow[] {
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

function spanRows(a: ScriptTaxonomy, b: ScriptTaxonomy): SpanComparisonRow[] {
  return SPAN_AXES.map((axis) => ({
    key: axis.key,
    label: axis.label,
    surface: axis.surface,
    a: (axis.get(a) ?? "").trim(),
    b: (axis.get(b) ?? "").trim(),
  })).filter((row) => row.a.length > 0 || row.b.length > 0)
}

// Which side a differing ordinal favours, honouring the axis direction. Neutral
// axes favour no one; "lower" axes (filler) favour the smaller value.
function ordinalFavours(
  direction: OrdinalDirection,
  a: number,
  b: number,
): Side | "neither" {
  if (direction === "neutral") return "neither"
  if (direction === "higher") return a > b ? "a" : "b"
  return a < b ? "a" : "b"
}

function buildHighlights(
  ordinals: OrdinalComparisonRow[],
  categoricals: CategoricalComparisonRow[],
  flags: FlagComparisonRow[],
): ScriptHighlight[] {
  const highlights: ScriptHighlight[] = []

  for (const row of ordinals) {
    if (row.delta == null || row.a == null || row.b == null) continue
    const magnitude = Math.abs(row.delta)
    if (magnitude < ORDINAL_HIGHLIGHT_MIN_DELTA) continue
    highlights.push({
      key: row.key,
      label: row.label,
      surface: row.surface,
      kind: "ordinal",
      detail: `${row.label}: ${row.a} vs ${row.b} out of 10`,
      magnitude,
      favours: ordinalFavours(row.direction, row.a, row.b),
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
    if (
      row.favours == null ||
      row.favours === "both" ||
      row.favours === "neither"
    ) {
      continue
    }
    if (row.a === row.b) continue
    highlights.push({
      key: row.key,
      label: row.label,
      surface: row.surface,
      kind: "flag",
      detail: `${row.label}: only ${row.favours === "a" ? "A" : "B"} has it`,
      magnitude: FLAG_HIGHLIGHT_WEIGHT_BY_KEY.get(row.key) ?? FLAG_HIGHLIGHT_WEIGHT,
      favours: row.favours,
    })
  }

  return highlights
    .sort((x, y) => y.magnitude - x.magnitude || x.key.localeCompare(y.key))
    .slice(0, MAX_HIGHLIGHTS)
}

function sideFor(input: ScriptComparisonInput): ScriptComparisonSide {
  return {
    id: input.id,
    title: input.title,
    views: input.views,
    hasTaxonomy: input.taxonomy != null,
  }
}

function higherViews(
  a: ScriptComparisonInput,
  b: ScriptComparisonInput,
): Side | null {
  if (a.views == null || b.views == null || a.views === b.views) return null
  return a.views > b.views ? "a" : "b"
}

// The pure diff: two videos in, one structured comparison out. Returns null
// only when neither video carries a taxonomy (nothing to compare); a single
// missing taxonomy still yields the identity and view context.
export function buildScriptComparison(
  a: ScriptComparisonInput,
  b: ScriptComparisonInput,
): ScriptComparison | null {
  const sideA = sideFor(a)
  const sideB = sideFor(b)
  const base: ScriptComparison = {
    a: sideA,
    b: sideB,
    higherViewsSide: higherViews(a, b),
    ordinals: [],
    metrics: [],
    categoricals: [],
    flags: [],
    spans: [],
    segments: {
      a: a.taxonomy?.segments ?? [],
      b: b.taxonomy?.segments ?? [],
    },
    highlights: [],
  }

  if (a.taxonomy == null || b.taxonomy == null) {
    return sideA.hasTaxonomy || sideB.hasTaxonomy ? base : null
  }

  const ordinals = ordinalRows(a.taxonomy, b.taxonomy)
  const metrics = metricRows(a.taxonomy, b.taxonomy)
  const categoricals = categoricalRows(a.taxonomy, b.taxonomy)
  const flags = flagRows(a.taxonomy, b.taxonomy)
  const spans = spanRows(a.taxonomy, b.taxonomy)

  return {
    ...base,
    ordinals,
    metrics,
    categoricals,
    flags,
    spans,
    highlights: buildHighlights(ordinals, categoricals, flags),
  }
}

// ---------------------------------------------------------------------------
// Loader

interface ScriptRow {
  id: string
  video_title: string | null
  analytics_summary: { views?: number | null } | null
  script_taxonomy: ScriptTaxonomy | null
}

// Loads the two videos' stored script taxonomies and diffs them. Returns null
// when either video is missing or belongs to someone else (the user-scoped
// client cannot see it either way), or when neither carries a taxonomy.
export async function getScriptComparison(
  supabase: SupabaseClient,
  userId: string,
  videoIdA: string,
  videoIdB: string,
): Promise<ScriptComparison | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select("id, video_title, analytics_summary, script_taxonomy")
    .eq("user_id", userId)
    .in("id", [videoIdA, videoIdB])

  if (error) {
    throw new Error(`Failed to load script comparison: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as ScriptRow[]
  const rowA = rows.find((row) => row.id === videoIdA)
  const rowB = rows.find((row) => row.id === videoIdB)
  if (!rowA || !rowB) return null

  const toInput = (row: ScriptRow): ScriptComparisonInput => ({
    id: row.id,
    title: row.video_title,
    views: row.analytics_summary?.views ?? null,
    taxonomy: row.script_taxonomy,
  })

  return buildScriptComparison(toInput(rowA), toInput(rowB))
}
