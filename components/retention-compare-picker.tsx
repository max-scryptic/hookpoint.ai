"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeftRightIcon } from "lucide-react"

import {
  ComparisonProcessingOverlay,
  type ComparisonMode,
} from "@/components/comparison-processing"
import { ConfettiBurst } from "@/components/confetti-burst"
import { Button } from "@/components/ui/button"
import { useNavigationGuard } from "@/hooks/use-navigation-guard"
import { VIDEO_COMPARISON_CREDIT_COST } from "@/lib/plans"
import type { ComparableVideo } from "@/lib/retention-comparison"
import { isSamePair } from "@/lib/video-comparisons"

// The Video Comparator's video selectors and report trigger. Both selects start
// empty, and picking a pair does not load anything on its own: a comparison
// costs deep-dive credits, so the report is only generated when the creator
// presses the button. A pair that was already generated (in either order)
// re-opens for free, and the button says so. The very first comparison a paid
// creator generates is free too (see comparisonCreditCost), and the line under
// the button says that instead of quoting a price.
//
// This button is the one and only trigger for writing a report: the report page
// is a pure read and never generates anything, so a saved pair that is missing
// a section (one generated before that section existed, or one whose generation
// failed) is finished here, for free, rather than on view.
//
// Generating never navigates early. Writing a head-to-head runs two model
// passes (see app/api/video-comparisons/route.ts), so pressing "Generate
// report" raises the full-screen popup and holds it for the whole run, the same
// way analysing a video does. Only once the endpoint has finished and stored
// every part of the report does the popup flip to its done state: confetti,
// then a button through to the finished report. That way the creator never
// lands on a report page that is still writing itself.
//
// Leaving mid-generation undoes the run rather than abandoning it half-written.
// The pair is saved and charged for before the first word of it can be written,
// so a creator who closes the tab (or clicks away) would otherwise be left with
// a paid-for pair in their history that opens onto an empty report. So the
// moment this page goes away with a run still in flight, we tell the server, and
// it deletes the pair that run created and hands the credits back: pressing the
// button and walking away costs exactly nothing, and the picker is right back
// where it was. The warning below is what gives the creator the chance to stay
// instead.
//
// Selecting a pair is local state here; opening a finished report (or
// re-opening a paid-for one) is a navigation to the dedicated report page at
// video-comparator/report?a=..&b=.. so the report renders on its own page and
// the URL stays shareable.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

type Phase = "idle" | "generating" | "done" | "error"

const LEAVE_WARNING =
  "Your comparison report is still being generated. Leaving now stops it and undoes it: nothing is saved, and anything it charged goes back."

const ABANDON_ENDPOINT = "/api/video-comparisons/abandon"

// The run in flight, as much of it as the server needs to undo it: which pair it
// is writing, when it started (so it can only ever take back the row this run
// created), and the handle to stop waiting on it.
interface ActiveRun {
  a: string
  b: string
  startedAt: string
  controller: AbortController
}

// Tells the server the run was abandoned. Sent as a beacon because the usual
// reason to send it is that this page is going away: a beacon outlives the
// document, where a normal request would be cancelled with everything else.
function reportAbandonedRun(run: ActiveRun): void {
  const body = JSON.stringify({
    videoAId: run.a,
    videoBId: run.b,
    startedAt: run.startedAt,
  })

  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(
      ABANDON_ENDPOINT,
      new Blob([body], { type: "application/json" }),
    )
    return
  }

  void fetch(ABANDON_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Nothing to do from a page that is on its way out. The generate endpoint
    // sees the dropped connection too, and the Video Comparator sweeps up any
    // run neither of them reported.
  })
}

function optionLabel(video: ComparableVideo): string {
  const title = video.title ?? "Untitled video"
  return video.averageViewPercentage != null
    ? `${title} (${Math.round(video.averageViewPercentage)}% avg watched)`
    : title
}

function reportHref(a: string, b: string): string {
  return `/video-comparator/report?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
}

export function RetentionComparePicker({
  videos,
  savedPairs,
  firstComparisonFree,
}: {
  videos: ComparableVideo[]
  // The unordered pairs the creator has already generated, so the button can
  // offer a free re-open instead of another charge. reportsReady says whether
  // that pair's report is complete: a saved pair missing a written section is
  // still free, but it has to go through the endpoint to be finished.
  savedPairs: Array<{ a: string; b: string; reportsReady: boolean }>
  // True when this creator has never generated a head-to-head, so the next one
  // costs nothing (see comparisonCreditCost). Only ever a matter of what the
  // line under the button promises: the price is the server's to decide, and it
  // decides it again on the press.
  firstComparisonFree: boolean
}) {
  const router = useRouter()
  const [a, setA] = useState("")
  const [b, setB] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True when the run finished but a section could not be written, so the done
  // state promises a little less than a clean run does.
  const [partial, setPartial] = useState(false)
  // Whether this run is writing a head-to-head the creator did not have, or
  // finishing one they did, so the popup can end on the right promise. Guessed
  // from the saved pairs when the button is pressed (that is all we know before
  // the response) and then corrected from what the server actually did, since
  // the pairs this page was rendered with can be a deploy or another tab out of
  // date.
  const [mode, setMode] = useState<ComparisonMode>("new")
  // Guards against re-entrant generates (for example a double click) without
  // waiting on the async state updates.
  const activeRef = useRef(false)
  // The run in flight, or null when there is nothing to undo. Held in a ref
  // rather than state because the two places that read it (the page hiding, this
  // component unmounting) are cleanups that must see the current run without
  // being re-subscribed every time the phase changes.
  const runRef = useRef<ActiveRun | null>(null)

  const bothPicked = a !== "" && b !== "" && a !== b
  const saved = bothPicked
    ? savedPairs.find((pair) => isSamePair(pair, { a, b }))
    : undefined
  const alreadyGenerated = saved != null
  // Paid for and finished: this press is a straight re-open. Paid for but
  // missing a section still costs nothing, but it runs the generate flow to
  // write what is missing.
  const alreadyComplete = alreadyGenerated && saved.reportsReady
  const busy = phase === "generating" || phase === "done"

  // A reload or a tab close mid-generation abandons a run that has already been
  // charged for, so warn before the page goes away. Only while the work is
  // actually in flight: once the report is written there is nothing to lose.
  useNavigationGuard(phase === "generating", LEAVE_WARNING)

  // Gives up on the run in flight and asks the server to undo it. Called once
  // per run: whichever way out fires first clears the ref, so a departure that
  // trips both (the page hiding, then this component unmounting) still only
  // reports it once.
  const abandonRun = useCallback(() => {
    const run = runRef.current
    if (!run) return
    runRef.current = null
    activeRef.current = false
    // Stop waiting on the response. This also drops the connection, which is
    // the generate endpoint's own cue that the run has been abandoned.
    run.controller.abort()
    reportAbandonedRun(run)
  }, [])

  // The two ways a run is left behind, both of which have to undo it: the whole
  // page going away (a reload, a closed tab, a link out of the app) and this
  // page being replaced by a client-side navigation, which unmounts us without
  // the document ever unloading. Bound once, for the life of the component,
  // since both read the run through the ref.
  useEffect(() => {
    const handlePageHide = () => abandonRun()
    window.addEventListener("pagehide", handlePageHide)
    return () => {
      window.removeEventListener("pagehide", handlePageHide)
      abandonRun()
    }
  }, [abandonRun])

  const open = useCallback(
    (nextA: string, nextB: string) => {
      router.push(reportHref(nextA, nextB))
      router.refresh()
    },
    [router],
  )

  const generate = async () => {
    if (!bothPicked || activeRef.current) return
    // A pair already paid for whose report is complete just re-opens: nothing
    // to write, so no popup and no round-trip. A saved pair that is missing a
    // section goes through the endpoint like a new one (for free) so the part
    // that never made it onto the row is written now. The report page itself
    // never generates, so this button is the only way a report gets written.
    if (alreadyComplete) {
      open(a, b)
      return
    }

    activeRef.current = true
    setError(null)
    setMode(alreadyGenerated ? "update" : "new")
    setPhase("generating")
    // Record the run before it starts, so that leaving at any point from here on
    // has everything it needs to undo it. startedAt is what limits the undo to
    // this run's own work: a pair generated before this moment was paid for
    // previously and stays where it is.
    const run: ActiveRun = {
      a,
      b,
      startedAt: new Date().toISOString(),
      controller: new AbortController(),
    }
    runRef.current = run
    try {
      const response = await fetch("/api/video-comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoAId: a, videoBId: b }),
        signal: run.controller.signal,
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        reportsReady?: boolean
        charged?: number
        created?: boolean
      } | null
      if (!response.ok) {
        runRef.current = null
        setError(payload?.error ?? "We couldn't generate that comparison.")
        setPhase("error")
        activeRef.current = false
        return
      }
      // The endpoint only resolves once both head-to-heads have been written
      // and stored, so by here the report is finished. reportsReady is false
      // only when a section could not be written at all, in which case the
      // report opens without it and the popup says so. Warm the route while the
      // creator reads the done state so pressing through is instant.
      runRef.current = null
      setPartial(payload?.reportsReady === false)
      // What the server did is the only reliable answer to whether this press
      // made something new, whatever the pairs this page was rendered with
      // happened to say. It says so outright: what it charged cannot answer it
      // any more, since a creator's first comparison is new and free at once.
      // (An older deploy that does not say falls back to the price, which was
      // the answer while every new pair cost something.)
      const createdPair = payload?.created ?? payload?.charged !== 0
      setMode(createdPair ? "new" : "update")
      router.prefetch(reportHref(a, b))
      // Pull the history and the saved pairs back down now the run has landed,
      // rather than waiting for the creator to press through to the report. A
      // new pair appears in the list behind the popup, a finished one stops
      // asking to be finished, and either way what is on this page after a run
      // is what actually happened rather than what was true before it started.
      router.refresh()
      setPhase("done")
    } catch {
      // Abandoning the run aborts this request on purpose, and the page is
      // already on its way out, so there is nobody left to show an error to.
      if (runRef.current !== run) return
      runRef.current = null
      setError("We couldn't reach the server. Please try again.")
      setPhase("error")
      activeRef.current = false
    }
  }

  const dismiss = () => {
    setPhase("idle")
    setError(null)
    setPartial(false)
    setMode("new")
    activeRef.current = false
  }

  // The popup stays up through the navigation (it only unmounts when this page
  // does), so the creator never sees a flash of the picker on the way out.
  const openReport = () => {
    setOpening(true)
    open(a, b)
  }

  const selectClass =
    "h-9 w-full min-w-0 rounded-md border bg-card px-2 text-sm"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <select
          aria-label="First video"
          className={selectClass}
          value={a}
          disabled={busy}
          onChange={(event) => setA(event.target.value)}
        >
          <option value="">Select a video</option>
          {videos.map((video) => (
            <option key={video.id} value={video.id} disabled={video.id === b}>
              {optionLabel(video)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Swap the two videos"
          disabled={busy}
          className="mx-auto flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-foreground disabled:opacity-50"
          onClick={() => {
            setA(b)
            setB(a)
          }}
        >
          <ArrowLeftRightIcon className="size-4" />
        </button>
        <select
          aria-label="Second video"
          className={selectClass}
          value={b}
          disabled={busy}
          onChange={(event) => setB(event.target.value)}
        >
          <option value="">Select a video</option>
          {videos.map((video) => (
            <option key={video.id} value={video.id} disabled={video.id === a}>
              {optionLabel(video)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          onClick={generate}
          disabled={!bothPicked || busy}
          className="shrink-0 sm:w-auto"
        >
          {alreadyComplete
            ? "View report"
            : alreadyGenerated
              ? "Finish report"
              : "Generate report"}
        </Button>
      </div>

      {!alreadyGenerated && firstComparisonFree && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            Your first comparison report is free.
          </span>{" "}
          This one costs no deep-dive credits, and takes a couple of minutes to
          write. After it, a comparison costs{" "}
          {VIDEO_COMPARISON_CREDIT_COST} credits.
        </p>
      )}
      {!alreadyGenerated && !firstComparisonFree && (
        <p className="text-xs text-muted-foreground">
          A comparison costs {VIDEO_COMPARISON_CREDIT_COST} deep-dive credits,
          and takes a couple of minutes to write.
        </p>
      )}
      {alreadyGenerated && !alreadyComplete && (
        <p className="text-xs text-muted-foreground">
          Part of this report was never written. Finishing it is free, since you
          have already paid for this pair, and takes a couple of minutes.
        </p>
      )}

      {phase !== "idle" && (
        <ComparisonProcessingOverlay
          status={
            phase === "done"
              ? "done"
              : phase === "error"
                ? "error"
                : "generating"
          }
          mode={mode}
          error={error}
          partial={partial}
          opening={opening}
          onDismiss={dismiss}
          onOpenReport={openReport}
        />
      )}
      {/* Confetti is for a head-to-head that did not exist a minute ago.
          Filling in a section of one the creator already had is worth finishing
          well, but celebrating it the same way is part of what makes it read as
          a report that was created and then went missing from the list. */}
      {phase === "done" && mode === "new" && <ConfettiBurst />}
    </div>
  )
}
