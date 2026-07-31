import Image from "next/image"
import type { ReactNode } from "react"
import {
  ArrowRightIcon,
  LayersIcon,
  MinusIcon,
  PlayIcon,
  TrophyIcon,
} from "lucide-react"

import { PackagingReportTabs } from "@/components/packaging-report-tabs"
import { TryCallout } from "@/components/try-callout"
import { Card } from "@/components/ui/card"
import { stripEmDashes } from "@/lib/copy-guardrails"
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
  SURFACE_LABEL,
  type CategoricalComparisonRow,
  type ComparisonSurface,
  type FlagComparisonRow,
  type OrdinalComparisonRow,
  type PackagingComparison,
  type Side,
  type SpanComparisonRow,
} from "@/lib/packaging-comparison"

// The packaging head-to-head body: which of two uploads the packaging favours
// and why, read straight from the stored per-video taxonomies with no model
// call at view time. The written report tells the story, then each surface
// (title, thumbnail, hook, cross-surface, drivers) shows its field-by-field
// diff, and the verbatim spans put the real titles, thumbnail text and opening
// lines side by side. Purely presentational; all the maths live in
// lib/packaging-comparison.ts.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

const SIDE_META = {
  a: { dot: "var(--chart-1)", name: "A", bar: "bg-[var(--chart-1)]" },
  b: { dot: "var(--chart-2)", name: "B", bar: "bg-[var(--chart-2)]" },
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

const SURFACE_ORDER: ComparisonSurface[] = [
  "title",
  "thumbnail",
  "hook",
  "cross",
  "drivers",
  "overall",
]

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

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return "high confidence"
  if (confidence >= 0.45) return "moderate confidence"
  return "low confidence"
}

function SideBadge({ side }: { side: Side }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium">
      <SideDot side={side} />
      Video {SIDE_META[side].name}
    </span>
  )
}

function ReportVerdict({
  verdict,
  higherViewsSide,
}: {
  verdict: PackagingComparisonReport["verdict"]
  higherViewsSide: Side | null
}) {
  const stronger = verdict.strongerSide
  const matchesViews = stronger !== "neither" && stronger === higherViewsSide
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">The verdict</h4>
        {stronger === "neither" ? (
          <span className="text-xs text-muted-foreground">
            too close to call
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            stronger packaging: <SideBadge side={stronger} />
            {matchesViews && (
              <span className="text-emerald-600 dark:text-emerald-500">
                (also the higher-viewed one)
              </span>
            )}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {confidenceLabel(verdict.confidence)}
        </span>
      </div>
      {verdict.summary && <p className="text-sm">{clean(verdict.summary)}</p>}
    </div>
  )
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
      <p className="text-sm font-medium">
        {video.title ? clean(video.title) : "Untitled video"}
      </p>
    )
  }

  if (surface === "thumbnail") {
    const text = spanText(comparison, SURFACE_SPAN_KEY.thumbnail ?? "", side)
    return (
      <div className="flex flex-col gap-1.5">
        <div className="relative aspect-video w-full max-w-56 overflow-hidden rounded-md bg-background">
          {video.thumbnailUrl ? (
            <Image
              src={video.thumbnailUrl}
              alt=""
              fill
              sizes="224px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <PlayIcon className="size-5" />
            </div>
          )}
        </div>
        {text.length > 0 && (
          <p className="text-xs text-muted-foreground">
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
        <p className="text-sm text-muted-foreground">
          No opening captured for this video.
        </p>
      )
    }
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm">{`"${clean(text)}"`}</p>
        {transcript.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
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
// it. The summary tab is about how the other three fit together rather than
// about a surface of its own, so it shows the reads alone.
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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {sides.map((side) => {
        const readText = (
          read == null ? "" : side === "a" ? read.aRead : read.bRead
        ).trim()
        const isTop = comparison.higherViewsSide === side
        const isStronger = read != null && read.strongerSide === side
        return (
          <div
            key={side}
            className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <SideDot side={side} />
              <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                Video {SIDE_META[side].name}
              </span>
              {isTop && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-500">
                  <TrophyIcon className="size-3" />
                  most views
                </span>
              )}
              {isStronger && (
                <span className="ml-auto rounded-full border bg-card px-1.5 py-px text-[10px] text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">
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
// drivers, whose tips carry the rest of this surface's advice with them.
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
  // a change to either published video, so none of them names a side. When no
  // driver on this surface carried a tip (reports stored before schema version
  // 2 have no tips at all), the first recommendation leads the callout instead.
  const alternatives = tab.recommendations.map(
    (recommendation) => recommendation.action,
  )
  const hasDriverTip = tab.drivers.some((driver) => driver.tip)
  return (
    <div className="flex flex-col gap-3">
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
        <p className="text-sm text-muted-foreground">
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
      {!hasDriverTip && alternatives.length > 0 && (
        <TryCallout alternatives={alternatives.slice(1)}>
          {alternatives[0]}
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
      <ReportVerdict
        verdict={report.verdict}
        higherViewsSide={comparison.higherViewsSide}
      />
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

// A 0-10 dual bar: A grows left-to-right, B mirrored, so the longer bar reads
// as the stronger score at a glance.
function OrdinalBars({ a, b }: { a: number | null; b: number | null }) {
  const width = (value: number | null) =>
    value == null ? 0 : Math.min(100, (value / 10) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2.5 flex-1 justify-end overflow-hidden rounded-l-sm bg-muted">
        <div
          className={SIDE_META.a.bar}
          style={{ width: `${width(a)}%` }}
        />
      </div>
      <div className="flex h-2.5 flex-1 justify-start overflow-hidden rounded-r-sm bg-muted">
        <div
          className={SIDE_META.b.bar}
          style={{ width: `${width(b)}%` }}
        />
      </div>
    </div>
  )
}

function OrdinalRow({ row }: { row: OrdinalComparisonRow }) {
  return (
    <div className="grid grid-cols-[1fr_minmax(8rem,14rem)_1fr] items-center gap-x-3 py-1.5 text-xs">
      <span className="text-right tabular-nums">
        {row.a == null ? "-" : row.a}
      </span>
      <div className="flex flex-col gap-0.5">
        <OrdinalBars a={row.a} b={row.b} />
        <span className="text-center text-[11px] text-muted-foreground">
          {clean(row.label)}
          {row.direction === "neutral" && (
            <span className="text-muted-foreground/70"> (descriptive)</span>
          )}
        </span>
      </div>
      <span className="tabular-nums">{row.b == null ? "-" : row.b}</span>
    </div>
  )
}

function TokenChips({
  tokens,
  tone,
}: {
  tokens: string[]
  tone: "shared" | "a" | "b"
}) {
  const toneClass =
    tone === "shared"
      ? "border bg-muted text-muted-foreground"
      : tone === "a"
        ? "border-[var(--chart-1)]/40 bg-[var(--chart-1)]/10"
        : "border-[var(--chart-2)]/40 bg-[var(--chart-2)]/10"
  return (
    <>
      {tokens.map((token) => (
        <span
          key={`${tone}:${token}`}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}
        >
          {clean(token)}
        </span>
      ))}
    </>
  )
}

function CategoricalRow({ row }: { row: CategoricalComparisonRow }) {
  return (
    <div className="flex flex-col gap-1 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">{clean(row.label)}</span>
        {row.match && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <MinusIcon className="size-3" />
            same
          </span>
        )}
      </div>
      {!row.match && (
        <div className="flex flex-wrap items-center gap-1">
          {row.onlyA.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <SideDot side="a" />
              <TokenChips tokens={row.onlyA} tone="a" />
            </span>
          )}
          {row.onlyB.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <SideDot side="b" />
              <TokenChips tokens={row.onlyB} tone="b" />
            </span>
          )}
          {row.shared.length > 0 && (
            <TokenChips tokens={row.shared} tone="shared" />
          )}
        </div>
      )}
      {row.match && row.a && (
        <div className="flex flex-wrap gap-1">
          <TokenChips tokens={row.a} tone="shared" />
        </div>
      )}
    </div>
  )
}

function flagText(value: boolean | null): string {
  if (value == null) return "-"
  return value ? "yes" : "no"
}

function FlagRow({ row }: { row: FlagComparisonRow }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 py-1.5 text-xs">
      <span>{clean(row.label)}</span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <SideDot side="a" />
        {flagText(row.a)}
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <SideDot side="b" />
        {flagText(row.b)}
      </span>
    </div>
  )
}

function SpanRow({ row }: { row: SpanComparisonRow }) {
  return (
    <div className="flex flex-col gap-1 py-1.5 text-xs">
      <span className="font-medium">{clean(row.label)}</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["a", "b"] as Side[]).map((side) => {
          const text = side === "a" ? row.a : row.b
          return (
            <div
              key={side}
              className="flex items-start gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5"
            >
              <span className="mt-0.5">
                <SideDot side={side} />
              </span>
              <span className="text-muted-foreground">
                {text.length > 0 ? clean(text) : "not stated"}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SurfaceSection({
  surface,
  ordinals,
  categoricals,
  flags,
  spans,
}: {
  surface: ComparisonSurface
  ordinals: OrdinalComparisonRow[]
  categoricals: CategoricalComparisonRow[]
  flags: FlagComparisonRow[]
  spans: SpanComparisonRow[]
}) {
  const empty =
    ordinals.length === 0 &&
    categoricals.length === 0 &&
    flags.length === 0 &&
    spans.length === 0
  if (empty) return null
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border p-3">
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {SURFACE_LABEL[surface]}
      </h4>
      {ordinals.length > 0 && (
        <div className="flex flex-col divide-y">
          {ordinals.map((row) => (
            <OrdinalRow key={row.key} row={row} />
          ))}
        </div>
      )}
      {categoricals.length > 0 && (
        <div className="flex flex-col divide-y border-t pt-1">
          {categoricals.map((row) => (
            <CategoricalRow key={row.key} row={row} />
          ))}
        </div>
      )}
      {flags.length > 0 && (
        <div className="flex flex-col divide-y border-t pt-1">
          {flags.map((row) => (
            <FlagRow key={row.key} row={row} />
          ))}
        </div>
      )}
      {spans.length > 0 && (
        <div className="flex flex-col divide-y border-t pt-1">
          {spans.map((row) => (
            <SpanRow key={row.key} row={row} />
          ))}
        </div>
      )}
    </section>
  )
}

export function PackagingComparison({
  data,
  report = null,
}: {
  data: PackagingComparison
  report?: PackagingComparisonReport | null
}) {
  const bySurface = (surface: ComparisonSurface) => ({
    ordinals: data.ordinals.filter((row) => row.surface === surface),
    categoricals: data.categoricals.filter((row) => row.surface === surface),
    flags: data.flags.filter((row) => row.surface === surface),
    spans: data.spans.filter((row) => row.surface === surface),
  })

  const hasBody =
    data.ordinals.length > 0 ||
    data.categoricals.length > 0 ||
    data.flags.length > 0 ||
    data.spans.length > 0

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <div className="flex items-center gap-1.5">
          <LayersIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Packaging head-to-head</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Why one of these earned the click and the other did not: a written
          read of both thumbnails, both titles and both openings, followed by
          the field-by-field diff of each video&apos;s stored packaging
          analysis. Observations are correlation, not proof.
        </p>
      </div>

      {report && <ReportNarrative report={report} comparison={data} />}

      {!hasBody ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {data.a.hasTaxonomy || data.b.hasTaxonomy
            ? "Only one of these videos has a packaging read so far. Open the other video's analysis to generate it, then this fills in."
            : "Neither video has a packaging read yet."}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <SideDot side="a" />
              Video A
            </span>
            <ArrowRightIcon className="size-3" />
            <span className="inline-flex items-center gap-1">
              <SideDot side="b" />
              Video B
            </span>
            <span className="ml-auto">Bars and scores run 0 to 10.</span>
          </div>

          <div className="flex flex-col gap-2">
            {SURFACE_ORDER.map((surface) => {
              const rows = bySurface(surface)
              return (
                <SurfaceSection
                  key={surface}
                  surface={surface}
                  ordinals={rows.ordinals}
                  categoricals={rows.categoricals}
                  flags={rows.flags}
                  spans={rows.spans}
                />
              )
            })}
          </div>

          {data.detailCoverage !== "both" && (
            <p className="text-xs text-muted-foreground">
              One of these videos predates the detailed packaging read, so only
              the shared fields are compared. It upgrades automatically the next
              time you open its analysis.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
