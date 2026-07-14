import Link from "next/link"
import {
  LibraryIcon,
  LockIcon,
  SparklesIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react"

import { EventTypeBadge } from "@/components/event-type-badge"
import { HookIcon } from "@/components/hook-icon"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  EARLY_TRENDS_VIDEO_THRESHOLD,
  ESTABLISHED_TRENDS_VIDEO_THRESHOLD,
  type ChannelKindTrends,
  type ChannelTrend,
  type ChannelTrendsData,
} from "@/lib/channel-trends"

// The Channel Trends page body: the cross-video event library's size, a
// progress meter toward the next unlock stage, and — once enough videos have
// been deeply analysed — the per-kind trend breakdowns. Purely presentational;
// all aggregation lives in lib/channel-trends.ts.

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function LibraryStats({ data }: { data: ChannelTrendsData }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatTile label="Videos in your library" value={data.libraryVideoCount} />
      <StatTile label="Retention windows analysed" value={data.windowCount} />
      <StatTile label="Retention events collected" value={data.eventCount} />
    </div>
  )
}

// The progressive-unlock meter. Building toward EARLY it counts down to the
// first trends; from EARLY it counts toward full strength; at ESTABLISHED it
// becomes a quiet confirmation instead of a bar.
function StageProgress({ data }: { data: ChannelTrendsData }) {
  if (data.stage === "established") {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm">
        <SparklesIcon className="size-4 shrink-0 text-primary" />
        <span>
          Trends at full strength — built from{" "}
          {plural(data.libraryVideoCount, "deeply analysed video")}.
        </span>
      </div>
    )
  }

  const target =
    data.stage === "early"
      ? ESTABLISHED_TRENDS_VIDEO_THRESHOLD
      : EARLY_TRENDS_VIDEO_THRESHOLD
  const percent = Math.min(100, (data.libraryVideoCount / target) * 100)
  const remaining = target - data.libraryVideoCount
  const message =
    data.stage === "early"
      ? `${data.libraryVideoCount} of ${target} videos — trends strengthening as your library grows.`
      : `Deeply analyse ${plural(remaining, "more video")} to unlock early trends.`

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{message}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {data.libraryVideoCount}/{target}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function TrendCard({ trend }: { trend: ChannelTrend }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <EventTypeBadge eventType={trend.eventType} />
        <span className="text-xs text-muted-foreground">
          {plural(trend.eventCount, "event")} across{" "}
          {plural(trend.videoCount, "video")}
        </span>
      </div>
      {trend.videoTitles.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Seen in {trend.videoTitles.join(" · ")}
          {trend.videoCount > trend.videoTitles.length ? " and more" : ""}
        </p>
      )}
      {trend.examples.map((example) => (
        <blockquote
          key={`${example.videoTitle ?? ""}:${example.narrative}`}
          className="border-l-2 pl-3 text-xs text-muted-foreground italic"
        >
          {example.narrative}
          {example.videoTitle && (
            <span className="not-italic"> — {example.videoTitle}</span>
          )}
        </blockquote>
      ))}
    </div>
  )
}

function TrendsSection({
  description,
  kind,
}: {
  description: string
  kind: ChannelKindTrends
}) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {kind.trends.map((trend) => (
          <TrendCard key={trend.eventType} trend={trend} />
        ))}
      </div>
    </section>
  )
}

function BuildingCard({ data }: { data: ChannelTrendsData }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <LibraryIcon className="size-5 text-muted-foreground" />
      <div>
        <h2 className="text-base font-semibold">
          {data.stage === "empty"
            ? "Start your content library"
            : "Your library is growing"}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every deep analysis adds its retention events to a private library of
          your content. Once{" "}
          {EARLY_TRENDS_VIDEO_THRESHOLD} videos are in, this page starts
          surfacing the patterns that repeat across your channel — what loses
          viewers, what holds them, and how your hooks behave.
        </p>
      </div>
      <Link href="/dashboard/analyse-video" className={buttonVariants()}>
        Analyse a video
      </Link>
    </Card>
  )
}

// A one-line caveat shown above early-stage trends so a three-video pattern
// never reads with ten-video authority.
function EarlySignalNote({ data }: { data: ChannelTrendsData }) {
  if (data.stage !== "early") return null
  return (
    <p className="text-xs text-muted-foreground">
      Early signals from {plural(data.libraryVideoCount, "video")} — treat
      these as leads, not verdicts. They firm up as your library approaches{" "}
      {ESTABLISHED_TRENDS_VIDEO_THRESHOLD} videos.
    </p>
  )
}

export function ChannelTrends({ data }: { data: ChannelTrendsData }) {
  const showTrends = data.stage === "early" || data.stage === "established"

  // Each section becomes a tab, but only when it actually has trends to show —
  // mirroring the per-window tabs on the analysed-video page.
  const sections = [
    {
      value: "loses",
      label: "What loses viewers",
      icon: <TrendingDownIcon className="text-destructive" />,
      description:
        "The causes that recur across your drop-offs, most channel-wide first.",
      kind: data.dropOffs,
    },
    {
      value: "holds",
      label: "What holds viewers",
      icon: (
        <TrendingUpIcon className="text-emerald-600 dark:text-emerald-500" />
      ),
      description:
        "The patterns your retention gains keep coming back to — worth repeating on purpose.",
      kind: data.gains,
    },
    {
      value: "hooks",
      label: "Hook patterns",
      icon: <HookIcon className="text-amber-600 dark:text-amber-500" />,
      description:
        "What your openings have in common when viewers stay or slip away.",
      kind: data.hooks,
    },
  ].filter(
    (section): section is typeof section & { kind: ChannelKindTrends } =>
      section.kind != null
  )

  return (
    <div className="flex flex-col gap-6">
      <LibraryStats data={data} />
      <StageProgress data={data} />
      {showTrends ? (
        <>
          <EarlySignalNote data={data} />
          {sections.length > 0 && (
            <Tabs defaultValue={sections[0].value}>
              <TabsList>
                {sections.map((section) => (
                  <TabsTrigger key={section.value} value={section.value}>
                    {section.icon}
                    {section.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {sections.map((section) => (
                <TabsContent key={section.value} value={section.value}>
                  <TrendsSection
                    description={section.description}
                    kind={section.kind}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </>
      ) : (
        <BuildingCard data={data} />
      )}
    </div>
  )
}

// The free-plan view: the page exists and explains itself, but the library is
// a paid (deep analysis) feature, so it markets the upgrade instead of
// rendering data.
export function ChannelTrendsLocked() {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <LockIcon className="size-5 text-muted-foreground" />
      <div>
        <h2 className="text-base font-semibold">
          Cross-video intelligence is a paid feature
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          On Starter and Pro, every deep analysis adds its retention events to
          a private library of your content. This page then surfaces the
          trends that repeat across your channel: what loses viewers, what
          holds them, and how your hooks behave — insight no single video can
          give you.
        </p>
      </div>
      <Link href="/pricing" className={buttonVariants()}>
        See plans
      </Link>
    </Card>
  )
}
