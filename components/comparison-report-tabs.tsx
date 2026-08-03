"use client"

import type { ReactNode } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The tab strip inside a head-to-head section: the Title / Thumbnail / Hook /
// Alignment surfaces on the packaging tab, and one tab per written section on
// the script tab. The report page is a server component and every panel is
// server-rendered from stored JSON, so the panels arrive as props and this thin
// client wrapper only owns which tab is open. Same shape as
// components/video-comparison-tabs.tsx one level up.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export interface ComparisonReportTab {
  value: string
  label: string
  // The glyph beside the label, matching the Title / Thumbnail / Hook strip on
  // a single video's report. An already-rendered element rather than a
  // component type, because this is a client component and the report page
  // renders on the server. Optional: the script tab's headings are written by
  // the model rather than drawn from a fixed set of surfaces, so there is no
  // glyph to give them.
  icon?: ReactNode
  content: ReactNode
}

export function ComparisonReportTabs({
  tabs,
}: {
  tabs: ComparisonReportTab[]
}) {
  if (tabs.length === 0) return null
  return (
    <Tabs defaultValue={tabs[0].value} className="gap-2">
      {/* The strip stays a single unwrapped row, so a report carrying several
          long model-written headings scrolls sideways rather than pushing the
          page wide. The packaging strip is short enough that this never
          engages there. */}
      <div className="-mx-1 max-w-full overflow-x-auto px-1">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
