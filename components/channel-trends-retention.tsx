import { AreaChartIcon, TrophyIcon } from "lucide-react"

import { ChannelRetentionCurveChart } from "@/components/channel-trends-retention-curve"
import {
  BandVideoPair,
  TrendCard,
  formatCompactNumber,
  plural,
} from "@/components/channel-trends-shared"
import type {
  ChannelRetentionBand,
  ChannelRetentionBands,
  ChannelRetentionCurve,
} from "@/lib/channel-retention-curve"
import type { ChannelTrendsData } from "@/lib/channel-trends"

// The Retention tab: the two ends of the library named, then one chart, read the
// way every other tab on this page is read. The three most-viewed uploads
// averaged into one line, the three least-viewed into another, and the whole
// library averaged behind them as the baseline, all on one normalized axis.
//
// Split on views rather than on retention so the chart is not ranking the same
// column it draws: a top band picked on retention outruns a bottom band picked
// the same way whatever the library does, and can be led by an upload five
// people saw. Views are the independent axis, and the answer they buy (whether
// reach costs the channel retention) is one a creator can act on.
//
// Purely presentational; all aggregation and gating lives in
// lib/channel-retention-curve.ts.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

// Named exactly as the chart's own key names the two lines, so the card above it
// and the key under it are plainly the same two bands. Kept here rather than
// imported from the chart because that module is a client component, and a plain
// value exported from one does not survive the crossing into a server component
// (see the note on RADAR_MIN_AXES in components/channel-trends-shared.tsx).
const TOP_BAND_LABEL = "top 3 by views"
const BOTTOM_BAND_LABEL = "bottom 3 by views"

// The share of a video that gets watched, printed the way the Script tab prints
// the same quantity, because it is the same quantity.
const formatWatched = (share: number) => `${Math.round(share * 100)}% watched`

// The reach a band was picked on, for the footer. Spelled out because the two
// bands only mean something next to each other: 40K against 20K is a comparison,
// 40K against 5 is a coincidence.
function bandRange(band: ChannelRetentionBand): string {
  return band.minViews === band.maxViews
    ? `${formatCompactNumber(band.minViews)} views`
    : `${formatCompactNumber(band.minViews)} to ${formatCompactNumber(band.maxViews)} views`
}

// The uploads behind the two lines, named. The same card the Packaging and
// Script tabs open with, on the reach ranking the Packaging tab uses rather than
// the retention one the Script tab does: a creator recognises their own uploads
// faster than any curve, so the chart is worth more once they know which three
// videos each line is made of.
//
// Views are the criterion, so the figure printed against each row is the other
// one: the share of that video that got watched. Read down a column and you can
// see whether the band's line is a shape all three uploads share or one upload
// dragging the other two.
function RetentionBandsCard({
  bands,
  videoCount,
}: {
  bands: ChannelRetentionBands
  videoCount: number
}) {
  return (
    <TrendCard
      icon={TrophyIcon}
      title="The uploads the chart compares"
      description="Your three most-viewed uploads and your three least-viewed, with the share of each one that actually gets watched."
      footer={`Your ${bands.top.videoCount} most-viewed (${bandRange(bands.top)}) and ${bands.bottom.videoCount} least-viewed (${bandRange(bands.bottom)}) of the ${plural(videoCount, "video")} storing a retention curve. Each line below is those videos averaged together, weighted by the viewers behind them.`}
    >
      <BandVideoPair
        top={bands.top.videos.map((video) => ({
          id: video.id,
          title: video.title,
          outcome: video.watchedShare,
        }))}
        bottom={bands.bottom.videos.map((video) => ({
          id: video.id,
          title: video.title,
          outcome: video.watchedShare,
        }))}
        topLabel={TOP_BAND_LABEL}
        bottomLabel={BOTTOM_BAND_LABEL}
        formatOutcome={formatWatched}
      />
    </TrendCard>
  )
}

function RetentionCurveCard({ curve }: { curve: ChannelRetentionCurve }) {
  return (
    <TrendCard
      icon={AreaChartIcon}
      title="Your retention curves"
      description={
        curve.bands == null
          ? "Every video in your library, averaged onto one axis."
          : "Your three most-viewed uploads and your three least-viewed, over your channel average."
      }
    >
      <ChannelRetentionCurveChart
        points={curve.points}
        bands={curve.bands}
        averageDurationSeconds={curve.averageDurationSeconds}
      />
    </TrendCard>
  )
}

// A library can reach the early stage on its event synthesis alone, with no
// stored curves to average, so the tab is dropped from the bar rather than
// opened empty.
export function retentionPanelHasContent(data: ChannelTrendsData): boolean {
  return data.averageCurve != null
}

export function RetentionPanel({ data }: { data: ChannelTrendsData }) {
  const curve = data.averageCurve
  if (curve == null) return null
  return (
    <div className="flex flex-col gap-3">
      {/* Null on a library too small for two full, disjoint bands, which leaves
          the channel average as the only line there is to draw and nothing to
          name above it. */}
      {curve.bands != null && (
        <RetentionBandsCard bands={curve.bands} videoCount={curve.videoCount} />
      )}
      <RetentionCurveCard curve={curve} />
    </div>
  )
}
