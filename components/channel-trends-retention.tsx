import { AreaChartIcon, TrophyIcon } from "lucide-react"

import { ChannelRetentionCurveChart } from "@/components/channel-trends-retention-curve"
import { BandVideoPair, TrendCard } from "@/components/channel-trends-shared"
import type {
  ChannelRetentionBands,
  ChannelRetentionCurve,
} from "@/lib/channel-retention-curve"
import type { ChannelTrendsData } from "@/lib/channel-trends"

// The Retention tab: the two ends of the library named, then one chart, read the
// way every other tab on this page is read. The three best-retaining uploads
// averaged into one line, the three worst into another, and the whole library
// averaged behind them as the baseline, all on one normalized axis.
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
const TOP_BAND_LABEL = "top 3 videos"
const BOTTOM_BAND_LABEL = "bottom 3 videos"

// The share of a video that gets watched, printed the way the Script tab prints
// the same quantity, because it is the same quantity.
const formatWatched = (share: number) => `${Math.round(share * 100)}% watched`

// The uploads behind the two lines, named. The same card the Packaging and
// Script tabs open with, on the same ranking those tabs' script bands use: a
// creator recognises their own uploads faster than any curve, so the chart is
// worth more once they know which three videos each line is made of.
function RetentionBandsCard({ bands }: { bands: ChannelRetentionBands }) {
  return (
    <TrendCard
      icon={TrophyIcon}
      title="The uploads the chart compares"
      description="Your three uploads that held viewers longest and your three that lost them fastest, ranked on the share of each video that gets watched."
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
          : "Your three best-retaining uploads and your three worst, over your channel average."
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
      {curve.bands != null && <RetentionBandsCard bands={curve.bands} />}
      <RetentionCurveCard curve={curve} />
    </div>
  )
}
