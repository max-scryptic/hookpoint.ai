import Link from "next/link"
import {
  EyeIcon,
  GaugeIcon,
  MousePointerClickIcon,
  TrendingUpIcon,
  UserPlusIcon,
  VideoIcon,
} from "lucide-react"

import {
  PackagingPanel,
  packagingPanelHasContent,
} from "@/components/channel-trends-packaging"
import {
  RetentionPanel,
  retentionPanelHasContent,
} from "@/components/channel-trends-retention"
import {
  ScriptPanel,
  scriptPanelHasContent,
} from "@/components/channel-trends-script"
import {
  formatCompactNumber,
  plural,
} from "@/components/channel-trends-shared"
import { ChannelTrendsTabs } from "@/components/channel-trends-tabs"
import { LibraryProgress } from "@/components/library-progress"
import { PaidFeatureCard } from "@/components/paid-feature-card"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  type ChannelSnapshot,
  type ChannelTrendsData,
} from "@/lib/channel-trends"
import { CHANNEL_TRENDS_VIDEO_THRESHOLD } from "@/lib/deep-analysis-library"
import { cn } from "@/lib/utils"

// The Channel Trends page body. Below CHANNEL_TRENDS_VIDEO_THRESHOLD deeply
// analysed videos it is the unlock meter and the card explaining what is being
// built, and nothing else: no tiles, no tabs, no partially-open page. At the
// threshold it opens whole, as the library's headline numbers and three tabs.
//
//   Retention  what the library actually did to viewers: the three most-viewed
//              uploads and the three least-viewed averaged onto one axis, over
//              the views-weighted average of every stored curve
//              (components/channel-trends-retention.tsx)
//   Packaging  what your uploads promise, read one surface at a time across its
//              own Hook, Title, Thumbnail and Alignment sub-tabs
//              (components/channel-trends-packaging.tsx)
//   Script     what your videos say against how much of them gets watched,
//              read one surface at a time across its own Substance, Structure,
//              Emotion and Rhetoric sub-tabs
//              (components/channel-trends-script.tsx)
//
// The page carries no colour of its own: every verdict is written out, so a
// card never depends on a red or green edge to be read. The only colour is the
// shared EventTypeBadge and the tab glyphs, both of which mean the same thing
// everywhere else in the product. Purely presentational; all aggregation and
// gating lives in lib/channel-trends.ts and lib/channel-taxonomy-trends.ts, all
// written copy in components/channel-trends-copy.ts.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text on this page. Hyphens are fine. See lib/copy-guardrails.ts; enforced by
// lib/__tests__/copy-guardrails.test.ts.

// The unlock meter, shown while the page is still shut. Once the library
// reaches the threshold the meter has nothing left to say, so it disappears and
// the snapshot tiles take the top of the page. The bar itself is the shared one
// every library-gated feature uses (components/library-progress.tsx); this only
// decides what the line above it says.
function StageProgress({ data }: { data: ChannelTrendsData }) {
  if (data.stage === "established") {
    return null
  }

  const target = CHANNEL_TRENDS_VIDEO_THRESHOLD
  const remaining = target - data.libraryVideoCount
  const message =
    data.libraryVideoCount === 0
      ? `Analyse ${target} videos with their raw source files to unlock your channel trends.`
      : `Deeply analyse ${plural(remaining, "more video")} to unlock your channel trends.`

  return (
    <LibraryProgress
      message={message}
      count={data.libraryVideoCount}
      target={target}
    />
  )
}

// The library's headline numbers, in the same tiles the dashboard uses for its
// KPIs. Medians rather than averages, so one breakout upload cannot speak for
// the channel; a tile whose metric no video carries is simply absent.
function ChannelSnapshotCards({ snapshot }: { snapshot: ChannelSnapshot }) {
  const tiles = [
    {
      label: "Videos in library",
      value: snapshot.libraryVideoCount.toLocaleString(),
      icon: VideoIcon,
    },
    {
      label: "Median views / video",
      value:
        snapshot.medianViewsPerVideo == null
          ? null
          : formatCompactNumber(snapshot.medianViewsPerVideo),
      icon: EyeIcon,
    },
    {
      label: "Median watched",
      value:
        snapshot.medianRetentionPercent == null
          ? null
          : `${Math.round(snapshot.medianRetentionPercent)}%`,
      icon: GaugeIcon,
    },
    {
      label: "Median subs / video",
      value:
        snapshot.medianSubsPerVideo == null
          ? null
          : formatCompactNumber(snapshot.medianSubsPerVideo),
      icon: UserPlusIcon,
    },
    {
      label: "Median click-through",
      value:
        snapshot.medianClickThroughRate == null
          ? null
          : `${(snapshot.medianClickThroughRate * 100).toFixed(1)}%`,
      icon: MousePointerClickIcon,
    },
  ].filter(
    (tile): tile is typeof tile & { value: string } => tile.value != null,
  )
  const largeGridColumns = {
    1: "lg:grid-cols-1",
    2: "lg:grid-cols-2",
    3: "lg:grid-cols-3",
    4: "lg:grid-cols-4",
    5: "lg:grid-cols-5",
  }[tiles.length]

  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", largeGridColumns)}>
      {tiles.map(({ label, value, icon: Icon }) => (
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

// --- Page states ------------------------------------------------------------

function BuildingCard() {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <TrendingUpIcon className="size-5 text-muted-foreground" />
      <div className="w-full">
        <p className="text-sm text-muted-foreground">
          Every deep analysis adds its retention events to a private{" "}
          <span className="font-semibold text-foreground">Content Library</span>{" "}
          of your content.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Once {CHANNEL_TRENDS_VIDEO_THRESHOLD} videos are in, this page opens
          and surfaces the patterns that repeat across your channel: what loses
          viewers, what holds them, and how your hooks behave. It waits for all
          of them because a pattern read off two or three uploads is one video
          speaking for your whole channel.
        </p>
      </div>
      <Link href="/analyse-video" className={buttonVariants()}>
        Analyse a video
      </Link>
    </Card>
  )
}

export function ChannelTrends({ data }: { data: ChannelTrendsData }) {
  const showTrends = data.stage === "established"
  const hasRetention = retentionPanelHasContent(data)
  const hasPackaging = packagingPanelHasContent(data)
  const hasScript = scriptPanelHasContent(data)

  return (
    <div className="flex flex-col gap-6">
      <StageProgress data={data} />
      {showTrends ? (
        <>
          <ChannelSnapshotCards snapshot={data.snapshot} />
          <ChannelTrendsTabs
            retention={
              hasRetention ? <RetentionPanel data={data} /> : undefined
            }
            packaging={
              hasPackaging ? <PackagingPanel data={data} /> : undefined
            }
            script={
              hasScript ? <ScriptPanel data={data} /> : undefined
            }
          />
        </>
      ) : (
        <BuildingCard />
      )}
    </div>
  )
}

// The free-plan view: the page exists and explains itself, but the library is a
// paid (deep analysis) feature, so it markets the upgrade instead of rendering
// data.
export function ChannelTrendsLocked() {
  return (
    <PaidFeatureCard feature="Cross-video intelligence">
      Every deep analysis adds its retention events to a private library of your
      content. This page then surfaces the trends that repeat across your
      channel: what loses viewers, what holds them, how your packaging earns
      reach and what your best videos say - insight no single video can give
      you.
    </PaidFeatureCard>
  )
}
