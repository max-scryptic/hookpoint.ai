import { AreaChartIcon } from "lucide-react"

import { ChannelRetentionCurveChart } from "@/components/channel-trends-retention-curve"
import { TrendCard } from "@/components/channel-trends-shared"
import type { ChannelRetentionCurve } from "@/lib/channel-retention-curve"
import type { ChannelTrendsData } from "@/lib/channel-trends"

// The Retention tab: one chart, read the way every other tab on this page is
// read. The three most-viewed uploads averaged into one line, the three
// least-viewed into another, and the whole library averaged behind them as the
// baseline, all on one normalized axis.
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
  if (data.averageCurve == null) return null
  return <RetentionCurveCard curve={data.averageCurve} />
}
