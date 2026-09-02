"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"

import {
  AnchoredHintCallout,
  HintCallout,
  HintTargetGlow,
  useOnboardingHint,
} from "@/components/onboarding-hints"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { OnboardingHint } from "@/lib/onboarding-hints"

// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments included).
// Hyphens are fine.

// A coach mark hung off a nav entry, announcing that the page behind it has
// just opened. Written by whoever builds the nav (components/app-sidebar.tsx),
// which is also what decides that the entry has earned one; this only draws it.
export type NavItemHint = {
  // The one-time key it is recorded under, so it is met once per creator and
  // not once per page load.
  hint: OnboardingHint
  title: string
  description: string
}

export type NavItem = {
  title: string
  url: string
  icon?: React.ReactNode
  isActive?: boolean
  // Short pill shown after the title, e.g. "Beta". Hidden while the sidebar is
  // collapsed to icons, where there is no room for it.
  badge?: string
  // The coach mark this entry is carrying, when it has one. At most one entry
  // in the whole sidebar does.
  hint?: NavItemHint
}

export type NavSection = {
  label: string
  items: NavItem[]
}

// The bubble under one nav entry, plus the ring around the entry itself.
//
// Retired the moment the creator opens the page it points at, whether they got
// there by clicking the entry or by any other route: at that point they have
// found the thing it was pointing them at, and a bubble still hanging off the
// entry when they come back is telling them something they have seen. It is
// also retired by the X, for a creator who does not want to go now.
function NavItemHintBubble({
  hint,
  anchorRef,
  isActive,
}: {
  hint: NavItemHint
  // The nav entry to hang the bubble off and draw the ring around.
  anchorRef: React.RefObject<HTMLLIElement | null>
  isActive: boolean
}) {
  const { pending, dismiss } = useOnboardingHint(hint.hint)

  useEffect(() => {
    if (isActive) dismiss()
  }, [isActive, dismiss])

  if (!pending || isActive) return null

  return (
    <>
      {/* The entry is the sidebar's own rounded-md button rather than the
          rounded-lg the ring defaults to. */}
      <HintTargetGlow className="rounded-md" />
      {/* Pinned by its left edge: the sidebar sits against the left of the
          window, and a right-pinned bubble would be drawn mostly off it. */}
      <AnchoredHintCallout anchorRef={anchorRef} align="start">
        <HintCallout
          title={hint.title}
          arrow={{ side: "top", align: "start" }}
          onDismiss={dismiss}
        >
          {hint.description}
        </HintCallout>
      </AnchoredHintCallout>
    </>
  )
}

// One nav entry. Its own component rather than a body inside the map, because
// the entry carrying a coach mark is what that bubble is measured against, and
// a ref per item needs a component per item.
function NavMenuItem({ item }: { item: NavItem }) {
  const itemRef = useRef<HTMLLIElement>(null)

  return (
    <SidebarMenuItem ref={itemRef}>
      <SidebarMenuButton
        tooltip={item.title}
        isActive={item.isActive}
        render={<Link href={item.url} />}
      >
        {item.icon}
        <span className="truncate">{item.title}</span>
        {item.badge && (
          <span className="ml-auto shrink-0 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] leading-none font-semibold tracking-wide text-primary uppercase group-data-[collapsible=icon]:hidden">
            {item.badge}
          </span>
        )}
      </SidebarMenuButton>
      {item.hint && (
        <NavItemHintBubble
          hint={item.hint}
          anchorRef={itemRef}
          isActive={item.isActive ?? false}
        />
      )}
    </SidebarMenuItem>
  )
}

export function NavMain({ sections }: { sections: NavSection[] }) {
  return (
    <>
      {sections.map((section) => (
        <SidebarGroup key={section.label}>
          <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
          <SidebarMenu>
            {section.items.map((item) => (
              <NavMenuItem key={item.title} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  )
}
