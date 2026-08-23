import { AreaChartIcon } from "lucide-react"

import { ChannelRetentionCurveChart } from "@/components/channel-trends-retention-curve"
import { TrendCard } from "@/components/channel-trends-shared"
import type { ChannelRetentionCurve } from "@/lib/channel-retention-curve"
import type { ChannelTrendsData } from "@/lib/channel-trends"

// The Retention tab: one chart, read the way every other tab on this page is
// read. The three best-retaining uploads averaged into one line, the three
// worst into another, and the whole library averaged behind them as the
// baseline, all on one normalized axis.
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
  if (data.averageCurve == null) return null
  return <RetentionCurveCard curve={data.averageCurve} />
}
