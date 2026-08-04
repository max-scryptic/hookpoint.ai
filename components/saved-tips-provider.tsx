"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

// Which tips the creator has already kept, shared with every "Try:" callout on
// the page. A tip can appear on several reports, and the same report renders
// dozens of them, so this is held once for the whole dashboard rather than each
// callout asking the server about itself.
//
// The initial set is read server side by the dashboard layout, so the bookmarks
// are already in the right state on first paint. Saving a tip updates the set
// here as well, which is what keeps the same advice consistent when it appears
// twice on one page.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

interface SavedTipsValue {
  savedFingerprints: Set<string>
  markSaved: (fingerprint: string) => void
  markRemoved: (fingerprint: string) => void
}

const SavedTipsContext = createContext<SavedTipsValue | null>(null)

export function SavedTipsProvider({
  initialFingerprints,
  children,
}: {
  initialFingerprints: string[]
  children: React.ReactNode
}) {
  const [fingerprints, setFingerprints] = useState<Set<string>>(
    () => new Set(initialFingerprints),
  )

  const markSaved = useCallback((fingerprint: string) => {
    setFingerprints((previous) => {
      if (previous.has(fingerprint)) return previous
      const next = new Set(previous)
      next.add(fingerprint)
      return next
    })
  }, [])

  const markRemoved = useCallback((fingerprint: string) => {
    setFingerprints((previous) => {
      if (!previous.has(fingerprint)) return previous
      const next = new Set(previous)
      next.delete(fingerprint)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ savedFingerprints: fingerprints, markSaved, markRemoved }),
    [fingerprints, markSaved, markRemoved],
  )

  return (
    <SavedTipsContext.Provider value={value}>
      {children}
    </SavedTipsContext.Provider>
  )
}

/**
 * The shared saved-tip state, or a standalone one when there is no provider
 * above. A callout rendered outside the dashboard shell still works: it simply
 * starts with nothing saved and remembers what was saved during that visit.
 */
export function useSavedTips(): SavedTipsValue {
  const shared = useContext(SavedTipsContext)
  const [local, setLocal] = useState<Set<string>>(() => new Set())

  const markSavedLocally = useCallback((fingerprint: string) => {
    setLocal((previous) => {
      if (previous.has(fingerprint)) return previous
      const next = new Set(previous)
      next.add(fingerprint)
      return next
    })
  }, [])

  const markRemovedLocally = useCallback((fingerprint: string) => {
    setLocal((previous) => {
      if (!previous.has(fingerprint)) return previous
      const next = new Set(previous)
      next.delete(fingerprint)
      return next
    })
  }, [])

  const fallback = useMemo(
    () => ({
      savedFingerprints: local,
      markSaved: markSavedLocally,
      markRemoved: markRemovedLocally,
    }),
    [local, markSavedLocally, markRemovedLocally],
  )

  return shared ?? fallback
}
