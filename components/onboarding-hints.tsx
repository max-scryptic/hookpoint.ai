"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"
import { SparklesIcon, XIcon } from "lucide-react"

import type { OnboardingHint } from "@/lib/onboarding-hints"
import { cn } from "@/lib/utils"

// Where a hint's arrow sits on the bubble, and where along that edge — set by
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
  // The same set, readable synchronously. The gestures that dismiss a hint —
  // clicking a chart highlight, opening a tab — go on happening long after it
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
// safe to call unconditionally — from the very handler the hint is teaching, so
// using the feature is what puts the hint away — and does nothing once the hint
// has already gone.
export function useOnboardingHint(hint: OnboardingHint): {
  pending: boolean
  dismiss: () => void
} {
  const { pending, dismiss } = useContext(OnboardingHintsContext)
  const dismissThis = useCallback(() => dismiss(hint), [dismiss, hint])
  return { pending: pending.has(hint), dismiss: dismissThis }
}

// The coach mark itself: a small primary-coloured bubble with a one-line
// explanation and a way to wave it off without using the feature. Positioning
// belongs to the caller — this only draws the bubble and, where the caller asks
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
