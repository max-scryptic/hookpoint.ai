"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

// The two things on the landing page that answer the pointer directly: a card
// that tilts towards it, and a button that leans out to meet it. Both are
// wrappers that carry a transform of their own, so the element inside keeps
// whatever hover motion it already had and the two never fight over one
// declaration.
//
// Both are off unless the reader is on a fine pointer and has not asked for
// less motion. On a touch screen there is no pointer to answer, and tilting a
// card under a finger only gets in the way of tapping it.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

/** Whether pointer-driven motion is wanted here at all. */
function usePointerMotion() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return

    const fine = window.matchMedia("(pointer: fine)")
    const still = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setEnabled(fine.matches && !still.matches)

    update()
    fine.addEventListener("change", update)
    still.addEventListener("change", update)
    return () => {
      fine.removeEventListener("change", update)
      still.removeEventListener("change", update)
    }
  }, [])

  return enabled
}

/**
 * Where the pointer is inside a box, as a pair running from -0.5 to 0.5 about
 * its centre. The box passed in is the one measured on the way in rather than a
 * fresh reading: measuring on every move would put a pointer sweeping across a
 * grid of cards back on the layout path, and on an element that has already
 * been pulled off its resting place it would feed its own movement back in.
 */
function pointerPosition(
  event: { clientX: number; clientY: number },
  rect: DOMRect | null
) {
  if (rect == null || rect.width === 0 || rect.height === 0) return null
  return {
    x: (event.clientX - rect.left) / rect.width - 0.5,
    y: (event.clientY - rect.top) / rect.height - 0.5,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * A card that leans towards the pointer. The tilt is small on purpose: enough
 * that the card reads as a physical surface catching the light, not so much
 * that the text on it starts to distort.
 */
export function TiltCard({
  className,
  degrees = 6,
  children,
}: {
  className?: string
  /** How far the card leans at the very corner, in degrees. */
  degrees?: number
  children: React.ReactNode
}) {
  const enabled = usePointerMotion()
  const node = useRef<HTMLDivElement | null>(null)
  const box = useRef<DOMRect | null>(null)

  const onPointerEnter = () => {
    box.current = node.current?.getBoundingClientRect() ?? null
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (node.current == null) return
    const position = pointerPosition(event, box.current)
    if (position == null) return
    node.current.style.transform = `perspective(900px) rotateX(${(
      -position.y * degrees
    ).toFixed(2)}deg) rotateY(${(position.x * degrees).toFixed(2)}deg)`
  }

  const onPointerLeave = () => {
    if (node.current == null) return
    node.current.style.transform = ""
  }

  return (
    <div
      ref={node}
      onPointerEnter={enabled ? onPointerEnter : undefined}
      onPointerMove={enabled ? onPointerMove : undefined}
      onPointerLeave={enabled ? onPointerLeave : undefined}
      className={cn(
        "transition-transform duration-500 ease-out will-change-transform",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * A button that drifts towards the pointer as it approaches, and springs back
 * when it leaves. The pull is capped so the button never leaves the space the
 * layout gave it.
 */
export function Magnetic({
  className,
  pull = 0.28,
  children,
}: {
  className?: string
  /** Share of the distance from the centre the button travels. */
  pull?: number
  children: React.ReactNode
}) {
  const enabled = usePointerMotion()
  const node = useRef<HTMLSpanElement | null>(null)
  const box = useRef<DOMRect | null>(null)

  const onPointerEnter = () => {
    box.current = node.current?.getBoundingClientRect() ?? null
  }

  const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (node.current == null) return
    const position = pointerPosition(event, box.current)
    if (position == null) return
    node.current.style.transform = `translate3d(${(
      position.x * position.width * pull
    ).toFixed(1)}px, ${(position.y * position.height * pull).toFixed(1)}px, 0)`
  }

  const onPointerLeave = () => {
    if (node.current == null) return
    node.current.style.transform = ""
  }

  return (
    <span
      ref={node}
      onPointerEnter={enabled ? onPointerEnter : undefined}
      onPointerMove={enabled ? onPointerMove : undefined}
      onPointerLeave={enabled ? onPointerLeave : undefined}
      className={cn(
        "inline-flex transition-transform duration-500 ease-out",
        className
      )}
    >
      {children}
    </span>
  )
}
