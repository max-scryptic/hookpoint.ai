"use client"

import type { ReactNode } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The Title / Thumbnail / Hook / Summary tab strip inside the packaging
// head-to-head. The report page is a server component and every panel is
// server-rendered from stored JSON, so the panels arrive as props and this thin
// client wrapper only owns which tab is open. Same shape as
// components/video-comparison-tabs.tsx one level up.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export interface PackagingReportTab {
  value: string
  label: string
  content: ReactNode
}

export function PackagingReportTabs({ tabs }: { tabs: PackagingReportTab[] }) {
  if (tabs.length === 0) return null
  return (
    <Tabs defaultValue={tabs[0].value} className="gap-2">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
