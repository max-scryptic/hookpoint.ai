import type { ReactNode } from "react"
import {
  AlignHorizontalJustifyCenterIcon,
  ImageIcon,
  LayersIcon,
  TrophyIcon,
  TypeIcon,
} from "lucide-react"

import { HookIcon } from "@/components/hook-icon"
import {
  ALIGNMENT_PART_LABEL,
  EvidencePanel,
  PackagingAlignmentScore,
} from "@/components/packaging-alignment-score"
import { VideoThumbnail } from "@/components/video-thumbnail"
import { ComparisonReportTabs } from "@/components/comparison-report-tabs"
import { TryCallout } from "@/components/try-callout"
import {
  limitSentences,
  nameVideoSides,
  plainFigures,
  stripEmDashes,
} from "@/lib/copy-guardrails"
import { cn } from "@/lib/utils"
import {
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
// call at view time. The written report tells the whole story: a summary box,
// then one tab per surface (title, thumbnail, hook, and a fourth Alignment tab
// for how the three fit together). Each panel is a card kept deliberately
// short: the two videos' own material side by side, one paragraph comparing
// them, then a single "Try:" line. The per-side reads, the ranked drivers and
// the field-by-field taxonomy diff are all held back, because the material and
// the comparison paragraph already carry the argument. The comparison is still
// read for the verbatim spans the surface tabs quote, and for the alignment
// scores the fourth tab shows in place of a surface of its own. Those were
// scored for each video on its own in its initial analysis, so that tab is two
// stored reads set side by side and costs nothing to show. Purely
// presentational; all the maths live in lib/packaging-comparison.ts.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

const SIDE_META = {
  a: { dot: "var(--chart-1)", name: "A" },
  b: { dot: "var(--chart-2)", name: "B" },
} as const

// The report's four surfaces, in the order their tabs read: the three things a
// viewer meets (title, thumbnail, hook) and then how tightly those three
// fit together.
const SURFACE_TAB_ORDER: PackagingReportSurface[] = [
  "title",
  "thumbnail",
  "hook",
  "alignment",
]

// The verbatim span each surface tab quotes above the model's read of it. The
// title comes off the video itself, the thumbnail is shown as the image alone
// because its on-screen text is already legible in it, and the alignment tab is
// about the other three rather than about a surface of its own, so none of
// them appear here. The hook entry is only a fallback: that tab quotes the
// whole spoken first ten seconds when the comparison carries it, and drops
// back to the taxonomy's single stored hook line when it does not.
const SURFACE_SPAN_KEY: Partial<Record<PackagingReportSurface, string>> = {
  hook: "hook.firstSentence",
}

// The glyph on each surface tab. The first three match the Title / Thumbnail /
// Hook strip on a single video's report; the fourth is the alignment mark, the
// same one that heads the Title, Thumbnail & Hook tab there.
const SURFACE_TAB_ICON: Record<PackagingReportSurface, ReactNode> = {
  title: <TypeIcon className="text-muted-foreground" />,
  thumbnail: <ImageIcon className="text-muted-foreground" />,
  hook: <HookIcon className="text-muted-foreground" />,
  alignment: (
    <AlignHorizontalJustifyCenterIcon className="text-muted-foreground" />
  ),
}

function clean(text: string): string {
  return stripEmDashes(text)
}

// For the model's own prose about the pair, where a bare "A" or "B" is the
// video rather than a word and a figure is the model's own arithmetic rather
// than a quote. Kept apart from clean(), which also runs over verbatim titles
// and transcript quotes that must not be touched.
function cleanProse(text: string): string {
  return nameVideoSides(plainFigures(clean(text)))
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

// The one-paragraph read of which video packaged itself better, in the box that
// heads the section, where a single video's report heads its own packaging
// section with its alignment score. This one is prose because the whole claim
// here is comparative and no stored number carries it. The badges and
// confidence label it used to carry are restated by the per-surface panels
// below. Capped at two sentences like every other summary card: the surface
// tabs below carry the detail.
function ReportVerdict({
  verdict,
}: {
  verdict: PackagingComparisonReport["verdict"]
}) {
  if (!verdict.summary) return null
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">Summary</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {limitSentences(cleanProse(verdict.summary))}
      </p>
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

// One video's read on a 0-10 axis of the deterministic diff, or null when that
// video never captured the axis. Read off the comparison rather than the report
// so the alignment tab shows the same stored numbers the taxonomy was scored
// on, not a model's impression of them.
function ordinalValue(
  comparison: PackagingComparison,
  key: string,
  side: Side,
): number | null {
  const row = comparison.ordinals.find((candidate) => candidate.key === key)
  if (!row) return null
  return side === "a" ? row.a : row.b
}

// The headline number on the alignment tab: how tightly one video's title,
// thumbnail and hook promise the same thing, scored on that video alone at
// analysis time and scaled to 0-10 by the diff.
const ALIGNMENT_SCORE_KEY = "overall.alignment"

// The two links the headline score is made of, shown under it so the number is
// legible rather than bare. Both come off the enriched taxonomy, so a video
// analysed before that existed simply shows the headline score alone. The
// labels are the shared ones, so the pair of columns here reads word for word
// like the block on a single video's packaging card.
const ALIGNMENT_PART_AXES: Array<{ key: string; label: string }> = [
  {
    key: "cross.titleThumbnailMatch",
    label: ALIGNMENT_PART_LABEL.titleThumbnailMatch,
  },
  {
    key: "cross.hookDeliversPromise",
    label: ALIGNMENT_PART_LABEL.hookDeliversPromise,
  },
]

// The frame every piece of per-side material sits in: the video's own words,
// its real thumbnail, or its alignment numbers, tinted and ruled off so they
// read as that video's own material rather than as more of the report. Every
// surface tab uses it, so the thumbnail pair is framed the same way the title
// and the hook are. Shared with a single video's packaging card, which
// frames its own alignment block identically. The written read below the
// columns is plain foreground text now, matching the detail line on that card,
// so this panel is what sets the material apart without dimming the words
// themselves.
const EvidenceQuote = EvidencePanel

// One video's alignment read, in place of the surface material the other three
// tabs quote: there is no single artefact to show for alignment, so the tab
// shows how well that video's three artefacts agree instead. The score comes
// off that video's own stored taxonomy, so the two columns are two independent
// reads set next to each other rather than anything this comparison had to
// write. It is numbers only: the paragraph weighing the two sides against each
// other sits below the columns like it does on every other tab. It sits in the
// same panel the other tabs quote their extracts in, so the fourth tab reads as
// one more pair of columns rather than as a different kind of thing.
function AlignmentScore({
  side,
  comparison,
}: {
  side: Side
  comparison: PackagingComparison
}) {
  const score = ordinalValue(comparison, ALIGNMENT_SCORE_KEY, side)

  if (score == null) {
    return (
      <p className="text-sm text-muted-foreground">
        No packaging read is stored for this video, so it has no alignment
        score.
      </p>
    )
  }

  const parts = ALIGNMENT_PART_AXES.map((axis) => ({
    label: axis.label,
    value: ordinalValue(comparison, axis.key, side),
  })).filter((part): part is { label: string; value: number } =>
    part.value != null,
  )

  return (
    <PackagingAlignmentScore
      score={score}
      parts={parts}
      color={SIDE_META[side].dot}
    />
  )
}

// The actual thing being argued about, for one video: its real title, its real
// thumbnail, everything it says in its real first ten seconds, or, on the
// alignment tab, how well those three agree. It sits above the model's read of
// that side so the read always has its subject next to it.
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
      <EvidenceQuote>
        <p className="text-base leading-snug font-semibold">
          {video.title ? clean(video.title) : "Untitled video"}
        </p>
      </EvidenceQuote>
    )
  }

  if (surface === "thumbnail") {
    return (
      <EvidenceQuote className="p-2">
        <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-background">
          <VideoThumbnail
            src={video.thumbnailUrl}
            alt=""
            sizes="(min-width: 640px) 50vw, 100vw"
          />
        </div>
      </EvidenceQuote>
    )
  }

  if (surface === "hook") {
    // The hook IS the first ten seconds, so quote all of it. The taxonomy's
    // single stored hook line only stands in for a video whose transcript never
    // reached the comparison, and says so when it does.
    const transcript = (video.hookTranscript ?? "").trim()
    const firstSentence = spanText(comparison, SURFACE_SPAN_KEY.hook ?? "", side)
    const text = transcript.length > 0 ? transcript : firstSentence
    if (text.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          No hook captured for this video.
        </p>
      )
    }
    return (
      <div className="flex flex-col gap-1">
        <EvidenceQuote>
          <p className="text-base leading-relaxed">{`"${clean(text)}"`}</p>
        </EvidenceQuote>
        {transcript.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Hook line only; no transcript is stored for this video&apos;s
            first 10 seconds.
          </p>
        )}
      </div>
    )
  }

  if (surface === "alignment") {
    return <AlignmentScore side={side} comparison={comparison} />
  }

  return null
}

// Both videos side by side for one surface: A on the left, B on the right, each
// column carrying that video's own material and nothing else. The read of each
// side on its own is not shown, because a title or a thumbnail argues for
// itself and a written account of one column only restates what the reader can
// already see; the paragraph below the columns is where the two are actually
// weighed against each other. No cards here; the two sides are separated by a
// single dotted rule down the middle, which stops where the columns do, so that
// paragraph sits below both of them unenclosed. The columns carry no container
// of their own; only the material inside each one is boxed, so a video's own
// words stay distinct from the report's prose about them. The alignment tab has
// no surface of its own to show, so each column carries that video's alignment
// score instead, in the same box the extracts use.
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
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2">
      {sides.map((side, index) => {
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
            {/* The header row is height-locked so the two columns' evidence
                starts on the same line whatever badges a side happens to
                carry: the badges sit inside that fixed height rather than
                growing the row, so a side with both of them reads level with a
                side with none. */}
            <div className="flex h-6 items-center gap-2">
              <SideDot side={side} />
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Video {SIDE_META[side].name}
              </span>
              {isTop && (
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-emerald-500/10 px-2 text-xs leading-none font-medium text-emerald-600 dark:text-emerald-500">
                  <TrophyIcon className="size-3.5" />
                  most views
                </span>
              )}
              {isStronger && (
                <span className="ml-auto inline-flex h-5 shrink-0 items-center rounded-sm border bg-muted px-2 text-xs leading-none text-muted-foreground">
                  stronger here
                </span>
              )}
            </div>
            <SurfaceEvidence
              surface={surface}
              side={side}
              comparison={comparison}
            />

          </div>
        )
      })}
    </div>
  )
}

interface SurfaceTab {
  surface: PackagingReportSurface
  read: PackagingReportSurfaceRead | null
  drivers: PackagingReportDriver[]
  recommendations: PackagingReportRecommendation[]
}

// Everything a surface tab shows, in one card and in three beats: the two
// videos' own material side by side, one paragraph weighing them against each
// other, then the one change worth trying. The tab strip above already names
// the surface, so the card carries no heading of its own.
function SurfacePanel({
  tab,
  comparison,
  tipActions,
}: {
  tab: SurfaceTab
  comparison: PackagingComparison
  tipActions: boolean
}) {
  // Every tab closes on one thing to try, the same as every other tip in the
  // app: the surface's own tip where there is one; reports stored before schema
  // version 5 carry no surface tip, so the first tip the drivers left behind
  // stands in, and before version 2 there were no driver tips either, so the
  // first recommendation an older report happens to carry leads for those. Any
  // recommendations after that one are not shown. A surface with none of the
  // three is the one case that still closes without advice.
  const surfaceTip = tab.read?.tip?.trim() ?? ""
  const driverTip =
    tab.drivers.find((driver) => driver.tip)?.tip?.trim() ?? ""
  const tip =
    surfaceTip || driverTip || tab.recommendations[0]?.action.trim() || null
  // The examples belong to the surface's own tip, which is the only advice here
  // a model was asked to demonstrate. Where an older report falls back to a
  // driver tip or a stored recommendation, the card asks for examples instead.
  const examples = surfaceTip ? tab.read?.tipExamples : undefined
  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border bg-card p-4">
      <SurfaceColumns
        surface={tab.surface}
        comparison={comparison}
        read={tab.read}
      />
      {tab.read?.whyItMatters && (
        <p className="text-sm leading-relaxed">
          {cleanProse(tab.read.whyItMatters)}
        </p>
      )}
      {tip != null && (
        <TryCallout
          section={`Packaging head-to-head: ${
            PACKAGING_REPORT_SURFACE_TAB_LABEL[tab.surface]
          }`}
          examples={examples}
          actions={tipActions}
        >
          {tip}
        </TryCallout>
      )}
    </div>
  )
}

function ReportNarrative({
  report,
  comparison,
  tipActions,
}: {
  report: PackagingComparisonReport
  comparison: PackagingComparison
  tipActions: boolean
}) {
  // One tab per surface, in reading order, skipping any the report had nothing
  // to say about.
  const tabs: SurfaceTab[] = SURFACE_TAB_ORDER.map((surface) => ({
    surface,
    read: report.surfaces.find((read) => read.surface === surface) ?? null,
    drivers: report.drivers.filter((driver) => driver.surface === surface),
    // Only a report stored while the model still wrote a second piece of advice
    // per surface carries any of these.
    recommendations: (report.recommendations ?? []).filter(
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
        <ComparisonReportTabs
          tabs={tabs.map((tab) => ({
            value: tab.surface,
            label: PACKAGING_REPORT_SURFACE_TAB_LABEL[tab.surface],
            icon: SURFACE_TAB_ICON[tab.surface],
            content: (
              <SurfacePanel
                tab={tab}
                comparison={comparison}
                tipActions={tipActions}
              />
            ),
          }))}
        />
      )}
    </div>
  )
}

export function PackagingComparison({
  data,
  report = null,
  // Whether each surface's tip offers the keep and flag controls. They belong
  // to the creator reading their own comparison, so the admin view of someone
  // else's pair turns them off.
  tipActions = true,
}: {
  data: PackagingComparison
  report?: PackagingComparisonReport | null
  tipActions?: boolean
}) {
  // A section rather than a card, so the summary box and the per-surface panels
  // are the cards here, the same way the Packaging section of a single video's
  // report is laid out. Nothing here is nested in a card of its own.
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <LayersIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Packaging head-to-head</h2>
      </div>

      {report ? (
        <ReportNarrative
          report={report}
          comparison={data}
          tipActions={tipActions}
        />
      ) : (
        <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          {data.a.hasTaxonomy && data.b.hasTaxonomy
            ? "Both videos have a packaging read, but the written head-to-head has not been generated for this pair yet."
            : data.a.hasTaxonomy || data.b.hasTaxonomy
              ? "Only one of these videos has a packaging read so far. Open the other video's analysis to generate it, then this fills in."
              : "Neither video has a packaging read yet."}
        </p>
      )}
    </section>
  )
}
