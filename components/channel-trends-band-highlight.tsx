"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

// The one piece of state every chart on the Channel Trends page shares: which
// of the three bands the reader is currently pointing at.
//
// Each chart draws the same three sets of videos over one another, so some of
// what a reader wants is always sitting behind something else: a shape under two
// other shapes on a radar, a mark under the run between the other two on a
// dumbbell. Pointing at a band in the key pulls that band forward across every
// chart under that key and fades the ones it was competing with. Hover, keyboard
// focus and a tap all do it; a click or tap pins the choice so it survives the
// pointer leaving, which is the only way to hold it on a touch screen.
//
// The state, the group that carries it and the key entry that drives it live
// here rather than in either chart file, so the radars and the paired bars
// answer a key in exactly the same way rather than in two hand-written
// imitations of each other.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

// The three sets of videos every chart on the page draws: the best few uploads,
// the worst few, and the whole library they came from.
export type TrendBand = "top" | "bottom" | "library"

interface BandHighlight {
  // The band currently pulled to the front, from either a pointer or a pin.
  highlighted: TrendBand | null
  // The band held by a click or tap, which is the only kind that outlives the
  // pointer leaving the key.
  pinned: TrendBand | null
  setHovered: (band: TrendBand | null) => void
  togglePinned: (band: TrendBand) => void
}

// Outside a group there is nothing to highlight and nothing to tell, so a chart
// draws flat and a key is inert. That keeps every chart usable on its own rather
// than only under a key.
const INERT_HIGHLIGHT: BandHighlight = {
  highlighted: null,
  pinned: null,
  setHovered: () => {},
  togglePinned: () => {},
}

const BandHighlightContext = createContext<BandHighlight>(INERT_HIGHLIGHT)

export function useBandHighlight(): BandHighlight {
  return useContext(BandHighlightContext)
}

// Wraps one key and the charts it speaks for, so pointing at a band in the key
// reaches every chart underneath it. It draws no element of its own: the key and
// the charts sit in a column their parent lays out, and a wrapper here would
// take them out of it.
export function BandHighlightGroup({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<TrendBand | null>(null)
  const [pinned, setPinned] = useState<TrendBand | null>(null)
  const togglePinned = useCallback((band: TrendBand) => {
    setPinned((current) => (current === band ? null : band))
  }, [])
  const value = useMemo<BandHighlight>(
    // A pointer beats a pin while it is on the key, so hovering the other two
    // entries still previews them without having to unpin first.
    () => ({ highlighted: hovered ?? pinned, pinned, setHovered, togglePinned }),
    [hovered, pinned, togglePinned],
  )
  return (
    <BandHighlightContext.Provider value={value}>
      {children}
    </BandHighlightContext.Provider>
  )
}

// Presentation attributes and colours alike are ordinary CSS properties, so
// everything a highlight touches eases between the two states instead of
// snapping. Honours a reduced-motion setting.
export const BAND_TRANSITION =
  "transition-all duration-200 ease-out motion-reduce:transition-none"

// A band's entry in a key, and the handle for picking that band out of the
// charts below it. A button rather than a span, so the same thing a mouse does
// is reachable from the keyboard and from a touch screen: focus previews a band
// the way hovering does, and a click or tap pins it until it is picked again.
// The swatch is the caller's, because a key draws the exact mark its own chart
// draws; everything else about the entry is the same wherever it appears.
export function BandKeyItem({
  band,
  label,
  children,
}: {
  band: TrendBand
  label: string
  // The mark this band draws with, at the size a line of text can carry.
  children: ReactNode
}) {
  const { highlighted, pinned, setHovered, togglePinned } = useBandHighlight()
  const faded = highlighted != null && highlighted !== band
  return (
    <button
      type="button"
      onPointerEnter={() => setHovered(band)}
      onPointerLeave={() => setHovered(null)}
      onFocus={() => setHovered(band)}
      onBlur={() => setHovered(null)}
      onClick={() => togglePinned(band)}
      aria-pressed={pinned === band}
      className={`-mx-1 flex items-center gap-1.5 rounded-sm px-1 text-left transition-colors duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none ${
        highlighted === band
          ? "text-foreground"
          : faded
            ? "text-muted-foreground/45"
            : "hover:text-foreground"
      }`}
    >
      {children}
      {label}
    </button>
  )
}
