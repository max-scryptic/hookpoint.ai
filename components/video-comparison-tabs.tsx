"use client"

import type { ReactNode } from "react"

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
  retention: ReactNode
  packaging: ReactNode
  script: ReactNode
}) {
  return (
    <Tabs defaultValue="retention" className="gap-4">
      <TabsList>
        <TabsTrigger value="retention">Retention</TabsTrigger>
        <TabsTrigger value="packaging">Packaging</TabsTrigger>
        <TabsTrigger value="script">Script</TabsTrigger>
      </TabsList>
      <TabsContent value="retention">{retention}</TabsContent>
      <TabsContent value="packaging">{packaging}</TabsContent>
      <TabsContent value="script">{script}</TabsContent>
    </Tabs>
  )
}
