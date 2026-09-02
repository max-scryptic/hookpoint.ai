import { RadarIcon, ShapesIcon, TrophyIcon } from "lucide-react"

import { packagingFeatureLabel } from "@/components/channel-trends-copy"
import { PackagingSurfaceTabs } from "@/components/channel-trends-packaging-tabs"
import {
  TrendCard,
  formatCompactNumber,
} from "@/components/channel-trends-shared"
import {
  ExtremeBandsCard,
  ExtremesRadarCard,
} from "@/components/channel-trends-taxonomy"
import {
  extremeGroupAxes,
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
// The two bands every surface is read against are the same three uploads at
// each end of the library whichever tab is open, so they are named once above
// the tab bar rather than restated on all four charts. Under the bar, each
// surface draws its own axes as one shape per band, then lists what its
// high-reach half does differently. Alignment reads the same way as the other
// three: its two cross-surface axes are too few to enclose a shape, so they are
// drawn as paired bars rather than a spider, and nothing else is on the tab.
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
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-muted">
      <div
        className="h-full rounded-sm bg-muted-foreground/50"
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

// --- The four surfaces -------------------------------------------------------

export type PackagingSurface = "title" | "thumbnail" | "hook" | "alignment"

interface SurfaceConfig {
  // The taxonomy axis group this surface is scored on. The hook's axes are
  // still keyed as "opening" in the taxonomy, but the hook is called the hook
  // everywhere a creator meets it, which is what the tab is named.
  group: PackagingAxisGroup
  // The prefixes of the flat feature flags that belong to it. A v1 packaging
  // read carries no axes, so these flags are all an early library has.
  featurePrefixes: string[]
  extremesTitle: string
  extremesDescription: string
  extremesEmptyNote: string
  featuresTitle: string
  featuresDescription: string
}

// The tabs read in the order a viewer meets the three surfaces (title,
// thumbnail, hook), with alignment last because it is about the other three
// rather than a surface of its own. Same order as the packaging head-to-head
// (components/packaging-comparison.tsx) and a single video's report
// (components/analysed-video-detail.tsx).
const SURFACE_ORDER: PackagingSurface[] = [
  "title",
  "thumbnail",
  "hook",
  "alignment",
]

// What the two ends of the library are called, on the card that names them and
// on every chart drawn off them, so the legend under a radar reads as the list
// above the tab bar rather than as a second pair of bands.
const EXTREMES_TOP_LABEL = "top 3 by views"
const EXTREMES_BOTTOM_LABEL = "bottom 3 by views"

// The metric both bands are ranked and listed on, printed the way the rest of
// the page prints a view count.
const formatViews = (value: number) => `${formatCompactNumber(value)} views`

const EXTREMES_DESCRIPTION_TAIL =
  "scored on your three most-viewed uploads, your three least-viewed, and your whole library as a baseline."

const FEATURES_DESCRIPTION_TAIL =
  "Correlation, not proof: reach is also topic, timing and who YouTube showed it to."

const SURFACE_CONFIG: Record<PackagingSurface, SurfaceConfig> = {
  title: {
    group: "title",
    featurePrefixes: ["title"],
    extremesTitle: "Your best and worst titles, side by side",
    extremesDescription: `The title axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "Your best and worst uploads title alike on every axis so far. When the two ends of your library start writing titles differently, the gap lands here.",
    featuresTitle: "What your high-reach titles do differently",
    featuresDescription: `The title shapes common in the half of your library that travels furthest and rare in the half that does not. ${FEATURES_DESCRIPTION_TAIL}`,
  },
  thumbnail: {
    group: "thumbnail",
    featurePrefixes: ["thumb"],
    extremesTitle: "Your best and worst thumbnails, side by side",
    extremesDescription: `The thumbnail axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "Your best and worst uploads shoot thumbnails alike on every axis so far. When the two ends of your library start looking different, the gap lands here.",
    featuresTitle: "What your high-reach thumbnails do differently",
    featuresDescription: `The thumbnail choices common in the half of your library that travels furthest and rare in the half that does not. ${FEATURES_DESCRIPTION_TAIL}`,
  },
  hook: {
    group: "opening",
    featurePrefixes: ["hook"],
    extremesTitle: "Your best and worst hooks, side by side",
    extremesDescription: `The hook axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "Your best and worst uploads hook alike on every axis so far. When the two ends of your library start writing different hooks, the gap lands here.",
    featuresTitle: "What your high-reach hooks do differently",
    featuresDescription: `How quickly the hook reaches the promise in the half of your library that travels furthest, against the half that does not. ${FEATURES_DESCRIPTION_TAIL}`,
  },
  alignment: {
    group: "alignment",
    featurePrefixes: ["alignment", "promise"],
    extremesTitle: "Your best and worst uploads on alignment",
    extremesDescription: `The two cross-surface axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "Your best and worst uploads align alike on both axes so far. When the two ends of your library start promising differently, the gap lands here.",
    featuresTitle: "What your high-reach packaging promises differently",
    featuresDescription: `The promises and the alignment bands common in the half of your library that travels furthest and rare in the half that does not. ${FEATURES_DESCRIPTION_TAIL}`,
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
    (data.packagingExtremes != null &&
      extremeGroupAxes(data.packagingExtremes, config.group).length > 0) ||
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
      {data.packagingExtremes != null && (
        <ExtremesRadarCard
          profile={data.packagingExtremes}
          group={config.group}
          icon={RadarIcon}
          title={config.extremesTitle}
          description={config.extremesDescription}
          topLabel={EXTREMES_TOP_LABEL}
          bottomLabel={EXTREMES_BOTTOM_LABEL}
          libraryLabel="library average"
          emptyNote={config.extremesEmptyNote}
          // The bands and the caveat behind them are stated once above the tab
          // bar, so a surface card here is its heading, its chart and the axis
          // rows behind them, with no prose in between. That holds for the
          // alignment pair too: two axes are drawn as bars rather than a shape,
          // and the three bands on each bar are the reading.
          bare
        />
      )}
      <FeatureContrastCard
        features={surfaceFeatures(data, surface)}
        title={config.featuresTitle}
        description={config.featuresDescription}
      />
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

  // Only worth naming the bands above the bar when at least one surface below
  // it is actually scored on them, so a library read only on its feature flags
  // never gets a heading pointing at charts that are not there.
  const profile = data.packagingExtremes
  const extremes =
    profile != null &&
    SURFACE_ORDER.some(
      (surface) =>
        extremeGroupAxes(profile, SURFACE_CONFIG[surface].group).length > 0,
    )
      ? profile
      : null
  return (
    <div className="flex flex-col gap-3">
      {/* The two bands are picked once, off total views, and every chart under
          the tab bar is scored on them, so they are named here rather than four
          times over. */}
      {extremes != null && (
        <ExtremeBandsCard
          profile={extremes}
          icon={TrophyIcon}
          title="The uploads every chart below compares"
          description="Your three most-viewed uploads and your three least-viewed, ranked on total views. Each tab below scores this same pair of bands on its own axes."
          topLabel={EXTREMES_TOP_LABEL}
          bottomLabel={EXTREMES_BOTTOM_LABEL}
          formatOutcome={formatViews}
        />
      )}
      <PackagingSurfaceTabs
        title={body("title")}
        thumbnail={body("thumbnail")}
        hook={body("hook")}
        alignment={body("alignment")}
      />
    </div>
  )
}
