"use client"

import type { ReactNode } from "react"
import {
  BrainIcon,
  HeartIcon,
  ListTreeIcon,
  MegaphoneIcon,
} from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The Substance / Structure / Emotion / Rhetoric strip inside the Script tab,
// built exactly as the Packaging tab's surface strip is
// (components/channel-trends-packaging-tabs.tsx): the page is a server
// component and these bodies are server-rendered, so they arrive as props and
// this thin client wrapper only owns the tab state.
//
// The four surfaces are the script taxonomy's own axis groups, in the order the
// taxonomy defines them, so a creator meets the same four objects here that a
// single video's script read is written in.
//
// A surface whose body is absent is dropped from the bar rather than shown
// empty, so a library read on only some of its axes reads as the sub-tabs it
// actually has; the first surviving surface opens by default.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export function ScriptSurfaceTabs({
  substance,
  structure,
  emotion,
  rhetoric,
}: {
  substance?: ReactNode
  structure?: ReactNode
  emotion?: ReactNode
  rhetoric?: ReactNode
}) {
  const tabs = [
    { value: "substance", label: "Substance", Icon: BrainIcon, body: substance },
    {
      value: "structure",
      label: "Structure",
      Icon: ListTreeIcon,
      body: structure,
    },
    { value: "emotion", label: "Emotion", Icon: HeartIcon, body: emotion },
    {
      value: "rhetoric",
      label: "Rhetoric",
      Icon: MegaphoneIcon,
      body: rhetoric,
    },
  ].filter((tab) => tab.body != null)

  if (tabs.length === 0) return null

  return (
    <Tabs defaultValue={tabs[0].value} className="gap-4">
      <TabsList className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] sm:inline-flex sm:w-fit">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="min-h-9 px-2.5 sm:px-3"
          >
            <tab.Icon className="size-4" />
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
