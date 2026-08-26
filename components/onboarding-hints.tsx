"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { SparklesIcon, XIcon } from "lucide-react"

import type { OnboardingHint } from "@/lib/onboarding-hints"
import { cn } from "@/lib/utils"

// Where a hint's arrow sits on the bubble, and where along that edge - set by
// whatever the bubble is anchored to, so the arrow lands on the thing being
// pointed at rather than in the middle of it.
export type HintArrow = {
  side: "top" | "bottom"
  align: "start" | "center" | "end"
}

interface OnboardingHintsValue {
  pending: ReadonlySet<string>
  dismiss: (hint: OnboardingHint) => void
}

// Nothing is pending until a provider says otherwise, so a component that asks
// about a hint outside one simply renders without it.
const OnboardingHintsContext = createContext<OnboardingHintsValue>({
  pending: new Set<string>(),
  dismiss: () => {},
})

// Holds the hints this creator has still to meet, and retires one the first
// time they use what it points at.
//
// The pending set is seeded from the server's read and then owned here: a hint
// is struck locally the instant it is used, and the write that makes that
// permanent goes out behind it. `pendingHints` is read once, at mount, so a
// router.refresh() landing between the dismissal and the write does not put the
// hint back on screen.
export function OnboardingHintsProvider({
  pendingHints,
  children,
}: {
  pendingHints: OnboardingHint[]
  children: React.ReactNode
}) {
  const [pending, setPending] = useState<ReadonlySet<string>>(
    () => new Set(pendingHints),
  )
  // The same set, readable synchronously. The gestures that dismiss a hint -
  // clicking a chart highlight, opening a tab - go on happening long after it
  // is gone, and this is what stops each of them posting the hint again before
  // the re-render lands.
  const pendingRef = useRef(pending)

  const dismiss = useCallback((hint: OnboardingHint) => {
    if (!pendingRef.current.has(hint)) return
    const next = new Set(pendingRef.current)
    next.delete(hint)
    pendingRef.current = next
    setPending(next)

    // Best-effort. A hint we fail to record is shown once more on the next
    // visit; a click that waits on the network to be handled is worse.
    void fetch("/api/onboarding-hints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hint }),
    }).catch(() => {})
  }, [])

  const value = useMemo(() => ({ pending, dismiss }), [pending, dismiss])

  return (
    <OnboardingHintsContext.Provider value={value}>
      {children}
    </OnboardingHintsContext.Provider>
  )
}

// Whether one hint is still to be met, and the way to retire it. `dismiss` is
// safe to call unconditionally - from the very handler the hint is teaching, so
// using the feature is what puts the hint away - and does nothing once the hint
// has already gone.
export function useOnboardingHint(hint: OnboardingHint): {
  pending: boolean
  dismiss: () => void
} {
  const { pending, dismiss } = useContext(OnboardingHintsContext)
  const dismissThis = useCallback(() => dismiss(hint), [dismiss, hint])
  return { pending: pending.has(hint), dismiss: dismissThis }
}

// How far in from the bubble's aligned edge HintCallout draws the centre of its
// arrow - the 20px inset of the rotated square plus half its 10px size. An
// anchored bubble is offset by this much so the arrow lands on the middle of
// what it points at.
const ARROW_INSET = 25

// The gap between the thing being pointed at and the bubble pointing at it.
const ANCHOR_GAP = 8

// Hangs a hint bubble off an element anywhere on the page, pointing up at it
// from underneath.
//
// The bubble is drawn in a portal on the body rather than beside its anchor, so
// that nothing between the two can cut it off: a coach mark on a table row has
// both the table's own horizontal scroll container and the rounded card around
// it clipping whatever overflows, and no amount of z-index escapes either.
// Being out of the flow, it also floats over what sits below the anchor instead
// of pushing it down, and leaves nothing to settle back when it goes.
export function AnchoredHintCallout({
  anchorRef,
  children,
}: {
  // The element to point at. Nothing is drawn until it has been measured.
  anchorRef: React.RefObject<HTMLElement | null>
  // The bubble, normally a <HintCallout arrow={{ side: "top", align: "end" }} />.
  children: React.ReactNode
}) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const measure = () => setAnchorRect(anchor.getBoundingClientRect())
    measure()

    // Viewport coordinates go stale the moment anything moves the anchor, so
    // this re-measures on all of it: scrolling (captured, since the scroller
    // may be any container between the anchor and the root), the window
    // resizing, and the anchor's own box or the page's changing size.
    window.addEventListener("scroll", measure, true)
    window.addEventListener("resize", measure)
    const observer = new ResizeObserver(measure)
    observer.observe(anchor)
    observer.observe(document.documentElement)

    return () => {
      window.removeEventListener("scroll", measure, true)
      window.removeEventListener("resize", measure)
      observer.disconnect()
    }
  }, [anchorRef])

  // Nothing to place against on the server or the first client render, where
  // the anchor has yet to be measured.
  if (!anchorRect) return null

  return createPortal(
    <div
      // Pinned by its right edge so that the arrow, drawn a fixed distance in
      // from that edge, stays on the anchor however wide the bubble ends up.
      className="fixed z-50 w-72 max-w-[80vw] text-left whitespace-normal"
      style={{
        top: anchorRect.bottom + ANCHOR_GAP,
        right:
          window.innerWidth -
          (anchorRect.left + anchorRect.width / 2 + ARROW_INSET),
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

// How long one swell of the glow takes, in milliseconds. Kept in step with the
// --hint-target-glow-cycle the animation runs on in app/globals.css.
const GLOW_CYCLE_MS = 2400

// Starts one glow on the same beat as every other glow on the page.
//
// A CSS animation starts when it is applied, so two glows that appear at
// different moments - one on the URL box, there from the first paint, one on a
// table row that renders once its data lands - breathe permanently out of step,
// which reads as two unrelated things blinking rather than as one mark worn by
// several. Starting each animation a negative delay in, by however far the page
// already is through the current cycle, puts them all at the same point of the
// same swell: with the offset measured against the document's time origin - the
// one clock everything on the page shares - each glow's phase works out to the
// current time modulo the cycle, whenever it happens to join.
//
// A ref callback rather than an effect, so the phase is set in the same commit
// that attaches the node (no first frame drawn on the wrong beat), and only
// then - re-applying the delay on a later render would shift a running
// animation rather than align it, since the delay counts from where the
// animation began and not from now.
const startGlowInPhase = (glow: HTMLSpanElement | null) => {
  if (!glow) return
  glow.style.animationDelay = `-${performance.now() % GLOW_CYCLE_MS}ms`
}

// The mark worn by the control a hint bubble points at: a primary-coloured
// outline breathing around it, so the eye is drawn to the thing being explained
// and not only to the bubble explaining it. Faint on purpose - a solid badge
// beside a control reads as an unread count rather than as a pointer at it.
//
// Laid over the control as an absolutely positioned overlay, so nothing about
// the control's own box (its border, its focus ring, its size) has to change to
// wear one. The overlay sits exactly on the control's box, so the ring starts
// at the control's edge rather than floating off it. The caller therefore needs
// a positioned ancestor around the control, usually the wrapper the bubble is
// already hung off, and matches its corners with `className` where the control
// is not the default `rounded-lg`.
export function HintTargetGlow({
  shown = true,
  className,
}: {
  // Whether the hint this belongs to is still pending. Passed rather than
  // implied so the glow appears and goes with the bubble it belongs to, on the
  // one element that bubble points at.
  shown?: boolean
  className?: string
}) {
  if (!shown) return null
  return (
    <span
      ref={startGlowInPhase}
      aria-hidden="true"
      className={cn(
        "hint-target-glow pointer-events-none absolute inset-0 rounded-lg",
        className,
      )}
    />
  )
}

// The coach mark itself: a small primary-coloured bubble with a one-line
// explanation and a way to wave it off without using the feature. Positioning
// belongs to the caller - this only draws the bubble and, where the caller asks
// for one, the arrow pointing back out of it.
export function HintCallout({
  title,
  children,
  onDismiss,
  arrow,
  className,
}: {
  title: string
  children: React.ReactNode
  onDismiss: () => void
  arrow?: HintArrow
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        "relative flex max-w-72 items-start gap-2.5 rounded-xl bg-primary px-3.5 py-2.5 text-primary-foreground shadow-lg ring-1 ring-black/10",
        className,
      )}
    >
      {arrow && (
        // A rotated square tucked half outside the bubble. Its centre is 25px
        // in from whichever edge it is aligned to, which is the offset the
        // anchor uses to line it up with what it points at.
        <span
          aria-hidden="true"
          className={cn(
            "absolute size-2.5 rotate-45 bg-primary",
            arrow.side === "top" ? "-top-[5px]" : "-bottom-[5px]",
            arrow.align === "start"
              ? "left-5"
              : arrow.align === "end"
                ? "right-5"
                : "left-1/2 -translate-x-1/2",
          )}
        />
      )}
      <SparklesIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm leading-snug font-medium">{title}</p>
        <p className="text-xs leading-relaxed text-primary-foreground/85">
          {children}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss hint"
        className="-mt-1 -mr-1.5 shrink-0 rounded-md p-1 text-primary-foreground/70 transition-colors hover:bg-white/15 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
      >
        <XIcon className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
