"use client"

import type { ReactNode } from "react"
import { PackageIcon, QuoteIcon } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The Packaging / Script tab shell for the Video Comparator. The page is a
// server component and the tab bodies are server-rendered, so they are passed
// in as props and this thin client wrapper only owns the tab state.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export function VideoComparisonTabs({
  packaging,
  script,
}: {
  packaging: ReactNode
  script: ReactNode
}) {
  return (
    <Tabs defaultValue="packaging" className="gap-4">
      <TabsList>
        <TabsTrigger value="packaging">
          <PackageIcon />
          Packaging
        </TabsTrigger>
        <TabsTrigger value="script">
          <QuoteIcon />
          Script
        </TabsTrigger>
      </TabsList>
      <TabsContent value="packaging">{packaging}</TabsContent>
      <TabsContent value="script">{script}</TabsContent>
    </Tabs>
  )
}
