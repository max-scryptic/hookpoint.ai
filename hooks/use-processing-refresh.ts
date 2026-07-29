import { useEffect } from "react"
import { useRouter } from "next/navigation"

// How often a surface showing live "Processing…" rows re-fetches its server
// data. The deep-analysis pipeline settles on the order of minutes, so a few
// seconds is responsive enough for a row to flip within a beat of finishing
// while keeping the extra server renders modest.
export const PROCESSING_REFRESH_INTERVAL_MS = 8000

// Safety net for a pipeline that never settles. Every stage that fails records
// a real outcome, so a video normally leaves the processing set one way or the
// other — but a run whose invocation died can leave rows pending with nothing
// to pick them up, which would otherwise keep an open tab re-rendering the
// route forever. After this much continuous polling we stop and leave the page
// as-is; a manual reload (or revisiting the page) starts a fresh budget.
export const PROCESSING_REFRESH_MAX_MS = 30 * 60 * 1000

// Keeps a server-rendered surface in step with work finishing in the
// background: while `processing` is true it periodically calls
// `router.refresh()`, so the route's server components re-run and the rows that
// were showing a "Processing…" spinner re-render with their settled state (a
// green tick, an uploaded timestamp, the freshly generated events) without the
// user reloading the page.
//
// `router.refresh()` is used rather than a bespoke status endpoint because the
// processing flag isn't the only thing that changes when a pipeline finishes —
// the surrounding data does too (event counts, costs, whether a deep-analysis
// section should appear at all) — and refreshing re-reads all of it from the one
// server source of truth while preserving client state, so filters, search
// text, and the current page survive the update.
//
// Two details keep the polling honest:
//
//  1. It only runs while `processing` is true. Once nothing is in flight the
//     effect tears down, so a settled page does no background work at all.
//  2. A hidden tab is skipped entirely (nobody is looking at it) and refreshed
//     once as soon as it becomes visible again, so returning to a
//     left-open tab shows current state immediately instead of on the next tick.
export function useProcessingRefresh(
  processing: boolean,
  {
    intervalMs = PROCESSING_REFRESH_INTERVAL_MS,
    maxDurationMs = PROCESSING_REFRESH_MAX_MS,
  }: { intervalMs?: number; maxDurationMs?: number } = {},
) {
  const router = useRouter()

  useEffect(() => {
    if (!processing) return

    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    let lastRefreshedAt = 0

    const budgetSpent = () => Date.now() - startedAt >= maxDurationMs

    const refresh = () => {
      lastRefreshedAt = Date.now()
      router.refresh()
    }

    const schedule = () => {
      timer = setTimeout(() => {
        if (stopped || budgetSpent()) return
        // Skip refreshes for a backgrounded tab, but keep the timer running so
        // it resumes on its own cadence the moment the tab is visible again.
        if (document.visibilityState === "visible") refresh()
        schedule()
      }, intervalMs)
    }

    const handleVisibilityChange = () => {
      if (stopped || budgetSpent()) return
      if (document.visibilityState !== "visible") return
      // Catch up on returning to the tab, but never faster than the normal
      // cadence — flicking between tabs shouldn't re-render the route each time.
      if (Date.now() - lastRefreshedAt >= intervalMs) refresh()
    }

    schedule()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [processing, intervalMs, maxDurationMs, router])
}
