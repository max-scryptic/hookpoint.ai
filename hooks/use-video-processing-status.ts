import { useEffect, useState } from "react"

import type { VideoProcessingStatus } from "@/lib/retention-window-media-progress"

// How often the analysed-videos table asks whether anything has finished. The
// deep-analysis pipeline settles on the order of minutes, so a few seconds keeps
// a row's spinner honest without the poll itself being noticeable.
const POLL_INTERVAL_MS = 6000

// Safety net for a pipeline that never settles (e.g. a run whose invocation died
// leaving rows pending with nothing to pick them up), so a tab left open on such
// a video doesn't poll for the rest of the day. Any fresh server render - a
// reload, or navigating back to the page - starts a new budget.
const MAX_POLL_MS = 30 * 60 * 1000

function statusSignature(status: VideoProcessingStatus): string {
  return `${status.rawFileVideoIds.join(",")}|${status.processingVideoIds.join(",")}`
}

// Keeps the analysed-videos table's raw-file indicators live while videos finish
// being deep-analysed in the background.
//
// `initial` is the server-rendered snapshot. When it says nothing is processing
// there's nothing to watch, so this returns it untouched and issues no requests
// at all. When something *is* processing it polls /api/videos/processing-status
// and returns the latest answer instead, so the affected rows swap their
// "Processing…" badge for the uploaded tick on their own. Polling stops as soon
// as a response comes back with nothing left in flight.
//
// Only the two id sets are re-read (never the whole route): everything else in a
// row - title, views, when it was analysed - is fixed at analyse time, and
// re-rendering the page to learn that one flag flipped would re-read every
// analysed video's retention curve and transcript on every tick.
export function useVideoProcessingStatus(
  initial: VideoProcessingStatus,
): VideoProcessingStatus {
  // Server truth is identified by content rather than array identity: the props
  // are rebuilt on every render, so keying the poll on identity would restart it
  // constantly, while the ids themselves only change when the page re-renders
  // with genuinely new data.
  const signature = statusSignature(initial)
  const anyProcessing = initial.processingVideoIds.length > 0
  const [live, setLive] = useState<{
    signature: string
    status: VideoProcessingStatus
  } | null>(null)

  useEffect(() => {
    if (!anyProcessing) return

    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null
    // Set once this snapshot has nothing left to watch (unmounted, everything
    // settled, or the polling budget spent) so no path restarts the loop.
    let stopped = false
    let inFlight = false
    let lastPolledAt = 0

    const schedule = () => {
      if (stopped) return
      timer = setTimeout(() => {
        // A backgrounded tab has nobody watching it, so skip the request and
        // wait out another interval; becoming visible again polls immediately.
        if (document.visibilityState !== "visible") {
          schedule()
          return
        }
        void poll()
      }, POLL_INTERVAL_MS)
    }

    async function poll() {
      if (stopped || inFlight) return
      if (Date.now() - startedAt >= MAX_POLL_MS) {
        stopped = true
        return
      }
      inFlight = true
      lastPolledAt = Date.now()
      try {
        const res = await fetch("/api/videos/processing-status", {
          cache: "no-store",
        })
        if (res.ok) {
          const status = (await res.json()) as VideoProcessingStatus
          if (stopped) return
          // Most polls land on unchanged state (the pipeline is simply still
          // running), so keep the previous object in that case and let the table
          // skip a pointless re-filter/re-sort of every row.
          setLive((current) =>
            current?.signature === signature &&
            statusSignature(current.status) === statusSignature(status)
              ? current
              : { signature, status },
          )
          // Everything has settled: the table is showing final state, so this
          // snapshot has nothing left to poll for.
          if (status.processingVideoIds.length === 0) {
            stopped = true
            return
          }
        }
      } catch {
        // A failed poll leaves the last known state on screen and tries again -
        // the pipeline is still running either way.
      } finally {
        inFlight = false
      }
      schedule()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return
      if (timer) clearTimeout(timer)
      // Catch up straight away on returning to the tab, but never faster than
      // the normal cadence - otherwise flicking between tabs becomes a burst of
      // requests.
      if (Date.now() - lastPolledAt >= POLL_INTERVAL_MS) void poll()
      else schedule()
    }

    schedule()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [signature, anyProcessing])

  // A poll result only speaks for the snapshot it was started from, so a newer
  // server render always wins over an older live answer.
  return live?.signature === signature ? live.status : initial
}
