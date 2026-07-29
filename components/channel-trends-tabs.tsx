"use client"

import type { ReactNode } from "react"
import { AreaChartIcon, BookOpenIcon, PackageIcon } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The Retention / Packaging / Playbook tab shell for Channel Trends. The page
// is a server component and the tab bodies are server-rendered, so they are
// passed in as props and this thin client wrapper only owns the tab state.
// Icons match the section headers on the analysed video page (Retention,
// Packaging) and the playbook header this page already used.
//
// A tab whose body is absent is dropped from the bar rather than shown empty,
// so an early library with only retention data reads as one tab, not three;
// the first surviving tab opens by default.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export function ChannelTrendsTabs({
  retention,
  packaging,
  playbook,
}: {
  retention?: ReactNode
  packaging?: ReactNode
  playbook?: ReactNode
}) {
  const tabs = [
    { value: "retention", label: "Retention", Icon: AreaChartIcon, body: retention },
    { value: "packaging", label: "Packaging", Icon: PackageIcon, body: packaging },
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
