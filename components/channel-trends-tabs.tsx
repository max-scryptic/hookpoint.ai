"use client"

import type { ReactNode } from "react"
import {
  AreaChartIcon,
  BookOpenIcon,
  PackageIcon,
  QuoteIcon,
} from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The Retention / Packaging / Script / Playbook tab shell for Channel Trends.
// The page is a server component and the tab bodies are server-rendered, so
// they are passed in as props and this thin client wrapper only owns the tab
// state. Icons match the section headers on the analysed video page and the
// Video Comparator (Retention, Packaging, Script) and the playbook header this
// page already used.
//
// A tab whose body is absent is dropped from the bar rather than shown empty,
// so an early library with only retention data reads as one tab, not four; the
// first surviving tab opens by default.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export function ChannelTrendsTabs({
  retention,
  packaging,
  script,
  playbook,
}: {
  retention?: ReactNode
  packaging?: ReactNode
  script?: ReactNode
  playbook?: ReactNode
}) {
  const tabs = [
    { value: "retention", label: "Retention", Icon: AreaChartIcon, body: retention },
    { value: "packaging", label: "Packaging", Icon: PackageIcon, body: packaging },
    { value: "script", label: "Script", Icon: QuoteIcon, body: script },
    { value: "playbook", label: "Playbook", Icon: BookOpenIcon, body: playbook },
  ].filter((tab) => tab.body != null)

  if (tabs.length === 0) return null

  return (
    <Tabs defaultValue={tabs[0].value} className="gap-4">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            <tab.Icon />
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.body}
        </TabsContent>
      ))}
    </Tabs>
  )
}
