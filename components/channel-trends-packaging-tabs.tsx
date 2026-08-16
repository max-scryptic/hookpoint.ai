"use client"

import type { ReactNode } from "react"
import { AlignHorizontalJustifyCenterIcon, ImageIcon, TypeIcon } from "lucide-react"

import { HookIcon } from "@/components/hook-icon"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The Hook / Title / Thumbnail / Alignment strip inside the Packaging tab. The
// page is a server component and these bodies are server-rendered, so they
// arrive as props and this thin client wrapper only owns the tab state, exactly
// as the outer tab bar does (components/channel-trends-tabs.tsx).
//
// The four surfaces, and their glyphs, are the ones a single video's packaging
// report and the packaging head-to-head already use, so a creator meets the
// same four objects wherever the product talks about packaging. Alignment comes
// last because it is about the other three rather than a surface of its own.
//
// A surface whose body is absent is dropped from the bar rather than shown
// empty, so a library that has only been read on its titles reads as one
// sub-tab, not four; the first surviving surface opens by default.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export function PackagingSurfaceTabs({
  hook,
  title,
  thumbnail,
  alignment,
}: {
  hook?: ReactNode
  title?: ReactNode
  thumbnail?: ReactNode
  alignment?: ReactNode
}) {
  const tabs = [
    { value: "hook", label: "Hook", Icon: HookIcon, body: hook },
    { value: "title", label: "Title", Icon: TypeIcon, body: title },
    { value: "thumbnail", label: "Thumbnail", Icon: ImageIcon, body: thumbnail },
    {
      value: "alignment",
      label: "Alignment",
      Icon: AlignHorizontalJustifyCenterIcon,
      body: alignment,
    },
  ].filter((tab) => tab.body != null)

  if (tabs.length === 0) return null

  return (
    <Tabs defaultValue={tabs[0].value} className="gap-4">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
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
