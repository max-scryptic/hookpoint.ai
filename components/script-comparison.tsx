import { QuoteIcon } from "lucide-react"

import { ComparisonReportTabs } from "@/components/comparison-report-tabs"
import { TryCallout } from "@/components/try-callout"
import { nameVideoSides, stripEmDashes } from "@/lib/copy-guardrails"
import type {
  ScriptComparisonReport,
  ScriptComparisonReportSection,
} from "@/lib/script-comparison-report"

// The script head-to-head body: how two uploads differ in what they SAY and how
// they feel, read straight from the written report stored on the comparison
// with no model call at view time. Laid out the same way the packaging
// head-to-head beside it is: a summary card, then one tab per section of the
// report. Each section panel is kept deliberately short, in two beats: one
// paragraph weighing Video A against Video B on that theme, then a single
// "Try:" line. The tab strip already names the section, so the panel carries no
// heading of its own, exactly as the packaging surface panels do. Unlike
// packaging the headings are written by the model rather than drawn from a
// fixed set of surfaces, so the tabs are labelled with whatever the report
// called its sections and carry no glyph.
//
// The deterministic field-by-field diff (lib/script-comparison.ts) used to
// render underneath this: the ranked differences, the topic map strip and the
// per-surface score tables. All of it is gone from the page, because the
// written comparison already carries the argument and the raw numbers behind it
// were never the point of this tab. Purely presentational.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

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
// section, matching the box the packaging head-to-head opens on.
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
// weighing the two scripts against each other, then the one change worth trying
// next. Reports stored before schema version 2 carry no section tip, so those
// sections simply close on the paragraph.
function ReportSection({ section }: { section: ScriptComparisonReportSection }) {
  const tip = section.tip?.trim() ?? ""
  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border bg-card p-4">
      <p className="text-sm leading-relaxed">{cleanProse(section.body)}</p>
      {tip.length > 0 && <TryCallout>{tip}</TryCallout>}
    </div>
  )
}

export function ScriptComparison({
  report,
}: {
  report: ScriptComparisonReport
}) {
  // One tab per section, in the order the report wrote them. The heading is the
  // label, so the value has the index folded in: two sections could be given
  // the same heading, and the tab strip needs each one to be distinct.
  const tabs = report.sections.map((section, index) => ({
    value: `section-${index}`,
    label: clean(section.heading),
    content: <ReportSection section={section} />,
  }))

  // A section rather than a card, so the summary box and the per-theme panels
  // are the cards here, exactly as the packaging tab beside this one is laid
  // out.
  return (
    <section className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-1.5">
          <QuoteIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Script head-to-head</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How these two scripts differ in what they say and how they feel: a
          written read of both full transcripts, with each video&apos;s
          packaging as context. Observations are correlation, not proof.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <ReportSummary summary={report.summary} />
        <ComparisonReportTabs tabs={tabs} />
      </div>
    </section>
  )
}
