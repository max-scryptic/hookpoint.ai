import { GaugeIcon, MessagesSquareIcon, SlidersHorizontalIcon } from "lucide-react"

import {
  CoverageNote,
  OutcomeBadge,
  RANK_BAR_MAX_PERCENT,
  RankBar,
  TrendCard,
  formatCompactNumber,
  plural,
} from "@/components/channel-trends-shared"
import {
  AxisContrastCard,
  StyleProfileCard,
} from "@/components/channel-trends-taxonomy"
import type {
  ChannelRetentionRanking,
  ChannelTrendsData,
  RetentionRankingRow,
} from "@/lib/channel-trends"

// The Content tab: what your videos actually say, read across the library. The
// script taxonomy scores every transcript on the same closed vocabularies and
// 0-10 axes the packaging read uses, so the same two views apply, but split on
// RETENTION rather than reach. Packaging earns the click; the script is what
// happens after it, so the share of the video that gets watched is the outcome
// worth splitting on.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

const RETENTION_BAND_LABEL = {
  high: "holds viewers",
  low: "loses viewers",
  middle: null,
} as const

function retentionRowTitle(row: RetentionRankingRow): string {
  const title = row.title ?? "Untitled video"
  const views = row.views == null ? "" : ` · ${formatCompactNumber(row.views)} views`
  const pending = row.hasScript ? "" : " · script read pending"
  return `${title} - ${row.retentionPercent.toFixed(1)}% of the video watched on average${views}${pending}`
}

function RetentionRow({
  row,
  maxPercent,
  medianPercent,
}: {
  row: RetentionRankingRow
  maxPercent: number
  medianPercent: number
}) {
  const badge = RETENTION_BAND_LABEL[row.band]
  const scale = (value: number) =>
    maxPercent > 0 ? (value / maxPercent) * RANK_BAR_MAX_PERCENT : 0
  return (
    <div
      className="grid grid-cols-[minmax(6.5rem,13rem)_1fr_5.5rem] items-center gap-x-3 py-1.5"
      title={retentionRowTitle(row)}
    >
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="w-full truncate text-sm">
          {row.title ?? "Untitled video"}
        </span>
        {badge && <OutcomeBadge>{badge}</OutcomeBadge>}
      </div>
      <RankBar
        fillPercent={scale(row.retentionPercent)}
        medianPercent={scale(medianPercent)}
      />
      <div className="flex flex-col items-end">
        <span className="text-sm font-medium tabular-nums">
          {Math.round(row.retentionPercent)}%
          <span className="text-xs font-normal text-muted-foreground">
            {" "}
            watched
          </span>
        </span>
        {row.views != null && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {formatCompactNumber(row.views)} views
          </span>
        )}
      </div>
    </div>
  )
}

function RetentionRankingCard({
  ranking,
}: {
  ranking: ChannelRetentionRanking
}) {
  const maxPercent = Math.max(
    ranking.medianRetentionPercent,
    ...ranking.rows.map((row) => row.retentionPercent),
  )
  const pending = ranking.coveredVideoCount - ranking.scriptVideoCount
  return (
    <TrendCard
      icon={GaugeIcon}
      title="Which uploads hold viewers"
      description="Every upload ranked by the average share of it that gets watched. Already a proportion, so long and short videos sit on the same scale, though a short video will always find this easier. The dashed line is your channel median."
      footer={
        pending > 0
          ? `${plural(pending, "video")} here has no script read yet, so it counts in the ranking but not in the comparisons below.`
          : undefined
      }
    >
      <div>
        {ranking.rows.map((row) => (
          <RetentionRow
            key={row.id}
            row={row}
            maxPercent={maxPercent}
            medianPercent={ranking.medianRetentionPercent}
          />
        ))}
      </div>
    </TrendCard>
  )
}

export function ContentPanel({ data }: { data: ChannelTrendsData }) {
  return (
    <>
      {data.retentionRanking != null && (
        <RetentionRankingCard ranking={data.retentionRanking} />
      )}
      {data.scriptAxes != null && (
        <AxisContrastCard
          profile={data.scriptAxes}
          icon={SlidersHorizontalIcon}
          title="How your scripts score"
          description="Every transcript is scored on the same 0-10 axes, each video judged on its own. These are the axes where the half of your library that holds viewers separates from the half that loses them."
          topLabel="holds viewers"
          bottomLabel="loses viewers"
          emptyNote="Your best and worst retaining halves write alike on every axis so far. Open your channel profile below to see where your scripts sit overall."
        />
      )}
      {data.scriptStyle != null && (
        <StyleProfileCard
          profile={data.scriptStyle}
          icon={MessagesSquareIcon}
          title="Your content fingerprint"
          description="The kinds of video you make and the register you make them in, with how each one held viewers. A format you rarely use but that holds attention is the cheapest experiment on this page."
          outcomeNoun="watch-through"
        />
      )}
      {data.retentionRanking == null &&
        data.scriptAxes == null &&
        data.scriptStyle == null && (
          <CoverageNote>
            Your script reads are still being generated. Open a few analysed
            videos to fill them in, and this tab starts comparing what your
            videos say against how much of them gets watched.
          </CoverageNote>
        )}
    </>
  )
}
