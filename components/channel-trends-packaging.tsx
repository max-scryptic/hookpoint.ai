import {
  ImageIcon,
  ShapesIcon,
  SlidersHorizontalIcon,
  TagsIcon,
  UserPlusIcon,
} from "lucide-react"

import { packagingFeatureLabel } from "@/components/channel-trends-copy"
import {
  CoverageNote,
  EventReceipt,
  OutcomeBadge,
  RANK_BAR_MAX_PERCENT,
  RankBar,
  TrendCard,
  formatCompactNumber,
  formatRate,
  plural,
} from "@/components/channel-trends-shared"
import {
  AxisContrastCard,
  StyleProfileCard,
} from "@/components/channel-trends-taxonomy"
import { EventTypeBadge } from "@/components/event-type-badge"
import type {
  ChannelPackagingPatterns,
  ChannelSubscriberConversion,
  ChannelTrendsData,
  PackagingFeatureContrast,
  PackagingReachVideo,
  PackagingTopicReach,
  SubscriberPattern,
  SubscriberVideoRow,
} from "@/lib/channel-trends"

// The Packaging tab: what your uploads promise, and what that promise earns.
// Reach first (which uploads travel, and what their packaging has in common),
// then the enriched 0-10 read of the same packaging, then the categorical
// fingerprint, then subscriber conversion.
//
// Reach is views per day at snapshot time, because raw views cannot compare a
// two-week-old upload with a two-year-old one. Every comparison here is
// correlational by construction and the copy says so: what reached furthest is
// also topic, timing and who YouTube showed it to.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

const REACH_BAND_LABEL = {
  high: "high reach",
  low: "low reach",
  middle: null,
} as const

function reachRowTitle(row: PackagingReachVideo): string {
  const title = row.title ?? "Untitled video"
  const share =
    row.browseSuggestedShare == null
      ? ""
      : ` · ${Math.round(row.browseSuggestedShare * 100)}% from Browse & Suggested`
  const pending = row.hasTaxonomy ? "" : " · packaging read pending"
  return `${title} - ${formatCompactNumber(row.views)} views in ${plural(row.ageDays, "day")} (${formatRate(row.viewsPerDay)}/day)${share}${pending}`
}

function ReachRow({
  row,
  maxRate,
  medianRate,
}: {
  row: PackagingReachVideo
  maxRate: number
  medianRate: number
}) {
  const badge = REACH_BAND_LABEL[row.band]
  const scale = (rate: number) =>
    maxRate > 0 ? (rate / maxRate) * RANK_BAR_MAX_PERCENT : 0
  return (
    <div
      className="grid grid-cols-[minmax(6.5rem,13rem)_1fr_5.5rem] items-center gap-x-3 py-1.5"
      title={reachRowTitle(row)}
    >
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="w-full truncate text-sm">
          {row.title ?? "Untitled video"}
        </span>
        {badge && <OutcomeBadge>{badge}</OutcomeBadge>}
      </div>
      <RankBar
        fillPercent={scale(row.viewsPerDay)}
        medianPercent={scale(medianRate)}
      />
      <div className="flex flex-col items-end">
        <span className="text-sm font-medium tabular-nums">
          {formatCompactNumber(row.views)}
          <span className="text-xs font-normal text-muted-foreground">
            {" "}
            views
          </span>
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          in {plural(row.ageDays, "day")}
        </span>
      </div>
    </div>
  )
}

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

function TopicRow({ row }: { row: PackagingTopicReach }) {
  const direction = row.ratio >= 1 ? "above" : "below"
  const magnitude =
    row.ratio >= 1
      ? `${row.ratio.toFixed(1)}x`
      : `${(1 / row.ratio).toFixed(1)}x below`
  return (
    <div className="grid grid-cols-[minmax(6rem,12rem)_1fr_auto] items-center gap-x-3 py-1.5">
      <span className="truncate text-sm">{row.topic}</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-muted-foreground/50"
          // Half the track is the channel's typical reach, so a topic at twice
          // the median fills the bar and one at half of it fills a quarter.
          style={{ width: `${Math.min(100, (row.ratio / 2) * 100)}%` }}
        />
      </div>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {plural(row.videoCount, "video")} ·{" "}
        {row.ratio >= 1 ? `${magnitude} ${direction}` : magnitude} your typical
        reach
      </span>
    </div>
  )
}

function PackagingReachCard({
  packaging,
}: {
  packaging: ChannelPackagingPatterns
}) {
  const maxRate = Math.max(
    packaging.medianViewsPerDay,
    ...packaging.videos.map((row) => row.viewsPerDay),
  )
  const pendingCount =
    packaging.coveredVideoCount - packaging.taxonomyVideoCount

  return (
    <TrendCard
      icon={ImageIcon}
      title="Which uploads earn reach"
      description="Every upload ranked by views per day since publish, measured at its analytics snapshot so a new video and an old one compare fairly. The dashed line is your channel median. Hover a row for the raw numbers."
      footer={
        pendingCount > 0
          ? `${plural(pendingCount, "video")} here has no packaging read yet, so it counts in the ranking but not in the comparisons below.`
          : undefined
      }
    >
      <div>
        {packaging.videos.map((row) => (
          <ReachRow
            key={row.id}
            row={row}
            maxRate={maxRate}
            medianRate={packaging.medianViewsPerDay}
          />
        ))}
      </div>
    </TrendCard>
  )
}

function PackagingFeaturesCard({
  packaging,
}: {
  packaging: ChannelPackagingPatterns
}) {
  if (packaging.features.length === 0 && packaging.topics.length === 0) {
    return null
  }
  return (
    <TrendCard
      icon={ShapesIcon}
      title="What separates your high-reach half"
      description="Packaging choices common in the half of your library that travels furthest and rare in the half that does not, plus the subjects that over or under-perform your typical reach. Correlation, not proof: reach is also topic, timing and who YouTube showed it to."
    >
      {packaging.features.length > 0 && (
        <div className="divide-y">
          {packaging.features.map((row) => (
            <FeatureContrastRow key={row.feature} row={row} />
          ))}
        </div>
      )}
      {packaging.features.length === 0 && (
        <CoverageNote>
          Your two reach halves package themselves alike so far. When a choice
          starts showing up in one and not the other, it lands here.
        </CoverageNote>
      )}
      {packaging.topics.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-3">
          <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <TagsIcon className="size-3.5" />
            Subjects that move the needle
          </div>
          {packaging.topics.map((row) => (
            <TopicRow key={row.topic} row={row} />
          ))}
        </div>
      )}
    </TrendCard>
  )
}

// --- Subscriber conversion ---------------------------------------------------

const SUBSCRIBER_OUTCOME_BADGE = {
  magnet: "subscriber magnet",
  leak: "net loss",
  typical: null,
} as const

function conversionRowTitle(row: SubscriberVideoRow): string {
  const title = row.title ?? "Untitled video"
  const net =
    row.netGained == null
      ? ""
      : ` (${row.netGained >= 0 ? "+" : "-"}${Math.abs(row.netGained)} net)`
  return `${title} - +${row.subscribersGained} subscribers from ${formatCompactNumber(row.views)} views, ${formatRate(row.ratePer1k)} per 1k${net}`
}

// The row KPI: net subscribers gained per 100 views, falling back to gross
// gains when the snapshot never reported losses.
function formatNetSubscriberRatePer100(row: SubscriberVideoRow): string {
  const gained = row.netGained ?? row.subscribersGained
  const rate = row.views > 0 ? (gained / row.views) * 100 : 0
  return rate >= 0 ? `+${formatRate(rate)}` : `-${formatRate(Math.abs(rate))}`
}

function ConversionRow({
  row,
  maxRate,
  medianRate,
}: {
  row: SubscriberVideoRow
  maxRate: number
  medianRate: number
}) {
  const badge = SUBSCRIBER_OUTCOME_BADGE[row.outcome]
  const scale = (rate: number) =>
    maxRate > 0 ? (rate / maxRate) * RANK_BAR_MAX_PERCENT : 0
  return (
    <div
      className="grid grid-cols-[minmax(6.5rem,13rem)_1fr_7rem] items-center gap-x-3 py-1.5"
      title={conversionRowTitle(row)}
    >
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="w-full truncate text-sm">
          {row.title ?? "Untitled video"}
        </span>
        {badge && <OutcomeBadge>{badge}</OutcomeBadge>}
      </div>
      <RankBar
        fillPercent={scale(row.ratePer1k)}
        medianPercent={scale(medianRate)}
      />
      <div className="flex flex-col items-end">
        <span className="text-sm font-medium tabular-nums">
          {formatNetSubscriberRatePer100(row)}
          <span className="text-xs font-normal text-muted-foreground">
            {" "}
            {row.netGained == null ? "subs" : "net subs"} / 100 views
          </span>
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {formatCompactNumber(row.views)} views
        </span>
      </div>
    </div>
  )
}

function SubscriberPatternRow({ pattern }: { pattern: SubscriberPattern }) {
  const where =
    pattern.side === "hook" ? "in the opening" : "in retention gains"
  const magnets =
    pattern.magnetVideoCount === 1
      ? "your magnet video"
      : `all ${pattern.magnetVideoCount} magnet videos`
  const others =
    pattern.otherVideoCount === 0
      ? `none of your ${plural(pattern.otherTotal, "other video")}`
      : `only ${pattern.otherVideoCount} of your ${plural(pattern.otherTotal, "other video")}`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <EventTypeBadge eventType={pattern.eventType} />
        <span className="text-xs text-muted-foreground">
          {where} - in {magnets}, {others}
        </span>
      </div>
      {pattern.events.map((event, index) => (
        <EventReceipt
          key={`${event.videoTitle ?? ""}:${event.narrative}:${index}`}
          narrative={event.narrative}
          videoTitle={event.videoTitle}
        />
      ))}
    </div>
  )
}

function SubscriberConversionCard({
  conversion,
}: {
  conversion: ChannelSubscriberConversion
}) {
  const maxRate = Math.max(
    conversion.medianRatePer1k,
    ...conversion.rows.map((row) => row.ratePer1k),
  )
  const leaks = conversion.rows.filter((row) => row.outcome === "leak")
  const hasOutliers = conversion.magnetCount > 0 || conversion.leakCount > 0

  return (
    <TrendCard
      icon={UserPlusIcon}
      title="Subscriber conversion"
      description="Which uploads turn viewers into subscribers. Bars rank each upload by subscribers gained per 1,000 views so a small video and a big one compare fairly; the dashed line is your channel median. Hover a row for the raw numbers."
      footer={
        conversion.coveredVideoCount < conversion.libraryVideoCount
          ? `Based on the ${conversion.coveredVideoCount} of your ${plural(conversion.libraryVideoCount, "library video")} with subscriber data. Older analyses pick theirs up the next time you open them.`
          : undefined
      }
    >
      <div>
        {conversion.rows.map((row) => (
          <ConversionRow
            key={row.id}
            row={row}
            maxRate={maxRate}
            medianRate={conversion.medianRatePer1k}
          />
        ))}
      </div>
      {!hasOutliers && (
        <CoverageNote>
          No outliers yet - your uploads convert at a similar rate. When one
          breaks away from the median, it gets flagged here.
        </CoverageNote>
      )}
      {conversion.patterns.length > 0 && (
        <div className="flex flex-col gap-3 rounded-r-md border-l-2 border-muted-foreground/30 bg-muted/40 px-3 py-2.5">
          <div>
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              What your subscriber magnets did differently
            </span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Patterns in every magnet&apos;s openings or retention gains that
              are rare across the rest of your library. Correlation, not proof,
              but the first place to look.
            </p>
          </div>
          {conversion.patterns.map((pattern) => (
            <SubscriberPatternRow
              key={`${pattern.side}:${pattern.eventType}`}
              pattern={pattern}
            />
          ))}
        </div>
      )}
      {leaks.map((row) => (
        <p key={row.id} className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">Net loss:</span>{" "}
          {row.title ?? "An untitled video"} lost more subscribers than it
          gained ({row.netGained} net). Worth re-watching what its title and
          thumbnail promised against what the video delivered.
        </p>
      ))}
    </TrendCard>
  )
}

export function PackagingPanel({ data }: { data: ChannelTrendsData }) {
  return (
    <>
      {data.packaging != null && (
        <>
          <PackagingReachCard packaging={data.packaging} />
          <PackagingFeaturesCard packaging={data.packaging} />
        </>
      )}
      {data.packagingAxes != null && (
        <AxisContrastCard
          profile={data.packagingAxes}
          icon={SlidersHorizontalIcon}
          title="How your packaging scores"
          description="Every title, thumbnail and opening is scored on the same 0-10 axes, each video judged on its own. These are the axes where your high-reach half and your low-reach half genuinely separate."
          topLabel="high reach"
          bottomLabel="low reach"
          emptyNote="Your two reach halves score alike on every axis so far. Open your channel profile below to see where your packaging sits overall."
        />
      )}
      {data.packagingStyle != null && (
        <StyleProfileCard
          profile={data.packagingStyle}
          icon={ShapesIcon}
          title="Your packaging fingerprint"
          description="The packaging choices you repeat, and how each one performed. Repetition is not a fault: a recognisable channel is built on it. What matters is whether the thing you repeat is the thing that reaches."
          outcomeNoun="reach"
        />
      )}
      {data.subscribers != null && (
        <SubscriberConversionCard conversion={data.subscribers} />
      )}
    </>
  )
}
