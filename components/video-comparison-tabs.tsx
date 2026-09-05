"use client"

import type { ReactNode } from "react"
import { AreaChartIcon, PackageIcon, QuoteIcon } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The Retention / Packaging / Script tab shell for the Video Comparator. The
// page is a server component and the tab bodies are server-rendered, so they
// are passed in as props and this thin client wrapper only owns the tab state.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export function VideoComparisonTabs({
  retention,
  packaging,
  script,
}: {
  retention?: ReactNode
  packaging: ReactNode
  script: ReactNode
}) {
  const tabs = [
    {
      value: "retention",
      label: "Retention",
      Icon: AreaChartIcon,
      body: retention,
    },
    {
      value: "packaging",
      label: "Packaging",
      Icon: PackageIcon,
      body: packaging,
    },
    { value: "script", label: "Script", Icon: QuoteIcon, body: script },
  ].filter((tab) => tab.body != null)

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
