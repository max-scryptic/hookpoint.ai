"use client"

import { useCallback, useEffect, useState } from "react"

import { cn } from "@/lib/utils"

// The jump bar that sits above the help guide. The guide is one long document,
// so without this a reader who only wants to know how credits work has to
// scroll past everything else to find it. Each button glides to its section,
// and the bar marks whichever section is currently being read so the reader
// always knows where they are in the run of steps.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

export type HelpSection = {
  id: string
  label: string
}

// How far below the top of the viewport a section heading lands when jumped
// to. The bar is sticky and roughly 3rem tall, so this clears it and leaves a
// little air above the heading. Sections carry a matching scroll margin so a
// plain #hash link lands in the same place.
const SCROLL_OFFSET_PX = 76

export function HelpNav({ sections }: { sections: readonly HelpSection[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "")

  useEffect(() => {
    // The section being read is the last one whose heading has crossed the
    // offset line. Measuring on scroll rather than with an observer keeps this
    // correct for the short sections near the bottom of the page, which never
    // fill enough of the viewport to win an intersection test.
    let frame = 0

    const sync = () => {
      frame = 0

      // The final section can be too short to ever reach the offset line, so
      // hitting the bottom of the page always counts as reading it.
      const atPageBottom =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - 2
      if (atPageBottom) {
        setActiveId(sections[sections.length - 1]?.id ?? "")
        return
      }

      let current = sections[0]?.id ?? ""
      for (const section of sections) {
        const element = document.getElementById(section.id)
        if (!element) continue
        if (element.getBoundingClientRect().top <= SCROLL_OFFSET_PX + 8) {
          current = section.id
        }
      }
      setActiveId(current)
    }

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(sync)
    }

    sync()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [sections])

  const jumpTo = useCallback((id: string) => {
    const element = document.getElementById(id)
    if (!element) return

    const top = Math.max(
      0,
      element.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET_PX,
    )
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches

    window.scrollTo({ top, behavior: prefersReducedMotion ? "auto" : "smooth" })
  }, [])

  return (
    <nav
      aria-label="Help sections"
      className="sticky top-0 z-20 -mx-4 border-b bg-background/85 px-4 py-2 backdrop-blur"
    >
      <ul className="flex items-center gap-1 overflow-x-auto">
        {sections.map((section, index) => {
          const isActive = section.id === activeId
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => jumpTo(section.id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                    isActive ? "bg-primary-foreground/20" : "bg-foreground/10",
                  )}
                >
                  {index + 1}
                </span>
                {section.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
