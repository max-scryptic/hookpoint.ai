"use client"

import { useEffect, useState } from "react"

import { delayStyle } from "@/components/landing/landing-motion"
import { cn } from "@/lib/utils"

// The scroll-triggered entrance used across the landing page. Everything this
// wraps starts hidden and plays itself in the first time it reaches the
// viewport, then stays put: the observer disconnects on the first hit, so
// scrolling back up never replays a section.
//
// The motion itself lives in globals.css, keyed off the `data-revealed`
// attribute this sets. That keeps the starting states in one place with the
// media queries that switch them off (no JavaScript, or reduced motion), and it
// lets a card's imagery animate off its wrapper's state without every visual
// needing to be a client component of its own.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

type RevealTag = "div" | "li" | "span" | "figure"

export function Reveal({
  as = "div",
  delay = 0,
  className,
  children,
}: {
  as?: RevealTag
  /** Milliseconds to hold this element back, for staggering a row of cards. */
  delay?: number
  className?: string
  children: React.ReactNode
}) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (node == null || revealed) return

    // With nothing to observe with, show the content rather than leave it
    // hidden. Deferred a frame so the entrance still plays rather than the
    // element simply being there.
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setRevealed(true))
      return () => cancelAnimationFrame(frame)
    }

    // Anything already on screen at mount (the hero) reveals on the observer's
    // first callback, so the top of the page animates in on load.

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      // A little inset at the bottom so a card starts moving once it is
      // properly in view rather than the instant its first pixel appears.
      { threshold: 0, rootMargin: "0px 0px -64px 0px" }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [node, revealed])

  const Tag = as as React.ElementType

  return (
    <Tag
      ref={setNode}
      data-revealed={revealed ? "true" : undefined}
      className={cn("landing-reveal", className)}
      style={delay > 0 ? delayStyle(delay) : undefined}
    >
      {children}
    </Tag>
  )
}

