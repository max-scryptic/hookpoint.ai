"use client"

import type { ReactNode } from "react"
import { PackageIcon, QuoteIcon } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The Packaging / Script tab shell for Channel Trends. The page is a server
// component and the tab bodies are server-rendered, so they are passed in as
// props and this thin client wrapper only owns the tab state. Icons match the
// section headers on the analysed video page and the Video Comparator
// (Packaging, Script).
//
// A tab whose body is absent is dropped from the bar rather than shown empty,
// so an early library with only packaging data reads as one tab, not two; the
// first surviving tab opens by default.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export function ChannelTrendsTabs({
  packaging,
  script,
}: {
  packaging?: ReactNode
  script?: ReactNode
}) {
  const tabs = [
    { value: "packaging", label: "Packaging", Icon: PackageIcon, body: packaging },
    { value: "script", label: "Script", Icon: QuoteIcon, body: script },
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
