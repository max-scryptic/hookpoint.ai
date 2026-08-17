import Link from "next/link"
import {
  EyeIcon,
  GaugeIcon,
  LockIcon,
  MousePointerClickIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  UserPlusIcon,
  VideoIcon,
  WrenchIcon,
} from "lucide-react"

import { playbookCopy } from "@/components/channel-trends-copy"
import { ContentPanel } from "@/components/channel-trends-content"
import {
  PackagingPanel,
  packagingPanelHasContent,
} from "@/components/channel-trends-packaging"
import { RetentionPanel } from "@/components/channel-trends-retention"
import { ScriptPanel } from "@/components/channel-trends-script"
import {
  CalloutBlock,
  CardEyebrow,
  Chip,
  EventReceipt,
  EvidenceDisclosure,
  SignalMeter,
  formatCompactNumber,
  formatRate,
  percent,
  plural,
} from "@/components/channel-trends-shared"
import { ChannelTrendsTabs } from "@/components/channel-trends-tabs"
import { EventTypeBadge } from "@/components/event-type-badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  EARLY_TRENDS_VIDEO_THRESHOLD,
  ESTABLISHED_TRENDS_VIDEO_THRESHOLD,
  SIGNAL_STRONG_THRESHOLD,
  type ChannelPlaybookRule,
  type ChannelSnapshot,
  type ChannelTrendsData,
} from "@/lib/channel-trends"

// The Channel Trends page body: the unlock meter, the library's headline
// numbers, then five tabs.
//
//   Retention  what keeps viewers and what loses them, from the accumulated
//              event library (components/channel-trends-retention.tsx)
//   Packaging  what your uploads promise, read one surface at a time across its
//              own Hook, Title, Thumbnail and Alignment sub-tabs
//              (components/channel-trends-packaging.tsx)
//   Script     what your videos say, against how much of them gets watched
//              (components/channel-trends-script.tsx)
//   Content    which uploads hold viewers, ranked
//              (components/channel-trends-content.tsx)
//   Playbook   the next-video keep, fix and recover rules, below
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

// The progressive-unlock meter. Building toward EARLY it counts down to the
// first trends; from EARLY it counts toward full strength; at ESTABLISHED the
// meter has nothing left to say, so it disappears and the snapshot tiles take
// the top of the page.
function StageProgress({ data }: { data: ChannelTrendsData }) {
  if (data.stage === "established") {
    return null
  }

  const target =
    data.stage === "early"
      ? ESTABLISHED_TRENDS_VIDEO_THRESHOLD
      : EARLY_TRENDS_VIDEO_THRESHOLD
  const progress = Math.min(100, (data.libraryVideoCount / target) * 100)
  const remaining = target - data.libraryVideoCount
  const message =
    data.stage === "early"
      ? `${data.libraryVideoCount} of ${target} videos - trends strengthening as your library grows.`
      : data.libraryVideoCount === 0
        ? `Analyse ${target} videos with their raw source files to unlock early trends.`
        : `Deeply analyse ${plural(remaining, "more video")} to unlock early trends.`

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{message}</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {data.libraryVideoCount}/{target}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardContent>
    </Card>
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
      label: "Median reach",
      value:
        snapshot.medianViewsPerDay == null
          ? null
          : `${formatCompactNumber(snapshot.medianViewsPerDay)}/day`,
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
      label: "Median subs / 1k views",
      value:
        snapshot.medianSubsPer1k == null
          ? null
          : formatRate(snapshot.medianSubsPer1k),
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

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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

// --- The playbook -----------------------------------------------------------

const PLAYBOOK_KIND_META = {
  keep: {
    label: "Keep doing this",
    comparison: "audience holds vs drop-offs",
    Icon: ShieldCheckIcon,
  },
  fix: {
    label: "Fix this next",
    comparison: "drop-offs vs audience holds",
    Icon: WrenchIcon,
  },
  recover: {
    label: "Recover attention",
    comparison: "retention gains vs audience holds",
    Icon: RefreshCwIcon,
  },
} as const

function PlaybookRuleCard({ rule }: { rule: ChannelPlaybookRule }) {
  const meta = PLAYBOOK_KIND_META[rule.kind]
  const copy = playbookCopy(rule.kind, rule.eventType)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <CardEyebrow icon={meta.Icon}>{meta.label}</CardEyebrow>
        <div>
          <EventTypeBadge eventType={rule.eventType} />
          <h3 className="mt-2 font-heading text-base leading-snug font-medium">
            {copy.headline}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">{copy.action}</p>
        <CalloutBlock label="Next-video rule">{copy.whenToUse}</CalloutBlock>
        <div className="flex flex-wrap gap-1.5">
          <Chip>
            {rule.evidenceVideoCount}/{rule.targetCoveredVideoCount} target
            videos
          </Chip>
          <Chip>
            {rule.controlVideoCount}/{rule.controlCoveredVideoCount} control
            videos
          </Chip>
          <Chip>avg confidence {rule.meanConfidence.toFixed(2)}</Chip>
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {percent(rule.targetRate)} vs {percent(rule.controlRate)}
          </span>{" "}
          across {meta.comparison}
        </div>
        <SignalMeter
          signal={rule.signal}
          strongThreshold={SIGNAL_STRONG_THRESHOLD}
        />
        {rule.receipts.length > 0 && (
          <EvidenceDisclosure
            label={`Open evidence from ${plural(rule.receipts.length, "video")}`}
          >
            {rule.receipts.map((receipt) => (
              <EventReceipt
                key={`${receipt.analysedVideoId}:${receipt.timestampSeconds ?? "unknown"}`}
                narrative={receipt.narrative}
                videoTitle={receipt.videoTitle}
                analysedVideoId={receipt.analysedVideoId}
                timestampSeconds={receipt.timestampSeconds}
              />
            ))}
          </EvidenceDisclosure>
        )}
      </CardContent>
    </Card>
  )
}

function PlaybookPanel({ rules }: { rules: ChannelPlaybookRule[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {rules.map((rule) => (
        <PlaybookRuleCard key={rule.kind} rule={rule} />
      ))}
    </div>
  )
}

// --- Page states ------------------------------------------------------------

function BuildingCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3">
        <TrendingUpIcon className="size-5 text-muted-foreground" />
        <div className="w-full">
          <p className="text-sm text-muted-foreground">
            Every deep analysis adds its retention events to a private{" "}
            <span className="font-medium text-foreground">Content Library</span>{" "}
            of your content.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Once {EARLY_TRENDS_VIDEO_THRESHOLD} videos are in, this page starts
            surfacing the patterns that repeat across your channel: what loses
            viewers, what holds them, and how your hooks behave.
          </p>
        </div>
        <Link href="/dashboard/analyse-video" className={buttonVariants()}>
          Analyse a video
        </Link>
      </CardContent>
    </Card>
  )
}

// A one-line caveat shown above early-stage trends so a three-video pattern
// never reads with full-library authority.
function EarlySignalNote({ data }: { data: ChannelTrendsData }) {
  if (data.stage !== "early") return null
  return (
    <p className="text-xs text-muted-foreground">
      Early signals from {plural(data.libraryVideoCount, "video")} - treat these
      as leads, not verdicts. They firm up as your library approaches{" "}
      {ESTABLISHED_TRENDS_VIDEO_THRESHOLD} videos.
    </p>
  )
}

// One tab's body. The tab bar already names and illustrates the section, so the
// panel opens with the standfirst that would otherwise sit under a heading,
// then the cards. The playbook passes no description: the tab label carries the
// name and its cards say the rest.
function TrendsPanel({
  description,
  children,
}: {
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </section>
  )
}

export function ChannelTrends({ data }: { data: ChannelTrendsData }) {
  const showTrends = data.stage === "early" || data.stage === "established"
  const hasRetention =
    data.insights.length > 0 ||
    data.signature != null ||
    data.recurrence != null ||
    data.dropOffs != null ||
    data.gains != null ||
    data.holds != null ||
    data.hooks != null
  const hasPackaging = packagingPanelHasContent(data)
  const hasScript =
    data.scriptAxes != null ||
    data.scriptExtremes != null ||
    data.scriptStyle != null
  const hasContent = data.retentionRanking != null

  return (
    <div className="flex flex-col gap-6">
      <StageProgress data={data} />
      {showTrends ? (
        <>
          <ChannelSnapshotCards snapshot={data.snapshot} />
          <EarlySignalNote data={data} />
          <ChannelTrendsTabs
            retention={
              hasRetention ? (
                <TrendsPanel description="What keeps viewers watching and where they leave, across every deeply analysed upload.">
                  <RetentionPanel data={data} />
                </TrendsPanel>
              ) : undefined
            }
            packaging={
              hasPackaging ? (
                <TrendsPanel description="What your packaging promises, surface by surface: your hooks, your titles, your thumbnails, and how tightly the three of them agree.">
                  <PackagingPanel data={data} />
                </TrendsPanel>
              ) : undefined
            }
            script={
              hasScript ? (
                <TrendsPanel description="What your videos actually say, measured against how much of them gets watched.">
                  <ScriptPanel data={data} />
                </TrendsPanel>
              ) : undefined
            }
            content={
              hasContent ? (
                <TrendsPanel description="How much of each upload gets watched, ranked across your library.">
                  <ContentPanel data={data} />
                </TrendsPanel>
              ) : undefined
            }
            playbook={
              data.playbook.length > 0 ? (
                <TrendsPanel>
                  <PlaybookPanel rules={data.playbook} />
                </TrendsPanel>
              ) : undefined
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
    <Card>
      <CardContent className="flex flex-col items-start gap-3">
        <LockIcon className="size-5 text-muted-foreground" />
        <div>
          <h2 className="font-heading text-base font-medium">
            Cross-video intelligence is a paid feature
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            On Starter and Pro, every deep analysis adds its retention events to
            a private library of your content. This page then surfaces the
            trends that repeat across your channel: what loses viewers, what
            holds them, how your packaging earns reach and what your best videos
            say - insight no single video can give you.
          </p>
        </div>
        <Link href="/pricing" className={buttonVariants()}>
          See plans
        </Link>
      </CardContent>
    </Card>
  )
}
