import type { ReactNode } from "react"
import { AreaChartIcon } from "lucide-react"

import { ComparisonReportTabs } from "@/components/comparison-report-tabs"
import { TryCallout } from "@/components/try-callout"
import { nameVideoSides, stripEmDashes } from "@/lib/copy-guardrails"
import type {
  RetentionComparisonReport,
  RetentionComparisonReportSection,
} from "@/lib/retention-comparison-report"

// The written retention head-to-head, which is the whole Retention tab: what
// each video held, where the two curves separated, and why the stronger one
// held. Read straight from the report stored on the comparison, with no model
// call at view time. Laid out like the packaging and script head-to-heads, with
// the overlaid curves folded in: a summary card, then the chart, then one tab
// per section of the report, each panel one paragraph and a single "Try:" line.
// The tab strip already names the section, so the panel carries no heading of
// its own. As on the script tab the headings are written by the model rather
// than drawn from a fixed set, so the tabs are labelled with whatever the report
// called its sections and carry no glyph.
//
// The chart arrives as a slot rather than being rendered here, because it is
// derived from the stored analysis on every open while everything around it is
// read back as stored JSON, and because a pair with no written report still
// shows the chart under the note that stands in for one. Purely presentational.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

function clean(text: string): string {
  return stripEmDashes(text)
}

// For the model's own prose about the pair, where a bare "A" or "B" is the video
// rather than a word. Kept apart from clean(), which also runs over the section
// headings, where a lone letter is not a side label.
function cleanProse(text: string): string {
  return nameVideoSides(clean(text))
}

// The overall verdict on the two curves, in the summary box that heads the
// section, matching the box the other two head-to-heads open on.
function ReportSummary({ summary }: { summary: string }) {
  if (!summary) return null
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">Summary</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {cleanProse(summary)}
      </p>
    </div>
  )
}

// One theme of the comparison, in the panel behind its tab: the paragraph
// weighing the two curves against each other, then the one change worth trying
// next.
function ReportSection({
  section,
  tipActions,
}: {
  section: RetentionComparisonReportSection
  tipActions: boolean
}) {
  const tip = section.tip?.trim() ?? ""
  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border bg-card p-4">
      <p className="text-sm leading-relaxed">{cleanProse(section.body)}</p>
      {tip.length > 0 && (
        <TryCallout
          section={`Retention head-to-head: ${clean(section.heading)}`}
          actions={tipActions}
        >
          {tip}
        </TryCallout>
      )}
    </div>
  )
}

export function RetentionHeadToHead({
  report,
  chart,
  // Whether each section's tip offers the keep and flag controls. They belong
  // to the creator reading their own comparison, so the admin view of someone
  // else's pair turns them off.
  tipActions = true,
}: {
  report: RetentionComparisonReport
  // The overlaid curves card, stacked between the summary and the tab strip.
  // Passed in by the page because it is derived from the stored analysis rather
  // than read off the report.
  chart?: ReactNode
  tipActions?: boolean
}) {
  // One tab per section, in the order the report wrote them. The heading is the
  // label, so the value has the index folded in: two sections could be given the
  // same heading, and the tab strip needs each one to be distinct.
  const tabs = report.sections.map((section, index) => ({
    value: `section-${index}`,
    label: clean(section.heading),
    content: <ReportSection section={section} tipActions={tipActions} />,
  }))

  return (
    <section className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-1.5">
          <AreaChartIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Retention head-to-head</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How these two curves differ and why one of them held: a written read of
          both retention curves, the stretches each video lost viewers in, and
          what was being said where the two separated. Observations are
          correlation, not proof.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <ReportSummary summary={report.summary} />
        {chart}
        <ComparisonReportTabs tabs={tabs} />
      </div>
    </section>
  )
}
