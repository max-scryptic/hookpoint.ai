"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"

import { useOnboardingHint } from "@/components/onboarding-hints"
import { earliestInDocument } from "@/lib/first-tip-order"

// Which tip on a report wears the "click the tip" coach mark, and the way to
// retire it.
//
// The mark belongs on the first tip a creator reads, and no single call site
// knows which tip that is. A report's tips come from a dozen nested components
// (packaging cards, the retention rows and their footage tabs, the pacing
// list), each rendered only where the analysis had something to say, and the
// tabs above them mount and unmount whole lists as they are switched. Working
// out "the first one" from the data would mean rebuilding the report's reading
// order a second time, in a second place, and getting it wrong the moment a
// section is added or reordered.
//
// So the tips answer the question themselves: every clickable tip registers its
// own box here, and the winner is picked off their positions in the page rather
// than off which one happened to mount first (see lib/first-tip-order.ts). That
// survives a tab switch (the list that leaves takes its tips with it and the
// mark moves to a tip still on screen), an added section, and a report whose
// first tip is in whichever section happens to have advice.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

interface FirstTipHintValue {
  // The registered tip that comes first in the document, or null when no tip
  // should be wearing the mark at all.
  anchor: HTMLElement | null
  // Registers one clickable tip's box. Null while the mark is not owed, so a
  // report that has already taught this does no measuring at all. Returns the
  // cleanup React calls when the tip goes.
  register: ((element: HTMLElement) => () => void) | null
  dismiss: () => void
}

// No provider means no coach mark: a tip rendered on a comparison report, in
// the admin evidence view or anywhere else simply renders as itself.
const FirstTipHintContext = createContext<FirstTipHintValue>({
  anchor: null,
  register: null,
  dismiss: () => {},
})

export function FirstTipHintProvider({
  enabled = true,
  children,
}: {
  // Whether this report wants the mark at all. The caller turns it off while a
  // coach mark about something else is already on screen: two bubbles competing
  // for the same first read teaches neither.
  enabled?: boolean
  children: React.ReactNode
}) {
  const hint = useOnboardingHint("report_tip_actions")
  const active = enabled && hint.pending

  // Every tip currently on the page. A Set rather than an array because tips
  // come and go in any order as tabs are switched, and identity is all we need
  // to take one back out.
  const registered = useRef<Set<HTMLElement>>(new Set())
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  // Same element on a re-registration means no state change and no re-render,
  // which is what keeps a tab switch that leaves the first tip in place from
  // flickering the bubble off and back on.
  const recompute = useCallback(() => {
    setAnchor(earliestInDocument(registered.current))
  }, [])

  const register = useCallback(
    (element: HTMLElement) => {
      registered.current.add(element)
      recompute()
      return () => {
        registered.current.delete(element)
        recompute()
      }
    },
    [recompute],
  )

  const value = useMemo(
    () => ({
      anchor: active ? anchor : null,
      register: active ? register : null,
      dismiss: hint.dismiss,
    }),
    [active, anchor, register, hint.dismiss],
  )

  return (
    <FirstTipHintContext.Provider value={value}>
      {children}
    </FirstTipHintContext.Provider>
  )
}

// One tip's side of the arrangement: a ref callback to hang on the tip's own
// box, whether this is the tip wearing the mark, and the way to retire it.
//
// No ref object goes in or comes out. A hook that takes or returns one has its
// whole result read as a ref by the compiler's "no refs during render" rule,
// and every plain `.shown` read off it becomes an error; the caller keeps its
// own ref for the bubble to measure and merges the two callbacks.
export function useFirstTipHint(
  // Whether this tip can carry the mark. Only a clickable tip can: the mark
  // says to click it, and a tip rendered as plain text (someone else's report,
  // or advice that is not a plain string) has nothing to open.
  eligible: boolean,
): {
  ref: (element: HTMLElement | null) => (() => void) | undefined
  shown: boolean
  dismiss: () => void
} {
  const { anchor, register, dismiss } = useContext(FirstTipHintContext)
  // The tip's box, held as state so this tip re-renders once it knows what it
  // is and can tell whether it is the one being pointed at.
  const [element, setElement] = useState<HTMLElement | null>(null)

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node || !eligible || !register) return
      setElement(node)
      const unregister = register(node)
      return () => {
        setElement(null)
        unregister()
      }
    },
    [eligible, register],
  )

  return {
    ref,
    shown: element !== null && element === anchor,
    dismiss,
  }
}
