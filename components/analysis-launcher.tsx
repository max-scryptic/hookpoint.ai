"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"

import { AnalysisProcessingOverlay } from "@/components/analysis-processing"
import { ConfettiBurst } from "@/components/confetti-burst"
import { useNavigationGuard } from "@/hooks/use-navigation-guard"
import {
  createAnalysisStreamParser,
  type AnalysisStageUpdate,
  type AnalysisStreamEvent,
} from "@/lib/analysis-progress-stream"

// How long the celebratory "done" state lingers before we navigate to the
// report, so the user registers the win (and sees the confetti) first. The
// report reads from the cache /api/analyze just wrote, so it loads straight
// into the finished UI.
const DONE_HOLD_MS = 1800

// Leaving mid-analysis undoes the run rather than letting it finish unwatched.
// An analysis saves as it goes and is charged for the moment its row lands, so a
// user who walks away part-way through would otherwise be charged for a video
// that reads as analysed while missing most of what makes it worth opening.
// Dropping the request is what tells the server: it stops at the next stage,
// deletes what this run created and hands the charge back (see
// app/api/analyze/route.ts). The warning below is what gives the user the
// chance to stay instead.
const LEAVE_WARNING =
  "Your video is still being analysed. Leaving now stops it and undoes it: nothing is saved, and the analysis goes back into your allowance."

type AnalysisPhase = "idle" | "running" | "done" | "error"

interface AnalysisLauncherValue {
  // Kicks off a brand-new analysis: shows the full-screen popup, runs
  // /api/analyze, then navigates to the report once it resolves. No-ops if an
  // analysis is already in flight.
  startAnalysis: (videoId: string) => void
  // True while the popup is up (running or finishing), so callers can disable
  // their own triggers and avoid double launches.
  isLaunching: boolean
}

const AnalysisLauncherContext = createContext<AnalysisLauncherValue | null>(null)

// Returns the launcher when rendered inside a provider, or null otherwise so
// consumers (e.g. the video list) can fall back to plain navigation when used
// outside the Analyse a Video page.
export function useAnalysisLauncher(): AnalysisLauncherValue | null {
  return useContext(AnalysisLauncherContext)
}

// Owns the "analysing your video" popup for the whole Analyse a Video page so
// both the URL form and the recent-uploads list trigger the same experience:
// paste a URL or hit "Analyse video" → spinner popup while /api/analyze runs
// → confetti
// → redirect to the finished report, instead of landing on an empty page that
// analyses in the background.
export function AnalysisLauncherProvider({
  children,
}: {
  children: ReactNode
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<AnalysisPhase>("idle")
  const [error, setError] = useState<string | null>(null)
  // Latest stage streamed by /api/analyze, which drives the popup's progress
  // bar. Null until the first event lands (the popup falls back to a simulated
  // climb until then).
  const [stage, setStage] = useState<AnalysisStageUpdate | null>(null)
  // Guards against re-entrant launches (e.g. a double click) without waiting on
  // the async state updates.
  const activeRef = useRef(false)
  // The request carrying the run in flight, or null when there is nothing to
  // give up on. Held in a ref because the places that read it (the page hiding,
  // this provider unmounting) are cleanups that must see the current run without
  // being re-subscribed on every phase change.
  const runRef = useRef<AbortController | null>(null)

  // A reload, a closed tab or a link out of the app throws away a run that has
  // already been charged for, so warn before the page goes away. Only while the
  // analysis is actually in flight: once it is written there is nothing to lose.
  useNavigationGuard(phase === "running", LEAVE_WARNING)

  // Gives up on the run in flight. Dropping the request is the whole message:
  // the route notices the connection has gone, stops at the next stage and
  // rolls back whatever it had created.
  const abandonRun = useCallback(() => {
    const controller = runRef.current
    if (!controller) return
    runRef.current = null
    activeRef.current = false
    controller.abort()
  }, [])

  // The two ways a run gets left behind: the whole page going away (a reload, a
  // closed tab, a link out of the app), and this provider being replaced by a
  // client-side navigation, which unmounts us without the document ever
  // unloading. The second is the one that would otherwise go unnoticed, since
  // the request would happily carry on with nobody reading it.
  useEffect(() => {
    const handlePageHide = () => abandonRun()
    window.addEventListener("pagehide", handlePageHide)
    return () => {
      window.removeEventListener("pagehide", handlePageHide)
      abandonRun()
    }
  }, [abandonRun])

  const startAnalysis = useCallback(
    async (videoId: string) => {
      if (activeRef.current) return
      activeRef.current = true
      setError(null)
      setStage(null)
      setPhase("running")

      // The request the run rides on, so leaving the page can drop it and the
      // route can see that it has been left.
      const controller = new AbortController()
      runRef.current = controller

      const fail = (failure: { error?: string; message?: string }) => {
        runRef.current = null
        setError(
          failure.error === "reconnect_required"
            ? (failure.message ?? "Please reconnect your YouTube account.")
            : (failure.message ??
                failure.error ??
                "We couldn't analyse that video."),
        )
        setPhase("error")
        activeRef.current = false
      }

      try {
        // parseVideoId (server-side) accepts a bare video ID as well as a full
        // URL, so passing the ID straight through works for both entry points.
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: videoId }),
          signal: controller.signal,
        })

        // Failures the route can detect before it starts working (no session,
        // unusable body) still come back as a plain JSON error response.
        if (!response.ok) {
          fail(
            (await response.json().catch(() => ({}))) as {
              error?: string
              message?: string
            },
          )
          return
        }

        // Otherwise the route streams progress: a stage event per step of the
        // analysis, then exactly one terminal result/error event. Consume it so
        // the popup's bar tracks the real work, and so we only navigate once
        // the analysis has actually finished.
        const failure = await consumeAnalysisStream(response, setStage)
        if (failure) {
          fail(failure)
          return
        }

        // Flip to the celebratory state, then hold briefly before navigating.
        // The popup stays up and covers the navigation until this provider
        // unmounts on the route change.
        runRef.current = null
        setPhase("done")
        window.setTimeout(() => {
          router.push(`/analysed-video/${videoId}`)
        }, DONE_HOLD_MS)
      } catch {
        // Giving up on the run aborts this request on purpose, and the page is
        // already on its way out, so there is nobody left to show an error to.
        if (runRef.current !== controller) return
        runRef.current = null
        setError("Something went wrong. Please try again.")
        setPhase("error")
        activeRef.current = false
      }
    },
    [router],
  )

  const dismiss = useCallback(() => {
    setPhase("idle")
    setError(null)
    setStage(null)
    activeRef.current = false
  }, [])

  return (
    <AnalysisLauncherContext.Provider
      value={{
        startAnalysis,
        isLaunching: phase === "running" || phase === "done",
      }}
    >
      {children}
      {phase !== "idle" && (
        <AnalysisProcessingOverlay
          status={
            phase === "done"
              ? "done"
              : phase === "error"
                ? "error"
                : "analysing"
          }
          stage={stage}
          error={error}
          onDismiss={dismiss}
        />
      )}
      {phase === "done" && <ConfettiBurst />}
    </AnalysisLauncherContext.Provider>
  )
}

// Reads /api/analyze's newline-delimited progress stream, pushing each stage
// event at the popup as it arrives. Resolves to null when the analysis
// succeeded, or to the failure to show otherwise - including the case where the
// stream ends without a terminal event, which means the connection dropped
// mid-analysis and we must not pretend the report is ready.
async function consumeAnalysisStream(
  response: Response,
  onStage: (stage: AnalysisStageUpdate) => void,
): Promise<{ error?: string; message?: string } | null> {
  if (!response.body) {
    // No readable stream (an environment without streaming support). Nothing to
    // report progress from, but the request itself succeeded.
    return null
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createAnalysisStreamParser()
  const outcome: {
    failure: { error?: string; message?: string } | null
    succeeded: boolean
  } = { failure: null, succeeded: false }

  const handle = (events: AnalysisStreamEvent[]) => {
    for (const event of events) {
      if (event.type === "stage") {
        const { key, label, start, end, estimatedMs } = event
        onStage({ key, label, start, end, estimatedMs })
      } else if (event.type === "result") {
        outcome.succeeded = true
      } else {
        outcome.failure = { error: event.error, message: event.message }
      }
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    handle(parser.push(decoder.decode(value, { stream: true })))
  }
  handle(parser.flush())

  if (outcome.failure) return outcome.failure
  if (!outcome.succeeded) {
    return { message: "We lost the connection while analysing that video." }
  }
  return null
}
