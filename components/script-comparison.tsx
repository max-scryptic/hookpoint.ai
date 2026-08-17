import { QuoteIcon, TrophyIcon } from "lucide-react"

import { ComparisonReportTabs } from "@/components/comparison-report-tabs"
import { TryCallout } from "@/components/try-callout"
import {
  limitSentences,
  nameVideoSides,
  stripEmDashes,
} from "@/lib/copy-guardrails"
import { cn } from "@/lib/utils"
import type {
  ScriptComparisonReport,
  ScriptComparisonReportSection,
  ScriptReportSide,
} from "@/lib/script-comparison-report"

// The script head-to-head body: how two uploads differ in what they SAY and how
// they feel, read straight from the written report stored on the comparison
// with no model call at view time. Laid out the same way the packaging
// head-to-head beside it is, down to the columns: a summary card, then one tab
// per section of the report, and inside each tab the two videos' own material
// side by side, one paragraph drawing the conclusion, then a single "Try:"
// line. The tab strip already names the section, so the panel carries no
// heading of its own, exactly as the packaging surface panels do. Unlike
// packaging the headings are written by the model rather than drawn from a
// fixed set of surfaces, so the tabs are labelled with whatever the report
// called its sections and carry no glyph.
//
// What sits in the columns is the one real difference from packaging. There the
// column holds the artefact itself, because a title or a thumbnail argues for
// itself; a script does not, since the transcript it is read from runs for
// minutes and cannot be quoted whole, so the column holds the model's short
// points about what that script does on the theme instead. Everything around
// them (the header row, the badges, the dotted rule down the middle, the tinted
// panel) is the packaging layout unchanged, so the two tabs read as one report.
//
// A report stored before schema version 5 carries no columns at all, only the
// paragraph. Those render as that paragraph alone, in the same place the
// conclusion sits now, so an older pair still reads rather than showing a pair
// of empty columns.
//
// The deterministic field-by-field diff (lib/script-comparison.ts) used to
// render underneath this: the ranked differences, the topic map strip and the
// per-surface score tables. All of it is gone from the page, because the
// written comparison already carries the argument and the raw numbers behind it
// were never the point of this tab. Purely presentational.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

// The two sides' colours and names, matching the packaging head-to-head so the
// same video is the same colour on both tabs.
const SIDE_META = {
  a: { dot: "var(--chart-1)", name: "A" },
  b: { dot: "var(--chart-2)", name: "B" },
} as const

function clean(text: string): string {
  return stripEmDashes(text)
}

// For the model's own prose about the pair, where a bare "A" or "B" is the
// video rather than a word. Kept apart from clean(), which also runs over the
// section headings, where a lone letter is not a side label.
function cleanProse(text: string): string {
  return nameVideoSides(clean(text))
}

// The overall verdict on the two scripts, in the summary box that heads the
// section, matching the box the packaging head-to-head opens on. Capped at two
// sentences like every other summary card: the tabs below carry the detail.
function ReportSummary({ summary }: { summary: string }) {
  if (!summary) return null
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">Summary</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {limitSentences(cleanProse(summary))}
      </p>
    </div>
  )
}

function SideDot({ side }: { side: ScriptReportSide }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: SIDE_META[side].dot }}
    />
  )
}

// The frame one video's points sit in, the same tinted and ruled panel the
// packaging columns quote their material in, so a video's own material stays
// distinct from the report's prose about the pair below it.
function SidePoints({ points }: { points: string[] }) {
  return (
    <div className="rounded-md border-l-2 border-muted-foreground/30 bg-muted/40 py-2 pr-3 pl-3">
      <ul className="flex flex-col gap-1.5">
        {points.map((point, index) => (
          <li
            key={`${index}-${point}`}
            className="flex gap-2 text-sm leading-relaxed"
          >
            <span
              aria-hidden
              className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60"
            />
            <span>{cleanProse(point)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Both videos side by side for one theme: A on the left, B on the right, each
// column carrying what that video's script does and nothing else. No cards
// here; the two sides are separated by a single dotted rule down the middle,
// which stops where the columns do, so the conclusion below sits under both of
// them unenclosed. Identical to the packaging head-to-head's surface columns,
// because it is the same reader reading the same report.
function SectionColumns({
  section,
  higherViewsSide,
}: {
  section: ScriptComparisonReportSection
  higherViewsSide: ScriptReportSide | null
}) {
  const sides: ScriptReportSide[] = ["a", "b"]
  const pointsFor = (side: ScriptReportSide) =>
    (side === "a" ? section.videoA : section.videoB) ?? []

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2">
      {sides.map((side, index) => {
        const points = pointsFor(side)
        const isTop = higherViewsSide === side
        const isStronger = section.strongerSide === side
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
            {/* The header row is height-locked so the two columns' points start
                on the same line whatever badges a side happens to carry: the
                badges sit inside that fixed height rather than growing the row,
                so a side with both of them reads level with a side with
                none. */}
            <div className="flex h-6 items-center gap-2">
              <SideDot side={side} />
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Video {SIDE_META[side].name}
              </span>
              {isTop && (
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 text-xs leading-none font-medium text-emerald-600 dark:text-emerald-500">
                  <TrophyIcon className="size-3.5" />
                  most views
                </span>
              )}
              {isStronger && (
                <span className="ml-auto inline-flex h-5 shrink-0 items-center rounded-full border bg-muted px-2 text-xs leading-none text-muted-foreground">
                  stronger here
                </span>
              )}
            </div>
            {points.length > 0 ? (
              <SidePoints points={points} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No read of this video&apos;s script is stored for this theme.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// One theme of the comparison, in the panel behind its tab and in three beats:
// what each script does, side by side; the conclusion the pair points to; then
// the one change worth trying next. Reports stored before schema version 5
// carry no columns, so those open straight on the conclusion, and reports
// stored before version 2 carry no section tip, so those simply close on it.
function ReportSection({
  section,
  higherViewsSide,
  tipActions,
}: {
  section: ScriptComparisonReportSection
  higherViewsSide: ScriptReportSide | null
  tipActions: boolean
}) {
  const tip = section.tip?.trim() ?? ""
  const hasColumns =
    (section.videoA?.length ?? 0) > 0 || (section.videoB?.length ?? 0) > 0
  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border bg-card p-4">
      {hasColumns && (
        <SectionColumns section={section} higherViewsSide={higherViewsSide} />
      )}
      <p className="text-sm leading-relaxed">{cleanProse(section.body)}</p>
      {tip.length > 0 && (
        <TryCallout
          section={`Script head-to-head: ${clean(section.heading)}`}
          actions={tipActions}
        >
          {tip}
        </TryCallout>
      )}
    </div>
  )
}

export function ScriptComparison({
  report,
  // Which of the two videos has more views, for the badge the packaging
  // head-to-head carries on the same column header. Passed in by the page
  // because it is arithmetic over both videos' stored stats rather than
  // anything the written report knows; null when the two are unknown or tied,
  // and null is also what a pair with no packaging diff falls back to, which
  // simply leaves the badge off.
  higherViewsSide = null,
  // Whether each section's tip offers the keep and flag controls. They belong
  // to the creator reading their own comparison, so the admin view of someone
  // else's pair turns them off.
  tipActions = true,
}: {
  report: ScriptComparisonReport
  higherViewsSide?: ScriptReportSide | null
  tipActions?: boolean
}) {
  // One tab per section, in the order the report wrote them. The heading is the
  // label, so the value has the index folded in: two sections could be given
  // the same heading, and the tab strip needs each one to be distinct.
  const tabs = report.sections.map((section, index) => ({
    value: `section-${index}`,
    label: clean(section.heading),
    content: (
      <ReportSection
        section={section}
        higherViewsSide={higherViewsSide}
        tipActions={tipActions}
      />
    ),
  }))

  // A section rather than a card, so the summary box and the per-theme panels
  // are the cards here, exactly as the packaging tab beside this one is laid
  // out.
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <QuoteIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Script head-to-head</h2>
      </div>

      <div className="flex flex-col gap-4">
        <ReportSummary summary={report.summary} />
        <ComparisonReportTabs tabs={tabs} />
      </div>
    </section>
  )
}
