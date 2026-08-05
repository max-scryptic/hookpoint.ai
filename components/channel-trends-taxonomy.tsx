import type { ComponentType } from "react"
import { ChevronDownIcon } from "lucide-react"

import {
  taxonomyAxisCopy,
  taxonomyAxisGroupLabel,
  taxonomyCategoryLabel,
  taxonomyDimensionLabel,
} from "@/components/channel-trends-copy"
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
  axisIsDescriptor,
  axisLowerIsBetter,
  type ChannelAxisProfile,
  type ChannelAxisRow,
  type ChannelStyleDimension,
  type ChannelStyleProfile,
} from "@/lib/channel-taxonomy-trends"

// The two views that render a taxonomy at channel level, shared by the
// Packaging tab (the packaging read, split on reach) and the Content tab (the
// script read, split on retention). Both taxonomies score every video on the
// same kind of material - closed vocabularies and 0-10 axes, each video judged
// on its own - so one pair of components can draw either.
//
//   AxisContrastCard  the axes where the better-performing half of the library
//                     separates from the worse half, plus the channel's own
//                     median on every axis behind a fold
//   StyleProfileCard  what the channel repeats on each categorical dimension,
//                     and which of its choices performs unusually well
//
// Everything here is correlation. A library is a handful of videos made by one
// person, so a gap between its halves is a lead worth testing, never a law, and
// the copy says so on both cards.
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
    <div className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-x-2">
      <span className="text-xs text-muted-foreground">{label}</span>
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

// One axis where the two halves separated. The sentence under the name says
// what a high score means, so the reader never has to infer the direction, and
// the descriptor note says when neither end is better.
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
  const copy = taxonomyAxisCopy(row.key)
  const topLeads = row.topMedian >= row.bottomMedian
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{copy.name}</span>
        <span className="text-xs text-muted-foreground">
          10 = {copy.meaning}
        </span>
        {axisIsDescriptor(row.key) && (
          <span className="text-xs text-muted-foreground">
            (a descriptor, not a grade)
          </span>
        )}
        {axisLowerIsBetter(row.key) && (
          <span className="text-xs text-muted-foreground">(less is more)</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <BandBar label={topLabel} value={row.topMedian} emphasis={topLeads} />
        <BandBar
          label={bottomLabel}
          value={row.bottomMedian}
          emphasis={!topLeads}
        />
      </div>
    </div>
  )
}

// The channel's own median on every axis, grouped by surface. Folded away by
// default: it is a reference profile rather than a finding, and the contrast
// above it is what a reader came for.
function AxisProfileFold({ profile }: { profile: ChannelAxisProfile }) {
  const groups = [...new Set(profile.axes.map((axis) => axis.group))]
  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 p-3 text-left text-sm font-medium">
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        Your channel profile
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          every axis, median across {plural(profile.taxonomyVideoCount, "video")}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 border-t p-3">
        {groups.map((group) => (
          <div key={group} className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {taxonomyAxisGroupLabel(group)}
            </span>
            {profile.axes
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
  icon,
  title,
  description,
  topLabel,
  bottomLabel,
  emptyNote,
}: {
  profile: ChannelAxisProfile
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  // What each half of the split is called, in the reader's terms.
  topLabel: string
  bottomLabel: string
  // What to say when the two halves scored alike on every axis.
  emptyNote: string
}) {
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
      {profile.contrasts.length > 0 ? (
        <div className="divide-y">
          {profile.contrasts.map((row) => (
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
      <AxisProfileFold profile={profile} />
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
  icon,
  title,
  description,
  // The noun a ratio is phrased against: "reach" or "watch time".
  outcomeNoun,
}: {
  profile: ChannelStyleProfile
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  outcomeNoun: string
}) {
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
        {profile.dimensions.map((dimension) => (
          <Chip key={dimension.key}>
            {taxonomyCategoryLabel(dimension.key, dimension.rows[0].value)}
          </Chip>
        ))}
      </div>
      <div className="divide-y">
        {profile.dimensions.map((dimension) => (
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
