import type { ComponentType } from "react"
import {
  AlignHorizontalJustifyCenterIcon,
  CrosshairIcon,
  ImageIcon,
  RadarIcon,
  ShapesIcon,
  SlidersHorizontalIcon,
  TypeIcon,
} from "lucide-react"

import { packagingFeatureLabel } from "@/components/channel-trends-copy"
import { PackagingSurfaceTabs } from "@/components/channel-trends-packaging-tabs"
import {
  TrendCard,
  formatRate,
  plural,
} from "@/components/channel-trends-shared"
import {
  AxisContrastCard,
  ExtremesRadarCard,
  StyleProfileCard,
} from "@/components/channel-trends-taxonomy"
import { HookIcon } from "@/components/hook-icon"
import {
  ALIGNMENT_PART_LABEL,
  PackagingAlignmentScore,
} from "@/components/packaging-alignment-score"
import {
  axisGroupRows,
  extremeGroupAxes,
  type ChannelAlignmentAverage,
  type PackagingAxisGroup,
} from "@/lib/channel-taxonomy-trends"
import type {
  ChannelTrendsData,
  PackagingFeatureContrast,
} from "@/lib/channel-trends"

// The Packaging tab: what your uploads promise, and what that promise earns,
// read one surface at a time. It splits into the same four surfaces a single
// video's packaging report and the packaging head-to-head use, in the order a
// viewer meets them:
//
//   Hook       your first ten seconds, and whether they cash the promise
//   Title      the words that make the click
//   Thumbnail  the image that makes it
//   Alignment  how tightly those three promise the same one thing
//
// Every surface reads the same three ways: where its axes separate the halves
// of your library, the same axes drawn as one shape per band at the two ends of
// it, and the categorical fingerprint of what you repeat. Alignment opens on
// the library's average alignment score, the one number a creator already knows
// from a single video's report.
//
// Everything here is correlational by construction and the copy says so: reach
// is also topic, timing and who YouTube showed a video to, and a library is a
// handful of uploads made by one person.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

// One packaging trait that splits the two reach bands: how many videos in each
// half carried it. Both counts are shown, because "4 of 5 against 1 of 5" is
// the whole claim and a single number would hide half of it.
function FeatureContrastRow({ row }: { row: PackagingFeatureContrast }) {
  const bar = (count: number, total: number) => (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-muted-foreground/50"
        style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }}
      />
    </div>
  )
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <span className="text-sm font-medium">
        {packagingFeatureLabel(row.feature)}
      </span>
      <div className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-x-2">
        <span className="text-xs text-muted-foreground">high reach</span>
        {bar(row.highCount, row.highTotal)}
        <span className="text-right text-xs tabular-nums">
          {row.highCount}/{row.highTotal}
        </span>
      </div>
      <div className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-x-2">
        <span className="text-xs text-muted-foreground">low reach</span>
        {bar(row.lowCount, row.lowTotal)}
        <span className="text-right text-xs tabular-nums">
          {row.lowCount}/{row.lowTotal}
        </span>
      </div>
    </div>
  )
}

function FeatureContrastCard({
  features,
  title,
  description,
}: {
  features: PackagingFeatureContrast[]
  title: string
  description: string
}) {
  if (features.length === 0) return null
  return (
    <TrendCard icon={ShapesIcon} title={title} description={description}>
      <div className="divide-y">
        {features.map((row) => (
          <FeatureContrastRow key={row.feature} row={row} />
        ))}
      </div>
    </TrendCard>
  )
}

// --- Average alignment -------------------------------------------------------

// The alignment readout, averaged across the library, and the first thing the
// Alignment surface says. Deliberately the same block a single video's report
// and the packaging head-to-head render
// (components/packaging-alignment-score.tsx), tint included, so the number a
// creator already knows from one video reads as the same number here. It is the
// one tinted block among this page's neutral bars, and that is the point: it is
// one object shown in three places, not a fourth chart.
function AverageAlignmentCard({
  alignment,
}: {
  alignment: ChannelAlignmentAverage
}) {
  const over = `Averaged across ${plural(alignment.videoCount, "analysed video")}.`
  return (
    <TrendCard
      icon={CrosshairIcon}
      title="Your average alignment"
      description="The alignment score off every video report, averaged across your library."
      footer={
        alignment.partVideoCount > 0 &&
        alignment.partVideoCount < alignment.videoCount
          ? `${over} The two rows under the score cover the ${alignment.partVideoCount} carrying an enriched packaging read.`
          : over
      }
    >
      <PackagingAlignmentScore
        score={alignment.score}
        parts={alignment.parts.map((part) => ({
          label: ALIGNMENT_PART_LABEL[part.key],
          value: part.value,
        }))}
      />
    </TrendCard>
  )
}

// --- The four surfaces -------------------------------------------------------

export type PackagingSurface = "hook" | "title" | "thumbnail" | "alignment"

interface SurfaceConfig {
  // The taxonomy axis group this surface is scored on. The opening's axes are
  // grouped as "opening" in the taxonomy and called the hook everywhere a
  // creator meets them, which is what the tab is named.
  group: PackagingAxisGroup
  // The categorical dimensions that describe this surface.
  dimensionKeys: string[]
  // The prefixes of the flat feature flags that belong to it. A v1 packaging
  // read carries no axes, so these flags are all an early library has.
  featurePrefixes: string[]
  icon: ComponentType<{ className?: string }>
  axisTitle: string
  axisDescription: string
  axisEmptyNote: string
  extremesTitle: string
  extremesDescription: string
  extremesEmptyNote: string
  featuresTitle: string
  featuresDescription: string
  styleTitle: string
  styleDescription: string
}

const SURFACE_ORDER: PackagingSurface[] = [
  "hook",
  "title",
  "thumbnail",
  "alignment",
]

const AXIS_DESCRIPTION_TAIL =
  "each video judged on its own. These are the axes where your high-reach half and your low-reach half genuinely separate."

const EXTREMES_DESCRIPTION_TAIL =
  "scored on the three uploads that reached furthest, the three that reached least, and your whole library as a baseline. Where the solid shape sits outside the dashed one, your winners pushed harder on that axis, and the dotted line says whether that is unusual for you."

const FEATURES_DESCRIPTION_TAIL =
  "Correlation, not proof: reach is also topic, timing and who YouTube showed it to."

const STYLE_DESCRIPTION_TAIL =
  "Repetition is not a fault: a recognisable channel is built on it. What matters is whether the thing you repeat is the thing that reaches."

const SURFACE_CONFIG: Record<PackagingSurface, SurfaceConfig> = {
  hook: {
    group: "opening",
    dimensionKeys: ["packaging.openingType"],
    featurePrefixes: ["hook"],
    icon: HookIcon,
    axisTitle: "How your openings score",
    axisDescription: `Every first ten seconds is scored on the same 0-10 axes, ${AXIS_DESCRIPTION_TAIL}`,
    axisEmptyNote:
      "Your two reach halves open alike on every axis so far. Open the profile below to see where your openings sit overall.",
    extremesTitle: "Your best and worst openings, side by side",
    extremesDescription: `The opening axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "Your best and worst uploads open alike on every axis so far. When the two ends of your library start opening differently, the gap lands here.",
    featuresTitle: "What your high-reach openings do differently",
    featuresDescription: `How quickly the opening reaches the promise in the half of your library that travels furthest, against the half that does not. ${FEATURES_DESCRIPTION_TAIL}`,
    styleTitle: "Your opening fingerprint",
    styleDescription: `How you open, and how each way performed. ${STYLE_DESCRIPTION_TAIL}`,
  },
  title: {
    group: "title",
    dimensionKeys: ["packaging.titleStyle"],
    featurePrefixes: ["title"],
    icon: TypeIcon,
    axisTitle: "How your titles score",
    axisDescription: `Every title is scored on the same 0-10 axes, ${AXIS_DESCRIPTION_TAIL}`,
    axisEmptyNote:
      "Your two reach halves title alike on every axis so far. Open the profile below to see where your titles sit overall.",
    extremesTitle: "Your best and worst titles, side by side",
    extremesDescription: `The title axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "Your best and worst uploads title alike on every axis so far. When the two ends of your library start writing titles differently, the gap lands here.",
    featuresTitle: "What your high-reach titles do differently",
    featuresDescription: `The title shapes common in the half of your library that travels furthest and rare in the half that does not. ${FEATURES_DESCRIPTION_TAIL}`,
    styleTitle: "Your title fingerprint",
    styleDescription: `The title shapes you reach for, and how each one performed. ${STYLE_DESCRIPTION_TAIL}`,
  },
  thumbnail: {
    group: "thumbnail",
    dimensionKeys: ["packaging.thumbnailMood"],
    featurePrefixes: ["thumb"],
    icon: ImageIcon,
    axisTitle: "How your thumbnails score",
    axisDescription: `Every thumbnail is scored on the same 0-10 axes, ${AXIS_DESCRIPTION_TAIL}`,
    axisEmptyNote:
      "Your two reach halves shoot thumbnails alike on every axis so far. Open the profile below to see where your thumbnails sit overall.",
    extremesTitle: "Your best and worst thumbnails, side by side",
    extremesDescription: `The thumbnail axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "Your best and worst uploads shoot thumbnails alike on every axis so far. When the two ends of your library start looking different, the gap lands here.",
    featuresTitle: "What your high-reach thumbnails do differently",
    featuresDescription: `The thumbnail choices common in the half of your library that travels furthest and rare in the half that does not. ${FEATURES_DESCRIPTION_TAIL}`,
    styleTitle: "Your thumbnail fingerprint",
    styleDescription: `The mood you keep shooting, and how each one performed. ${STYLE_DESCRIPTION_TAIL}`,
  },
  alignment: {
    group: "alignment",
    dimensionKeys: ["packaging.archetype", "packaging.primaryDriver"],
    featurePrefixes: ["alignment", "promise"],
    icon: AlignHorizontalJustifyCenterIcon,
    axisTitle: "How tightly your packaging aligns",
    axisDescription:
      "The two cross-surface axes, scored on every video: whether the title and thumbnail promise the same one thing, and whether the opening cashes it. These are the axes where your high-reach half and your low-reach half genuinely separate.",
    axisEmptyNote:
      "Your two reach halves align alike on both axes so far. Open the profile below to see where your packaging sits overall.",
    extremesTitle: "Your best and worst uploads on alignment",
    extremesDescription:
      "The two cross-surface axes, scored on the three uploads that reached furthest, the three that reached least, and your whole library as a baseline.",
    extremesEmptyNote:
      "Your best and worst uploads align alike on both axes so far. When the two ends of your library start promising differently, the gap lands here.",
    featuresTitle: "What your high-reach packaging promises differently",
    featuresDescription: `The promises and the alignment bands common in the half of your library that travels furthest and rare in the half that does not. ${FEATURES_DESCRIPTION_TAIL}`,
    styleTitle: "Your packaging fingerprint",
    styleDescription: `The kind of promise you make across all three surfaces, and what earns the click, with how each one performed. ${STYLE_DESCRIPTION_TAIL}`,
  },
}

function surfaceFeatures(
  data: ChannelTrendsData,
  surface: PackagingSurface,
): PackagingFeatureContrast[] {
  const prefixes = SURFACE_CONFIG[surface].featurePrefixes
  return (data.packaging?.features ?? []).filter((row) =>
    prefixes.includes(row.feature.split(":")[0]),
  )
}

// Whether a surface has anything at all to show. Checked before the tab bar is
// built, so an empty surface is dropped rather than rendered as a heading over
// nothing.
function surfaceHasContent(
  data: ChannelTrendsData,
  surface: PackagingSurface,
): boolean {
  const config = SURFACE_CONFIG[surface]
  return (
    (surface === "alignment" && data.packagingAlignment != null) ||
    (data.packagingAxes != null &&
      axisGroupRows(data.packagingAxes, config.group).length > 0) ||
    (data.packagingExtremes != null &&
      extremeGroupAxes(data.packagingExtremes, config.group).length > 0) ||
    (data.packagingStyle?.dimensions ?? []).some((dimension) =>
      config.dimensionKeys.includes(dimension.key),
    ) ||
    surfaceFeatures(data, surface).length > 0
  )
}

// What the outer tab bar asks before it offers a Packaging tab at all.
export function packagingPanelHasContent(data: ChannelTrendsData): boolean {
  return SURFACE_ORDER.some((surface) => surfaceHasContent(data, surface))
}

function SurfacePanel({
  data,
  surface,
}: {
  data: ChannelTrendsData
  surface: PackagingSurface
}) {
  const config = SURFACE_CONFIG[surface]
  return (
    <div className="flex flex-col gap-3">
      {surface === "alignment" && data.packagingAlignment != null && (
        <AverageAlignmentCard alignment={data.packagingAlignment} />
      )}
      {data.packagingAxes != null && (
        <AxisContrastCard
          profile={data.packagingAxes}
          group={config.group}
          icon={SlidersHorizontalIcon}
          title={config.axisTitle}
          description={config.axisDescription}
          topLabel="high reach"
          bottomLabel="low reach"
          emptyNote={config.axisEmptyNote}
        />
      )}
      {data.packagingExtremes != null && (
        <ExtremesRadarCard
          profile={data.packagingExtremes}
          group={config.group}
          icon={RadarIcon}
          title={config.extremesTitle}
          description={config.extremesDescription}
          topLabel="top 3 by reach"
          bottomLabel="bottom 3 by reach"
          libraryLabel="library average"
          formatOutcome={(value) => `${formatRate(value)}/day`}
          emptyNote={config.extremesEmptyNote}
        />
      )}
      <FeatureContrastCard
        features={surfaceFeatures(data, surface)}
        title={config.featuresTitle}
        description={config.featuresDescription}
      />
      {data.packagingStyle != null && (
        <StyleProfileCard
          profile={data.packagingStyle}
          dimensionKeys={config.dimensionKeys}
          icon={config.icon}
          title={config.styleTitle}
          description={config.styleDescription}
          outcomeNoun="reach"
        />
      )}
    </div>
  )
}

export function PackagingPanel({ data }: { data: ChannelTrendsData }) {
  const body = (surface: PackagingSurface) =>
    surfaceHasContent(data, surface) ? (
      <SurfacePanel data={data} surface={surface} />
    ) : undefined

  // The tab this panel fills is offered on the same question, so an empty
  // library never reaches here. Guarded anyway, so the panel can never render
  // as a bare tab bar over nothing.
  if (!packagingPanelHasContent(data)) return null

  return (
    <PackagingSurfaceTabs
      hook={body("hook")}
      title={body("title")}
      thumbnail={body("thumbnail")}
      alignment={body("alignment")}
    />
  )
}
