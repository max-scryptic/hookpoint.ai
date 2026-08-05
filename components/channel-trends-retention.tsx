import {
  ActivityIcon,
  ChevronDownIcon,
  GitCompareArrowsIcon,
  LayersIcon,
  MinusIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"

import { insightCopy } from "@/components/channel-trends-copy"
import {
  CalloutBlock,
  CardEyebrow,
  Chip,
  CoverageNote,
  EventReceipt,
  EvidenceDisclosure,
  SignalMeter,
  TrendCard,
  plural,
} from "@/components/channel-trends-shared"
import { EventTypeBadge, formatEventTypeLabel } from "@/components/event-type-badge"
import { HookIcon } from "@/components/hook-icon"
import { Card, CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  SIGNAL_STRONG_THRESHOLD,
  type ChannelInsight,
  type ChannelKindTrends,
  type ChannelRecurrence,
  type ChannelRecurrenceRow,
  type ChannelSignatureRow,
  type ChannelTrend,
  type ChannelTrendsData,
  type SignatureVerdict,
} from "@/lib/channel-trends"

// The Retention tab: what the accumulated event library says about where this
// channel keeps viewers and where it loses them. Five blocks, in the order a
// reader needs them:
//
//   insights    the few patterns confident enough to phrase as a verdict
//   signature   every event type placed between the drop side and the gain side
//   recurrence  whether each pattern is still happening, upload by upload
//   top trends  the three most channel-wide patterns per kind
//   breakdown   every pattern and every event, behind one fold
//
// Purely presentational; all aggregation and gating lives in
// lib/channel-trends.ts, all written copy in components/channel-trends-copy.ts.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

const INSIGHT_KIND_META = {
  fix: {
    label: "Your biggest fix",
    actionTitle: "Try this in your next video",
    Icon: TrendingDownIcon,
  },
  strength: {
    label: "Your biggest strength",
    actionTitle: "Do more of this",
    Icon: TrendingUpIcon,
  },
  hook: {
    label: "Your hook pattern",
    actionTitle: "Study your openings",
    Icon: HookIcon,
  },
} as const

// "Almost never in your gains" / "3x more common in drops than gains" - the
// contrast evidence, phrased only when it is pronounced enough to say.
function contrastChip(insight: ChannelInsight): string | null {
  if (insight.contrast == null) return null
  const [own, opposite] =
    insight.kind === "fix" ? ["drops", "gains"] : ["gains", "drops"]
  if (insight.contrast >= 0.95) return `almost never in your ${opposite}`
  const times = insight.contrast / (1 - insight.contrast)
  if (times >= 2)
    return `${Math.round(times)}x more common in ${own} than ${opposite}`
  return null
}

const INSIGHT_RECEIPT_LIMIT = 3

function InsightCard({
  insight,
  trend,
}: {
  insight: ChannelInsight
  trend: ChannelTrend | undefined
}) {
  const meta = INSIGHT_KIND_META[insight.kind]
  const copy = insightCopy(insight.kind, insight.eventType)
  const contrast = contrastChip(insight)
  const receipts = trend?.events.slice(0, INSIGHT_RECEIPT_LIMIT) ?? []
  const hidden = insight.eventCount - receipts.length

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <CardEyebrow icon={meta.Icon}>{meta.label}</CardEyebrow>
        <h3 className="font-heading text-base leading-snug font-medium">
          {copy.headline}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <EventTypeBadge eventType={insight.eventType} />
          <Chip>{plural(insight.videoCount, "video")}</Chip>
          <Chip>{plural(insight.eventCount, "event")}</Chip>
          <Chip>avg confidence {insight.meanConfidence.toFixed(2)}</Chip>
          {contrast && <Chip>{contrast}</Chip>}
        </div>
        <SignalMeter
          signal={insight.signal}
          strongThreshold={SIGNAL_STRONG_THRESHOLD}
        />
        <CalloutBlock label={meta.actionTitle}>{copy.action}</CalloutBlock>
        {receipts.length > 0 && (
          <EvidenceDisclosure
            label={`See the ${plural(insight.eventCount, "event")} behind this`}
          >
            {receipts.map((event, index) => (
              <EventReceipt
                key={`${event.videoTitle ?? ""}:${event.narrative}:${index}`}
                narrative={event.narrative}
                videoTitle={event.videoTitle}
              />
            ))}
            {hidden > 0 && (
              <p className="pl-3 text-xs text-muted-foreground">
                and {plural(hidden, "more event")} in the full breakdown below
              </p>
            )}
          </EvidenceDisclosure>
        )}
      </CardContent>
    </Card>
  )
}

// Where an insight's receipts live: the matching per-kind trend row.
function trendForInsight(
  data: ChannelTrendsData,
  insight: ChannelInsight,
): ChannelTrend | undefined {
  const kind =
    insight.kind === "fix"
      ? data.dropOffs
      : insight.kind === "strength"
        ? data.gains
        : data.hooks
  return kind?.trends.find((trend) => trend.eventType === insight.eventType)
}

// --- The signature ----------------------------------------------------------
// Every event type placed between the two sides: how much of everything that
// happened where viewers left it accounts for, against how much of everything
// that happened where they came back. A type sitting on one side is signal; a
// type sitting evenly across both is how the channel is edited, and the page
// says so rather than leaving the reader to guess.

const VERDICT_COPY: Record<SignatureVerdict, string> = {
  hurting: "costing viewers",
  working: "winning viewers",
  style: "your editing style",
  insufficient: "too few videos to call",
}

// Rows are drawn against the largest share on the page rather than against
// 100%, so a channel whose biggest type accounts for a fifth of a side still
// gets a readable chart.
function SignatureRow({
  row,
  scale,
}: {
  row: ChannelSignatureRow
  scale: number
}) {
  const width = (share: number) => `${Math.min(50, (share / scale) * 50)}%`
  return (
    <div className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-x-3 py-1.5">
      <span className="truncate text-sm">
        {formatEventTypeLabel(row.eventType)}
      </span>
      <div className="relative flex h-4 items-stretch">
        <div className="flex w-1/2 justify-end">
          <div
            className="rounded-l-sm bg-muted-foreground/50"
            style={{ width: width(row.dropShare) }}
            title={`${plural(row.dropEventCount, "event")} in drop-offs, across ${plural(row.dropVideoCount, "video")}`}
          />
        </div>
        <div className="flex w-1/2 justify-start">
          <div
            className="rounded-r-sm bg-foreground/60"
            style={{ width: width(row.gainShare) }}
            title={`${plural(row.gainEventCount, "event")} in gains, across ${plural(row.gainVideoCount, "video")}`}
          />
        </div>
        <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-foreground/30" />
      </div>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {VERDICT_COPY[row.verdict]}
      </span>
    </div>
  )
}

function SignatureCard({ signature }: { signature: ChannelSignatureRow[] }) {
  const rows = signature.filter(
    (row) => row.dropShare > 0 || row.gainShare > 0,
  )
  if (rows.length === 0) return null
  const scale = Math.max(
    ...rows.map((row) => Math.max(row.dropShare, row.gainShare)),
  )
  if (scale <= 0) return null

  return (
    <TrendCard
      icon={GitCompareArrowsIcon}
      title="Your retention signature"
      description="Every pattern the synthesis found, placed between the moments viewers left and the moments they came back. Bars are confidence-weighted shares of each side, so a long bar means the pattern accounts for a lot of what happened there. A pattern that sits evenly across both sides is how you edit, not a problem to fix."
    >
      <div className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] gap-x-3 text-xs text-muted-foreground">
        <span />
        <div className="flex justify-between">
          <span>where viewers left</span>
          <span>where they came back</span>
        </div>
        <span />
      </div>
      <div>
        {rows.map((row) => (
          <SignatureRow key={row.eventType} row={row} scale={scale} />
        ))}
      </div>
    </TrendCard>
  )
}

// --- The recurrence strip ---------------------------------------------------
// The only view on the page that shows change: for the patterns that recur
// most, which of the most recent uploads each one turned up in. A run of hits
// ending at the newest upload is still happening; a gap at the newest end is a
// pattern that has gone quiet since you acted on it.

const RECURRENCE_SIDE_LABEL = {
  drop_off: "in drop-offs",
  gain: "in gains",
} as const

function recurrenceStatus(row: ChannelRecurrenceRow): string {
  if (row.hitCount === 0) return "not seen recently"
  if (row.currentStreak >= 2) {
    return `${plural(row.currentStreak, "upload")} in a row`
  }
  if (row.videosSinceLastHit === 0) return "in your newest upload"
  return `not seen in the last ${plural(row.videosSinceLastHit, "upload")}`
}

function RecurrenceCard({ recurrence }: { recurrence: ChannelRecurrence }) {
  const { videos, rows } = recurrence
  return (
    <TrendCard
      icon={ActivityIcon}
      title="Is it still happening"
      description="Your most recurring patterns across your most recent uploads, oldest on the left. A filled cell means the pattern turned up in that video; a run ending on the right is still happening, and a gap on the right is one you have shaken off."
      footer={`Columns are your last ${plural(videos.length, "deeply analysed upload")}, ordered by when they were analysed.`}
    >
      <div className="flex flex-col gap-2 overflow-x-auto">
        {rows.map((row) => (
          <div
            key={`${row.side}:${row.eventType}`}
            className="grid min-w-md grid-cols-[minmax(9rem,14rem)_1fr_minmax(7rem,auto)] items-center gap-x-3"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm">
                {formatEventTypeLabel(row.eventType)}
              </span>
              <span className="text-xs text-muted-foreground">
                {RECURRENCE_SIDE_LABEL[row.side]}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {row.cells.map((cell, index) => (
                <span
                  key={videos[index]?.id ?? index}
                  title={`${videos[index]?.title ?? "Untitled video"}: ${cell.hit ? "present" : "not present"}`}
                  className={`h-5 flex-1 rounded-sm ${
                    cell.hit ? "bg-foreground/60" : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <span className="text-right text-xs whitespace-nowrap text-muted-foreground">
              {recurrenceStatus(row)}
            </span>
          </div>
        ))}
      </div>
    </TrendCard>
  )
}

// --- Trend rows and the full breakdown --------------------------------------

// One expandable trend row: the event type and its channel-wide counts on the
// collapsed line, the individual occurrences (ranked by confidence) revealed on
// expand.
function TrendRow({ trend }: { trend: ChannelTrend }) {
  const hidden = trend.eventCount - trend.events.length
  return (
    <Collapsible className="border-b last:border-b-0">
      <CollapsibleTrigger className="group flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-3 text-left">
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        <EventTypeBadge eventType={trend.eventType} />
        <span className="text-sm font-medium tabular-nums">
          {plural(trend.eventCount, "event")}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          across {plural(trend.videoCount, "video")}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pb-3 pl-7">
        {trend.events.map((event, index) => (
          <EventReceipt
            key={`${event.videoTitle ?? ""}:${event.narrative}:${index}`}
            narrative={event.narrative}
            videoTitle={event.videoTitle}
          />
        ))}
        {hidden > 0 && (
          <p className="pl-3 text-xs text-muted-foreground">
            and {plural(hidden, "more event")}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

// The top-3 tabs: the quick read, splitting the recurring patterns by whether
// viewers leave, return, or stay unusually steady. Trends arrive ordered
// most-channel-wide first, so a slice is the top 3; the exhaustive list stays
// in the full breakdown below.
const RETENTION_TRENDS_TAB_LIMIT = 3

function RetentionTrendsTabs({
  dropOffs,
  gains,
  holds,
}: {
  dropOffs: ChannelKindTrends | null
  gains: ChannelKindTrends | null
  holds: ChannelKindTrends | null
}) {
  const tabs = [
    {
      value: "drop-offs",
      label: "Drop-offs",
      icon: <TrendingDownIcon className="text-muted-foreground" />,
      description:
        "Your top 3 recurring drop-off patterns, most channel-wide first.",
      trends: dropOffs?.trends.slice(0, RETENTION_TRENDS_TAB_LIMIT) ?? [],
    },
    {
      value: "gains",
      label: "Gains",
      icon: <TrendingUpIcon className="text-muted-foreground" />,
      description:
        "Your top 3 recurring retention gains, most channel-wide first.",
      trends: gains?.trends.slice(0, RETENTION_TRENDS_TAB_LIMIT) ?? [],
    },
    {
      value: "holds",
      label: "Holds",
      icon: <MinusIcon className="text-muted-foreground" />,
      description:
        "Your top 3 recurring audience-hold patterns, most channel-wide first.",
      trends: holds?.trends.slice(0, RETENTION_TRENDS_TAB_LIMIT) ?? [],
    },
  ].filter((tab) => tab.trends.length > 0)

  if (tabs.length === 0) return null

  return (
    <TrendCard
      icon={LayersIcon}
      title="Top retention trends"
      description="The patterns that recur across the most of your uploads, split by whether viewers leave, return, or remain unusually steady."
    >
      <Tabs defaultValue={tabs[0].value}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent
            key={tab.value}
            value={tab.value}
            className="flex flex-col gap-2"
          >
            <CoverageNote>{tab.description}</CoverageNote>
            <div className="rounded-lg border px-3">
              {tab.trends.map((trend) => (
                <TrendRow key={trend.eventType} trend={trend} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </TrendCard>
  )
}

function FullBreakdown({ data }: { data: ChannelTrendsData }) {
  const sections = [
    {
      value: "loses",
      label: "What loses viewers",
      description:
        "The causes that recur across your drop-offs, most channel-wide first.",
      kind: data.dropOffs,
    },
    {
      value: "gains",
      label: "Retention gains",
      description:
        "The patterns around moments viewers replayed or returned to.",
      kind: data.gains,
    },
    {
      value: "holds",
      label: "Audience holds",
      description:
        "The patterns that recur where your audience stayed unusually steady.",
      kind: data.holds,
    },
    {
      value: "hooks",
      label: "Hook patterns",
      description:
        "What your openings have in common when viewers stay or slip away.",
      kind: data.hooks,
    },
  ].filter(
    (section): section is typeof section & { kind: ChannelKindTrends } =>
      section.kind != null,
  )
  if (sections.length === 0) return null

  return (
    <Collapsible className="rounded-xl bg-card ring-1 ring-foreground/10">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 p-4 text-left text-sm font-medium">
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        Full breakdown
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          every pattern, every event
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-6 border-t p-4">
        {sections.map((section) => (
          <section key={section.value} className="flex flex-col gap-2">
            <div className="text-sm font-medium">{section.label}</div>
            <CoverageNote>{section.description}</CoverageNote>
            <div className="rounded-lg border px-3">
              {section.kind.trends.map((trend) => (
                <TrendRow key={trend.eventType} trend={trend} />
              ))}
            </div>
          </section>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function RetentionPanel({ data }: { data: ChannelTrendsData }) {
  return (
    <>
      {data.insights.length > 0 && (
        <div className="flex flex-col gap-3">
          {data.insights.map((insight) => (
            <InsightCard
              key={insight.kind}
              insight={insight}
              trend={trendForInsight(data, insight)}
            />
          ))}
        </div>
      )}
      {data.signature != null && <SignatureCard signature={data.signature} />}
      {data.recurrence != null && (
        <RecurrenceCard recurrence={data.recurrence} />
      )}
      <RetentionTrendsTabs
        dropOffs={data.dropOffs}
        gains={data.gains}
        holds={data.holds}
      />
      <FullBreakdown data={data} />
    </>
  )
}
