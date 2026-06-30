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
  // Guards against re-entrant launches (e.g. a double click) without waiting on
  // the async state updates.
  const activeRef = useRef(false)

  const startAnalysis = useCallback(
    async (videoId: string) => {
      if (activeRef.current) return
      activeRef.current = true
      setError(null)
      setPhase("running")

      try {
        // parseVideoId (server-side) accepts a bare video ID as well as a full
        // URL, so passing the ID straight through works for both entry points.
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: videoId }),
        })

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: string
            message?: string
          }
          setError(
            data.error === "reconnect_required"
              ? (data.message ?? "Please reconnect your YouTube account.")
              : (data.error ?? "We couldn't analyse that video."),
          )
          setPhase("error")
          activeRef.current = false
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
          error={error}
          onDismiss={dismiss}
        />
      )}
      {phase === "done" && <ConfettiBurst />}
    </AnalysisLauncherContext.Provider>
  )
}
