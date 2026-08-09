"use client"

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"

import { AnalysisProcessingOverlay } from "@/components/analysis-processing"
import { ConfettiBurst } from "@/components/confetti-burst"
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
// outside the Analyse Video page.
export function useAnalysisLauncher(): AnalysisLauncherValue | null {
  return useContext(AnalysisLauncherContext)
}

// Owns the "analysing your video" popup for the whole Analyse Video page so both
// the URL form and the recent-uploads list trigger the same experience: paste a
// URL or hit "Analyse video" → spinner popup while /api/analyze runs → confetti
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

  const startAnalysis = useCallback(
    async (videoId: string) => {
      if (activeRef.current) return
      activeRef.current = true
      setError(null)
      setStage(null)
      setPhase("running")

      const fail = (failure: { error?: string; message?: string }) => {
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
        setPhase("done")
        window.setTimeout(() => {
          router.push(`/dashboard/analysed-video/${videoId}`)
        }, DONE_HOLD_MS)
      } catch {
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
// succeeded, or to the failure to show otherwise — including the case where the
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
