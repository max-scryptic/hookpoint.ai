import {
  ClockIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  VideoIcon,
} from "lucide-react"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { DashboardKpis } from "@/lib/dashboard/kpis"

// Rounds a duration in seconds to whole minutes with thousands separators, since
// every KPI here is reported in minutes.
function formatMinutes(seconds: number): string {
  return Math.round(seconds / 60).toLocaleString()
}

export function DashboardKpiCards({ kpis }: { kpis: DashboardKpis }) {
  const cards = [
    {
      label: "Videos Analysed",
      value: kpis.videosAnalysed.toLocaleString(),
      icon: VideoIcon,
    },
    {
      label: "Minutes Analysed",
      value: formatMinutes(kpis.secondsAnalysed),
      icon: ClockIcon,
    },
    {
      label: "Minutes Deeply Analysed",
      value: formatMinutes(kpis.secondsDeeplyAnalysed),
      icon: SparklesIcon,
    },
    {
      label: "Drop-offs Detected",
      value: kpis.dropOffsDetected.toLocaleString(),
      icon: TrendingDownIcon,
    },
    {
      label: "Retention Gains Detected",
      value: kpis.retentionGainsDetected.toLocaleString(),
      icon: TrendingUpIcon,
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map(({ label, value, icon: Icon }) => (
        <Card key={label} size="sm">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <Icon className="size-4" />
              {label}
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}
