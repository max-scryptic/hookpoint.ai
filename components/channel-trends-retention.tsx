import { AreaChartIcon, TimerIcon, TrophyIcon } from "lucide-react"

import { ChannelReachRetentionScatterChart } from "@/components/channel-trends-reach-retention-scatter"
import { ChannelRetentionCurveChart } from "@/components/channel-trends-retention-curve"
import {
  BandVideoPair,
  TrendCard,
  formatCompactNumber,
} from "@/components/channel-trends-shared"
import type {
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

// The metric both bands are ranked and listed on, printed the way the rest of
// the page prints a view count.
const formatViews = (value: number) => `${formatCompactNumber(value)} views`

// The uploads behind the two lines, named. The same card the Packaging and
// Script tabs open with, on the reach ranking the Packaging tab uses rather than
// the retention one the Script tab does: a creator recognises their own uploads
// faster than any curve, so the chart is worth more once they know which three
// videos each line is made of.
//
// Views are the criterion, so views are the figure printed against each row: the
// same reach ranking the Packaging tab lists its bands on, so a creator reads
// the two cards the same way. The retention each upload earned is what the chart
// below draws.
function RetentionBandsCard({ bands }: { bands: ChannelRetentionBands }) {
  return (
    <TrendCard
      icon={TrophyIcon}
      title="The uploads the chart below compares"
      description="Your three most-viewed uploads and your three least-viewed, ranked on total views."
    >
      <BandVideoPair
        top={bands.top.videos.map((video) => ({
          id: video.id,
          title: video.title,
          outcome: video.views,
        }))}
        bottom={bands.bottom.videos.map((video) => ({
          id: video.id,
          title: video.title,
          outcome: video.views,
        }))}
        topLabel={TOP_BAND_LABEL}
        bottomLabel={BOTTOM_BAND_LABEL}
        formatOutcome={formatViews}
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
        axis={{
          kind: "percentage",
          averageDurationSeconds: curve.averageDurationSeconds,
        }}
      />
    </TrendCard>
  )
}

function HookRetentionCard({ curve }: { curve: ChannelRetentionCurve }) {
  const hook = curve.hook
  if (hook == null) return null
  return (
    <TrendCard
      icon={TimerIcon}
      title="Your hook retention"
      description={
        hook.bands == null
          ? "Your channel average through the first 30 seconds of each video."
          : "Your three most-viewed uploads and your three least-viewed, compared on the same 0:00 to 0:30 clock."
      }
    >
      <ChannelRetentionCurveChart
        points={hook.points}
        bands={hook.bands}
        axis={{ kind: "seconds", durationSeconds: 30 }}
      />
    </TrendCard>
  )
}

function ReachRetentionCard({ data }: { data: ChannelTrendsData }) {
  const scatter = data.reachRetention
  if (scatter == null) return null
  return (
    <TrendCard
      icon={AreaChartIcon}
      title="Reach against retention"
      description="Every covered upload by total views and the average share watched."
    >
      <ChannelReachRetentionScatterChart scatter={scatter} />
    </TrendCard>
  )
}

// A library can open the page on its event synthesis alone, with no stored
// curves to average, so the tab is dropped from the bar rather than opened
// empty.
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
      <HookRetentionCard curve={curve} />
      <ReachRetentionCard data={data} />
    </div>
  )
}
