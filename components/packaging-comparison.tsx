import Image from "next/image"
import type { ReactNode } from "react"
import { LayersIcon, PlayIcon, TrophyIcon } from "lucide-react"

import { PackagingReportTabs } from "@/components/packaging-report-tabs"
import { TryCallout } from "@/components/try-callout"
import { Card } from "@/components/ui/card"
import { stripEmDashes } from "@/lib/copy-guardrails"
import { cn } from "@/lib/utils"
import {
  PACKAGING_REPORT_SURFACE_LABEL,
  PACKAGING_REPORT_SURFACE_TAB_LABEL,
  type PackagingComparisonReport,
  type PackagingReportDriver,
  type PackagingReportRecommendation,
  type PackagingReportSurface,
  type PackagingReportSurfaceRead,
} from "@/lib/packaging-comparison-report"
import {
  type PackagingComparison,
  type Side,
} from "@/lib/packaging-comparison"

// The packaging head-to-head body: which of two uploads the packaging favours
// and why, read straight from the stored per-video taxonomies with no model
// call at view time. The written report tells the whole story: a verdict, then
// one tab per surface (title, thumbnail, hook, cross-surface) carrying the two
// videos' own material, the read of each and the drivers behind it. The
// field-by-field taxonomy diff is deliberately not shown; the comparison is
// still read for the verbatim spans the surface tabs quote. Purely
// presentational; all the maths live in lib/packaging-comparison.ts.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

const SIDE_META = {
  a: { dot: "var(--chart-1)", name: "A" },
  b: { dot: "var(--chart-2)", name: "B" },
} as const

// The report's four surfaces, in the order their tabs read: the three things a
// viewer meets (title, thumbnail, opening) and then the summary of how those
// three fit together.
const SURFACE_TAB_ORDER: PackagingReportSurface[] = [
  "title",
  "thumbnail",
  "hook",
  "alignment",
]

// The verbatim span each surface tab quotes above the model's read of it. The
// title comes off the video itself, and the summary tab is about the other
// three rather than about a surface of its own, so neither appears here. The
// hook entry is only a fallback: that tab quotes the whole spoken first ten
// seconds when the comparison carries it, and drops back to the taxonomy's
// opening line when it does not.
const SURFACE_SPAN_KEY: Partial<Record<PackagingReportSurface, string>> = {
  thumbnail: "thumbnail.textVerbatim",
  hook: "hook.firstSentence",
}

function clean(text: string): string {
  return stripEmDashes(text)
}

function SideDot({ side }: { side: Side }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: SIDE_META[side].dot }}
    />
  )
}

// --- The written report ------------------------------------------------------
// A model reads both thumbnails, both titles and the full stored evidence for
// each video's first ten seconds, then explains why one out-performed the
// other. Generated once when the pair is created and stored on the comparison,
// so this renders from JSON with no call at view time.

// The one-paragraph read of which video packaged itself better, sitting bare
// above the tabs rather than in a card of its own: the surrounding section is
// already a card, and the badges and confidence label it used to carry are
// restated by the per-surface panels below.
function ReportVerdict({
  verdict,
}: {
  verdict: PackagingComparisonReport["verdict"]
}) {
  if (!verdict.summary) return null
  return <p className="text-sm">{clean(verdict.summary)}</p>
}

// The verbatim span behind one surface on one side, read off the deterministic
// diff rather than the report so the tab quotes the stored taxonomy rather than
// the model's paraphrase of it.
function spanText(
  comparison: PackagingComparison,
  key: string,
  side: Side,
): string {
  const row = comparison.spans.find((candidate) => candidate.key === key)
  if (!row) return ""
  return (side === "a" ? row.a : row.b).trim()
}

// The actual thing being argued about, for one video: its real title, its real
// thumbnail, everything it says in its real first ten seconds. It sits above
// the model's read of that side so the read always has its subject next to it.
function SurfaceEvidence({
  surface,
  side,
  comparison,
}: {
  surface: PackagingReportSurface
  side: Side
  comparison: PackagingComparison
}) {
  const video = comparison[side]

  if (surface === "title") {
    return (
      <p className="text-lg leading-snug font-semibold">
        {video.title ? clean(video.title) : "Untitled video"}
      </p>
    )
  }

  if (surface === "thumbnail") {
    const text = spanText(comparison, SURFACE_SPAN_KEY.thumbnail ?? "", side)
    return (
      <div className="flex flex-col gap-2">
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-background">
          {video.thumbnailUrl ? (
            <Image
              src={video.thumbnailUrl}
              alt=""
              fill
              sizes="(min-width: 640px) 50vw, 100vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <PlayIcon className="size-6" />
            </div>
          )}
        </div>
        {text.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Thumbnail text: {clean(text)}
          </p>
        )}
      </div>
    )
  }

  if (surface === "hook") {
    // The hook IS the first ten seconds, so quote all of it. The taxonomy's
    // single opening line only stands in for a video whose transcript never
    // reached the comparison, and says so when it does.
    const transcript = (video.hookTranscript ?? "").trim()
    const firstSentence = spanText(comparison, SURFACE_SPAN_KEY.hook ?? "", side)
    const text = transcript.length > 0 ? transcript : firstSentence
    if (text.length === 0) {
      return (
        <p className="text-base text-muted-foreground">
          No opening captured for this video.
        </p>
      )
    }
    return (
      <div className="flex flex-col gap-1">
        <p className="text-base leading-relaxed">{`"${clean(text)}"`}</p>
        {transcript.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Opening line only; no transcript is stored for this video&apos;s
            first 10 seconds.
          </p>
        )}
      </div>
    )
  }

  return null
}

// Both videos side by side for one surface: A on the left, B on the right, each
// column carrying that video's own material and then what the report makes of
// it. No cards here; the two sides are separated by a single dotted rule down
// the middle, which stops where the columns do, so whatever the panel says
// about the pair as a whole sits below both of them unenclosed. The summary tab
// is about how the other three fit together rather than about a surface of its
// own, so it shows the reads alone.
function SurfaceColumns({
  surface,
  comparison,
  read,
}: {
  surface: PackagingReportSurface
  comparison: PackagingComparison
  read: PackagingReportSurfaceRead | null
}) {
  const sides: Side[] = ["a", "b"]
  const hasEvidence = surface !== "alignment"
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2">
      {sides.map((side, index) => {
        const readText = (
          read == null ? "" : side === "a" ? read.aRead : read.bRead
        ).trim()
        const isTop = comparison.higherViewsSide === side
        const isStronger = read != null && read.strongerSide === side
        return (
          <div
            key={side}
            className={cn(
              "flex flex-col gap-3",
              index === 0
                ? "pb-5 sm:pr-6 sm:pb-0"
                : "border-t border-dotted pt-5 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <SideDot side={side} />
              <span className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                Video {SIDE_META[side].name}
              </span>
              {isTop && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-500">
                  <TrophyIcon className="size-3.5" />
                  most views
                </span>
              )}
              {isStronger && (
                <span className="ml-auto rounded-full border bg-card px-2 py-0.5 text-xs text-muted-foreground">
                  stronger here
                </span>
              )}
            </div>
            {hasEvidence && (
              <SurfaceEvidence
                surface={surface}
                side={side}
                comparison={comparison}
              />
            )}
            {readText.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {clean(readText)}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// The ranked reasons this surface moved the result, each closing on the one
// change its evidence argues for. Anything else this surface is worth trying
// (the report's recommendations) hangs off the last tip as "Or:" lines, so a
// surface closes on one block of advice rather than two.
function SurfaceDrivers({
  drivers,
  higherViewsSide,
  alternatives,
}: {
  drivers: PackagingReportDriver[]
  higherViewsSide: Side | null
  alternatives: ReactNode[]
}) {
  const lastTipIndex = drivers.reduce(
    (last, driver, index) => (driver.tip ? index : last),
    -1,
  )
  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {drivers.map((driver, index) => (
        <div
          key={`${driver.surface}:${driver.label}:${index}`}
          className="flex flex-col gap-1.5 px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{clean(driver.label)}</span>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <SideDot side={driver.favours} />
              favours {SIDE_META[driver.favours].name}
              {higherViewsSide === driver.favours && (
                <span className="text-emerald-600 dark:text-emerald-500">
                  (the higher-viewed one)
                </span>
              )}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {clean(driver.detail)}
          </p>
          {driver.evidence.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {driver.evidence.map((item, evidenceIndex) => (
                <span
                  key={`${item}:${evidenceIndex}`}
                  className="rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {clean(item)}
                </span>
              ))}
            </div>
          )}
          {driver.tip && (
            <TryCallout
              alternatives={index === lastTipIndex ? alternatives : []}
            >
              {driver.tip}
            </TryCallout>
          )}
        </div>
      ))}
    </div>
  )
}

interface SurfaceTab {
  surface: PackagingReportSurface
  read: PackagingReportSurfaceRead | null
  drivers: PackagingReportDriver[]
  recommendations: PackagingReportRecommendation[]
}

// Everything the report has to say about one surface, in one panel: the two
// videos' own material, the read of each, why the difference matters, then the
// drivers, whose tips carry the rest of this surface's advice with them. A
// surface no driver tipped closes on its own tip instead, so every tab ends on
// a "Try:" line.
function SurfacePanel({
  tab,
  comparison,
}: {
  tab: SurfaceTab
  comparison: PackagingComparison
}) {
  const caption = PACKAGING_REPORT_SURFACE_LABEL[tab.surface]
  const showCaption = caption !== PACKAGING_REPORT_SURFACE_TAB_LABEL[tab.surface]
  // The recommendations ride along with the driver tips as bare "Or:" lines:
  // like the tips, each one is advice for the uploader's next video rather than
  // a change to either published video, so none of them names a side.
  const alternatives = tab.recommendations.map(
    (recommendation) => recommendation.action,
  )
  const hasDriverTip = tab.drivers.some((driver) => driver.tip)
  // Every tab has to close on something to try, and a surface the drivers
  // passed over has no tip inside the drivers list to hang one off. So when no
  // driver here carried a tip, this surface's own tip leads a callout of its
  // own and the recommendations follow it as "Or:" lines. Reports stored before
  // schema version 4 carry no surface tip, and ones before version 2 no driver
  // tips either, so the first recommendation leads for those; a surface with
  // none of the three is the one case that still closes without advice.
  const surfaceTip = tab.read?.tip?.trim() ?? ""
  const standaloneTip =
    surfaceTip.length > 0 ? surfaceTip : (alternatives[0] ?? null)
  const standaloneAlternatives =
    surfaceTip.length > 0 ? alternatives : alternatives.slice(1)
  return (
    <div className="flex flex-col gap-4">
      {showCaption && (
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {caption}
        </p>
      )}
      <SurfaceColumns
        surface={tab.surface}
        comparison={comparison}
        read={tab.read}
      />
      {tab.read?.whyItMatters && (
        <p className="text-base leading-relaxed text-muted-foreground">
          {clean(tab.read.whyItMatters)}
        </p>
      )}
      {tab.drivers.length > 0 && (
        <SurfaceDrivers
          drivers={tab.drivers}
          higherViewsSide={comparison.higherViewsSide}
          alternatives={hasDriverTip ? alternatives : []}
        />
      )}
      {!hasDriverTip && standaloneTip != null && (
        <TryCallout alternatives={standaloneAlternatives}>
          {standaloneTip}
        </TryCallout>
      )}
    </div>
  )
}

function ReportNarrative({
  report,
  comparison,
}: {
  report: PackagingComparisonReport
  comparison: PackagingComparison
}) {
  // One tab per surface, in reading order, skipping any the report had nothing
  // to say about.
  const tabs: SurfaceTab[] = SURFACE_TAB_ORDER.map((surface) => ({
    surface,
    read: report.surfaces.find((read) => read.surface === surface) ?? null,
    drivers: report.drivers.filter((driver) => driver.surface === surface),
    recommendations: report.recommendations.filter(
      (recommendation) => recommendation.surface === surface,
    ),
  })).filter(
    (tab) =>
      tab.read != null ||
      tab.drivers.length > 0 ||
      tab.recommendations.length > 0,
  )

  return (
    <div className="flex flex-col gap-4">
      <ReportVerdict verdict={report.verdict} />
      {tabs.length > 0 && (
        <PackagingReportTabs
          tabs={tabs.map((tab) => ({
            value: tab.surface,
            label: PACKAGING_REPORT_SURFACE_TAB_LABEL[tab.surface],
            content: <SurfacePanel tab={tab} comparison={comparison} />,
          }))}
        />
      )}
      {report.caveats.length > 0 && (
        <ul className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {report.caveats.map((caveat, index) => (
            <li key={`${caveat}:${index}`}>{clean(caveat)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function PackagingComparison({
  data,
  report = null,
}: {
  data: PackagingComparison
  report?: PackagingComparisonReport | null
}) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <div className="flex items-center gap-1.5">
          <LayersIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Packaging head-to-head</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Why one of these earned the click and the other did not: a written
          read of both thumbnails, both titles and both openings. Observations
          are correlation, not proof.
        </p>
      </div>

      {report ? (
        <ReportNarrative report={report} comparison={data} />
      ) : (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {data.a.hasTaxonomy && data.b.hasTaxonomy
            ? "Both videos have a packaging read, but the written head-to-head has not been generated for this pair yet."
            : data.a.hasTaxonomy || data.b.hasTaxonomy
              ? "Only one of these videos has a packaging read so far. Open the other video's analysis to generate it, then this fills in."
              : "Neither video has a packaging read yet."}
        </p>
      )}
    </Card>
  )
}
