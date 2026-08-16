import type { ComponentType } from "react"
import { ChevronDownIcon } from "lucide-react"

import {
  taxonomyAxisCopy,
  taxonomyAxisGroupLabel,
  taxonomyCategoryLabel,
  taxonomyDimensionLabel,
} from "@/components/channel-trends-copy"
import {
  RADAR_MIN_AXES,
  RadarLegend,
  TaxonomyRadar,
} from "@/components/channel-trends-radar"
import {
  Chip,
  CoverageNote,
  ScoreBar,
  TrendCard,
  formatScore,
  plural,
} from "@/components/channel-trends-shared"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  axisGroupContrasts,
  axisGroupRows,
  axisIsDescriptor,
  axisLowerIsBetter,
  extremeGroupAxes,
  extremeGroupContrasts,
  type ChannelAxisProfile,
  type ChannelAxisRow,
  type ChannelExtremeAxisRow,
  type ChannelExtremeGroup,
  type ChannelExtremeVideo,
  type ChannelExtremesProfile,
  type ChannelStyleDimension,
  type ChannelStyleProfile,
  type TaxonomyAxisGroup,
} from "@/lib/channel-taxonomy-trends"

// The two views that render a taxonomy at channel level, shared by the
// Packaging tab (the packaging read, split on reach) and the Script tab (the
// script read, split on retention). Both taxonomies score every video on the
// same kind of material - closed vocabularies and 0-10 axes, each video judged
// on its own - so one pair of components can draw either.
//
//   AxisContrastCard  the axes where the better-performing half of the library
//                     separates from the worse half, plus the channel's own
//                     median on every axis behind a fold
//   ExtremesRadarCard the same axes at the ends of the library rather than its
//                     halves: the best few uploads against the worst few, drawn
//                     one shape per surface
//   ExtremeBandsCard  only the two named bands behind those shapes, for callers
//                     that draw several ExtremesRadarCards off one profile and
//                     want the video lists stated once above them
//   StyleProfileCard  what the channel repeats on each categorical dimension,
//                     and which of its choices performs unusually well
//
// Every card takes an optional `group`. Without one it reads the whole taxonomy
// at once, which is how the Script tab uses them; with one it reads a single
// surface, which is how the Packaging tab's Hook, Title, Thumbnail and
// Alignment sub-tabs use them. A card whose surface carries nothing renders
// nothing, so a sub-tab is never a frame around an empty card.
//
// Everything here is correlation. A library is a handful of videos made by one
// person, so a gap between its halves, or between its two ends, is a lead worth
// testing, never a law, and the copy says so on every card.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

// A 0-10 bar for one half of the split, with its band name and score.
function BandBar({
  label,
  value,
  emphasis,
}: {
  label: string
  value: number
  emphasis: boolean
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr_2rem] items-center gap-x-2">
      <span className="truncate text-xs whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${
            emphasis ? "bg-foreground/70" : "bg-muted-foreground/40"
          }`}
          style={{ width: `${Math.min(100, Math.max(0, value * 10))}%` }}
        />
      </div>
      <span className="text-right text-xs tabular-nums">
        {formatScore(value)}
      </span>
    </div>
  )
}

// The name of an axis and what a 10 on it would mean, so a bar is never a bare
// number the reader has to interpret, plus the notes that say when a high score
// is not simply a good one.
function AxisCaption({ axisKey }: { axisKey: string }) {
  const copy = taxonomyAxisCopy(axisKey)
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-sm font-medium">{copy.name}</span>
      <span className="text-xs text-muted-foreground">10 = {copy.meaning}</span>
      {axisIsDescriptor(axisKey) && (
        <span className="text-xs text-muted-foreground">
          (a descriptor, not a grade)
        </span>
      )}
      {axisLowerIsBetter(axisKey) && (
        <span className="text-xs text-muted-foreground">(less is more)</span>
      )}
    </div>
  )
}

// One axis, drawn as each band's score on it. The heavier bar is whichever of
// the two compared bands scored higher, so the reader sees the direction before
// reading a number; the library baseline, when there is one, is never the
// emphasised bar because it is the thing being measured against.
function BandContrastRow({
  axisKey,
  topLabel,
  topValue,
  bottomLabel,
  bottomValue,
  libraryLabel,
  libraryValue,
}: {
  axisKey: string
  topLabel: string
  topValue: number
  bottomLabel: string
  bottomValue: number
  libraryLabel?: string
  libraryValue?: number
}) {
  const topLeads = topValue >= bottomValue
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <AxisCaption axisKey={axisKey} />
      <div className="flex flex-col gap-1">
        <BandBar label={topLabel} value={topValue} emphasis={topLeads} />
        <BandBar label={bottomLabel} value={bottomValue} emphasis={!topLeads} />
        {libraryLabel != null && libraryValue != null && (
          <BandBar label={libraryLabel} value={libraryValue} emphasis={false} />
        )}
      </div>
    </div>
  )
}

// One axis where the two halves of the library separated.
function AxisContrastRow({
  row,
  topLabel,
  bottomLabel,
}: {
  row: ChannelAxisRow
  topLabel: string
  bottomLabel: string
}) {
  if (row.topMedian == null || row.bottomMedian == null) return null
  return (
    <BandContrastRow
      axisKey={row.key}
      topLabel={topLabel}
      topValue={row.topMedian}
      bottomLabel={bottomLabel}
      bottomValue={row.bottomMedian}
    />
  )
}

// The channel's own median on every axis it was asked for, grouped by surface.
// Folded away by default: it is a reference profile rather than a finding, and
// the contrast above it is what a reader came for. One surface's fold drops the
// group headings, because the card it sits in already names the surface.
function AxisProfileFold({
  profile,
  axes,
  label,
}: {
  profile: ChannelAxisProfile
  axes: ChannelAxisRow[]
  label: string
}) {
  const groups = [...new Set(axes.map((axis) => axis.group))]
  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 p-3 text-left text-sm font-medium">
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        {label}
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          every axis, median across {plural(profile.taxonomyVideoCount, "video")}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 border-t p-3">
        {groups.map((group) => (
          <div key={group} className="flex flex-col gap-2">
            {groups.length > 1 && (
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {taxonomyAxisGroupLabel(group)}
              </span>
            )}
            {axes
              .filter((axis) => axis.group === group)
              .map((axis) => (
                <div
                  key={axis.key}
                  className="grid grid-cols-[minmax(7rem,12rem)_1fr_2rem] items-center gap-x-3"
                >
                  <span
                    className="truncate text-sm"
                    title={`10 = ${taxonomyAxisCopy(axis.key).meaning}`}
                  >
                    {taxonomyAxisCopy(axis.key).name}
                  </span>
                  <ScoreBar value={axis.channelMedian} />
                  <span className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatScore(axis.channelMedian)}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function AxisContrastCard({
  profile,
  group,
  icon,
  title,
  description,
  topLabel,
  bottomLabel,
  emptyNote,
}: {
  profile: ChannelAxisProfile
  // One surface of the taxonomy, when the card belongs to a surface's own tab.
  // Absent reads every axis the profile carries.
  group?: TaxonomyAxisGroup
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  // What each half of the split is called, in the reader's terms.
  topLabel: string
  bottomLabel: string
  // What to say when the two halves scored alike on every axis.
  emptyNote: string
}) {
  const axes = group == null ? profile.axes : axisGroupRows(profile, group)
  const contrasts =
    group == null ? profile.contrasts : axisGroupContrasts(profile, group)
  if (axes.length === 0) return null

  return (
    <TrendCard
      icon={icon}
      title={title}
      description={description}
      footer={
        profile.contrastVideoCount > 0
          ? `Measured over the ${profile.contrastVideoCount} of your ${plural(profile.taxonomyVideoCount, "read video")} with the numbers to rank, split into halves of ${profile.bandSize}. Correlation, not proof: one creator, one library, a handful of uploads.`
          : `Read across ${plural(profile.taxonomyVideoCount, "video")}. A few more uploads with view counts and this splits into a high and a low half to compare.`
      }
    >
      {contrasts.length > 0 ? (
        <div className="divide-y">
          {contrasts.map((row) => (
            <AxisContrastRow
              key={row.key}
              row={row}
              topLabel={topLabel}
              bottomLabel={bottomLabel}
            />
          ))}
        </div>
      ) : (
        <CoverageNote>{emptyNote}</CoverageNote>
      )}
      <AxisProfileFold
        profile={profile}
        axes={axes}
        label={
          group == null
            ? "Your channel profile"
            : `Your ${taxonomyAxisGroupLabel(group).toLowerCase()} profile`
        }
      />
    </TrendCard>
  )
}

// --- The extremes, drawn as shapes -------------------------------------------

// The two bands, named. A creator recognises their own uploads faster than any
// bar, so the videos behind the shapes are listed before the shapes.
function ExtremeBandList({
  label,
  videos,
  formatOutcome,
}: {
  label: string
  videos: ChannelExtremeVideo[]
  formatOutcome: (value: number) => string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <ul className="flex flex-col gap-0.5">
        {videos.map((video) => (
          <li
            key={video.id}
            className="grid grid-cols-[1fr_auto] items-baseline gap-x-2"
            title={video.title ?? undefined}
          >
            <span className="truncate text-sm">
              {video.title ?? "Untitled video"}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatOutcome(video.outcome)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// The two bands, side by side. Split out of ExtremesRadarCard for callers that
// draw more than one chart off a single profile: the bands are a property of the
// library and its ranking, not of the axes being drawn, so repeating the lists
// over every chart would state the same two lists several times over.
function ExtremeBands({
  profile,
  topLabel,
  bottomLabel,
  formatOutcome,
}: {
  profile: ChannelExtremesProfile
  topLabel: string
  bottomLabel: string
  formatOutcome: (value: number) => string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ExtremeBandList
        label={topLabel}
        videos={profile.top}
        formatOutcome={formatOutcome}
      />
      <ExtremeBandList
        label={bottomLabel}
        videos={profile.bottom}
        formatOutcome={formatOutcome}
      />
    </div>
  )
}

// The two bands as a card of their own, for a caller that hoists them above a
// set of ExtremesRadarCards built from the same profile.
export function ExtremeBandsCard({
  profile,
  icon,
  title,
  description,
  topLabel,
  bottomLabel,
  formatOutcome,
  footer,
}: {
  profile: ChannelExtremesProfile
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  topLabel: string
  bottomLabel: string
  formatOutcome: (value: number) => string
  footer?: string
}) {
  if (profile.top.length === 0 && profile.bottom.length === 0) return null
  return (
    <TrendCard
      icon={icon}
      title={title}
      description={description}
      footer={footer}
    >
      <ExtremeBands
        profile={profile}
        topLabel={topLabel}
        bottomLabel={bottomLabel}
        formatOutcome={formatOutcome}
      />
    </TrendCard>
  )
}

// A run of axes written out as bars: the three sets on every axis, in the order
// the legend names them. Used wherever the shapes are not enough on their own,
// which is the alignment pair, the biggest separations, and the fold.
function ExtremeAxisRows({
  axes,
  topLabel,
  bottomLabel,
  libraryLabel,
}: {
  axes: ChannelExtremeAxisRow[]
  topLabel: string
  bottomLabel: string
  libraryLabel: string
}) {
  return (
    <div className="divide-y">
      {axes.map((axis) => (
        <BandContrastRow
          key={axis.key}
          axisKey={axis.key}
          topLabel={topLabel}
          topValue={axis.topMean}
          bottomLabel={bottomLabel}
          bottomValue={axis.bottomMean}
          libraryLabel={libraryLabel}
          libraryValue={axis.libraryMean}
        />
      ))}
    </div>
  )
}

// The best few uploads against the worst few against the library they came
// from, one shape per surface. The same three sets are drawn on every chart, so
// a reader compares them across title, thumbnail and hook in one pass, and
// the library baseline is what stops a band being called unusual when the whole
// channel scores that way.
export function ExtremesRadarCard({
  profile,
  group,
  icon,
  title,
  description,
  topLabel,
  bottomLabel,
  libraryLabel,
  formatOutcome,
  emptyNote,
  bare = false,
}: {
  profile: ChannelExtremesProfile
  // One surface of the taxonomy, when the card belongs to a surface's own tab:
  // one chart rather than the grid of them. Absent draws every surface.
  group?: TaxonomyAxisGroup
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  // What each band is called, in the reader's terms.
  topLabel: string
  bottomLabel: string
  // What the whole-library average is called.
  libraryLabel: string
  // Prints the metric the bands were ranked on, next to each video. Absent
  // drops the two band lists from this card, which is what a caller drawing
  // several of these off one profile does once it has stated the lists above
  // them as an ExtremeBandsCard.
  formatOutcome?: (value: number) => string
  // What to say when the two bands scored alike on every axis.
  emptyNote: string
  // Drops the prose around the chart: no callout under it, no caveat under the
  // card, just the shape and the axis rows behind their disclosure. What a
  // caller sets when the tab bar above these cards already carries the reading
  // notes once, rather than repeating them on every surface. Only bites on a
  // card that actually drew a chart, so a group too small to enclose a shape
  // (the alignment pair, drawn as bars) keeps the callout that is the only
  // reading it gets.
  bare?: boolean
}) {
  // One surface's axes, or every surface's, as the same list of groups either
  // way, so the drawing below does not care which of the two it was handed.
  const groups: ChannelExtremeGroup[] =
    group == null
      ? profile.groups
      : extremeGroupAxes(profile, group).length > 0
        ? [{ group, axes: extremeGroupAxes(profile, group) }]
        : []
  if (groups.length === 0) return null

  const contrasts =
    group == null ? profile.contrasts : extremeGroupContrasts(profile, group)
  const lead = contrasts[0]
  const drawable = groups.filter((entry) => entry.axes.length >= RADAR_MIN_AXES)
  const tooSmallToDraw = groups.filter(
    (entry) => entry.axes.length < RADAR_MIN_AXES,
  )
  // A single surface is named by the card's own heading, so its chart and rows
  // do not repeat the name above themselves.
  const showGroupLabels = group == null
  // The prose only comes off a card that drew something to read without it.
  const strip = bare && drawable.length > 0
  return (
    <TrendCard
      icon={icon}
      title={title}
      description={description}
      footer={
        strip
          ? undefined
          : `Your ${profile.bandSize} best and ${profile.bandSize} worst of the ${plural(profile.rankedVideoCount, "video")} carrying both a ${profile.source} read and the numbers to rank; the average covers all ${plural(profile.libraryVideoCount, "read video")}, ranked or not. Correlation, not proof: ${profile.bandSize} uploads a side is a lead worth testing, not a law.`
      }
    >
      {formatOutcome != null && (
        <ExtremeBands
          profile={profile}
          topLabel={topLabel}
          bottomLabel={bottomLabel}
          formatOutcome={formatOutcome}
        />
      )}

      {drawable.length > 0 && (
        <RadarLegend
          topLabel={topLabel}
          bottomLabel={bottomLabel}
          libraryLabel={libraryLabel}
        />
      )}

      {drawable.length > 0 && (
        <div
          className={
            showGroupLabels
              ? "grid gap-4 sm:grid-cols-2"
              : "mx-auto w-full max-w-sm"
          }
        >
          {drawable.map((entry) => (
            <div key={entry.group} className="flex flex-col gap-1">
              {showGroupLabels && (
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {taxonomyAxisGroupLabel(entry.group)}
                </span>
              )}
              <TaxonomyRadar
                axes={entry.axes.map((axis) => ({
                  key: axis.key,
                  topValue: axis.topMean,
                  bottomValue: axis.bottomMean,
                  libraryValue: axis.libraryMean,
                }))}
                topLabel={topLabel}
                bottomLabel={bottomLabel}
                libraryLabel={libraryLabel}
                groupLabel={taxonomyAxisGroupLabel(entry.group)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Two axes cannot enclose a shape, so a group that small (the alignment
          pair) runs full width underneath as the bars it would have been
          anyway, rather than leaving a hole in the grid of charts. */}
      {tooSmallToDraw.map((entry) => (
        <div key={entry.group} className="flex flex-col">
          {showGroupLabels && (
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {taxonomyAxisGroupLabel(entry.group)}
            </span>
          )}
          <ExtremeAxisRows
            axes={entry.axes}
            topLabel={topLabel}
            bottomLabel={bottomLabel}
            libraryLabel={libraryLabel}
          />
        </div>
      ))}

      {strip ? null : lead ? (
        <div className="flex flex-col gap-2 rounded-r-md border-l-2 border-muted-foreground/30 bg-muted/40 px-3 py-2.5">
          <div>
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Where they separate most
            </span>
            <p className="mt-0.5 text-sm">
              {taxonomyAxisCopy(lead.key).name}:{" "}
              {lead.delta > 0 ? topLabel : bottomLabel} average{" "}
              <span className="font-medium tabular-nums">
                {formatScore(lead.delta > 0 ? lead.topMean : lead.bottomMean)}
              </span>{" "}
              against{" "}
              <span className="tabular-nums">
                {formatScore(lead.delta > 0 ? lead.bottomMean : lead.topMean)}
              </span>
              .
            </p>
          </div>
          {/* A surface small enough to be drawn as bars already has these rows
              on the card, so the callout there is the sentence alone. */}
          {drawable.length > 0 && (
            <ExtremeAxisRows
              axes={contrasts}
              topLabel={topLabel}
              bottomLabel={bottomLabel}
              libraryLabel={libraryLabel}
            />
          )}
        </div>
      ) : (
        <CoverageNote>{emptyNote}</CoverageNote>
      )}

      {drawable.length > 0 && (
        <Collapsible className="rounded-lg border">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 p-3 text-left text-sm font-medium">
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
            {/* A stripped card has nothing else on it below the chart, so the
                disclosure is named for what it holds rather than sold as the
                extra reading it is on a card that carries prose too. */}
            {strip ? "Axis detail" : "Every axis, written out"}
            {!strip && (
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                the numbers behind the shapes
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4 border-t p-3">
            {(showGroupLabels ? groups : drawable).map((entry) => (
              <div key={entry.group} className="flex flex-col">
                {showGroupLabels && (
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {taxonomyAxisGroupLabel(entry.group)}
                  </span>
                )}
                <ExtremeAxisRows
                  axes={entry.axes}
                  topLabel={topLabel}
                  bottomLabel={bottomLabel}
                  libraryLabel={libraryLabel}
                />
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </TrendCard>
  )
}

// --- The categorical fingerprint --------------------------------------------

function ratioLabel(ratio: number, outcomeNoun: string): string {
  if (ratio >= 1) {
    const times = ratio >= 1.95 ? `${ratio.toFixed(1)}x` : `${Math.round((ratio - 1) * 100)}% more`
    return `${times} ${outcomeNoun}`
  }
  return `${Math.round((1 - ratio) * 100)}% less ${outcomeNoun}`
}

function StyleDimensionRow({
  dimension,
  outcomeNoun,
}: {
  dimension: ChannelStyleDimension
  outcomeNoun: string
}) {
  const dominant = dimension.rows[0]
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {taxonomyDimensionLabel(dimension.key)}
        </span>
        <span className="text-sm font-medium">
          {taxonomyCategoryLabel(dimension.key, dominant.value)}
        </span>
        <span className="text-xs text-muted-foreground">
          in {dominant.videoCount} of {plural(dimension.videoCount, "video")}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {dimension.rows.map((row) => (
          <div
            key={row.value}
            className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-x-3"
          >
            <span className="truncate text-sm">
              {taxonomyCategoryLabel(dimension.key, row.value)}
            </span>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-muted-foreground/50"
                style={{ width: `${Math.min(100, row.share * 100)}%` }}
              />
            </div>
            <span className="text-right text-xs tabular-nums text-muted-foreground">
              {row.videoCount}
            </span>
          </div>
        ))}
      </div>
      {dimension.hiddenCategoryCount > 0 && (
        <CoverageNote>
          and {plural(dimension.hiddenCategoryCount, "less common choice")}.
        </CoverageNote>
      )}
      {dimension.standout?.outcomeRatio != null && (
        <p className="text-xs text-muted-foreground">
          Your{" "}
          <span className="font-medium text-foreground">
            {taxonomyCategoryLabel(
              dimension.key,
              dimension.standout.value,
            ).toLowerCase()}
          </span>{" "}
          uploads got {ratioLabel(dimension.standout.outcomeRatio, outcomeNoun)}{" "}
          than your typical video, across{" "}
          {plural(dimension.standout.videoCount, "video")}.
        </p>
      )}
    </div>
  )
}

export function StyleProfileCard({
  profile,
  dimensionKeys,
  icon,
  title,
  description,
  // The noun a ratio is phrased against: "reach" or "watch time".
  outcomeNoun,
}: {
  profile: ChannelStyleProfile
  // The dimensions this card is about, when it belongs to a surface's own tab.
  // Absent reads every dimension the profile carries.
  dimensionKeys?: string[]
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  outcomeNoun: string
}) {
  const dimensions =
    dimensionKeys == null
      ? profile.dimensions
      : profile.dimensions.filter((dimension) =>
          dimensionKeys.includes(dimension.key),
        )
  if (dimensions.length === 0) return null

  return (
    <TrendCard
      icon={icon}
      title={title}
      description={description}
      footer={
        profile.outcomeVideoCount > 0
          ? `Read across ${plural(profile.taxonomyVideoCount, "video")}, with performance measured over the ${profile.outcomeVideoCount} carrying the numbers.`
          : `Read across ${plural(profile.taxonomyVideoCount, "video")}. None of them carry the numbers yet, so this is what you make, not yet how it performed.`
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {dimensions.map((dimension) => (
          <Chip key={dimension.key}>
            {taxonomyCategoryLabel(dimension.key, dimension.rows[0].value)}
          </Chip>
        ))}
      </div>
      <div className="divide-y">
        {dimensions.map((dimension) => (
          <StyleDimensionRow
            key={dimension.key}
            dimension={dimension}
            outcomeNoun={outcomeNoun}
          />
        ))}
      </div>
    </TrendCard>
  )
}
