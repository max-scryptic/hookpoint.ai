"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import {
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"

import type { DeepAnalysisPipelineRunSummary } from "@/lib/deep-analysis-pipeline-runs"
import type {
  DeepAnalysisProgress as ProgressResponse,
  DeepAnalysisStages,
} from "@/lib/retention-window-media-progress"

const POLL_INTERVAL_MS = 4000

// What /api/videos/:videoId/analysis-progress actually returns: the stage
// snapshot, plus the latest pipeline-run summary and a `degraded` flag the
// route sets when it couldn't compute the per-stage breakdown but a source
// file is still ready (e.g. a transient DB error or schema drift). `degraded`
// still counts as analysing, so the report keeps showing its processing badge
// instead of nothing at all — the failure mode that once left an in-flight
// upload with no visible indication anywhere.
export interface DeepAnalysisProgressResponse extends ProgressResponse {
  pipelineRun?: DeepAnalysisPipelineRunSummary | null
  degraded?: boolean
}

// High-level, card-ready read of where a video's deep analysis stands, derived
// from the raw poll. Kept deliberately small so the report can drive a single
// spinner/failure indicator off it without re-deriving the rules.
export interface DeepAnalysisStatus {
  // The pipeline is running (or we can't yet tell, but a source file is ready
  // and nothing says it finished) — show a spinner.
  analysing: boolean
  // The latest run ended in failure and produced no complete result — prompt a
  // retry instead of a silent green check.
  failed: boolean
  // Full per-stage breakdown when the endpoint could compute it; null while
  // degraded/loading.
  progress: DeepAnalysisProgressResponse | null
}

// One poll's reading, stamped with the video and the restart it belongs to so a
// reading from a previous run is recognisably stale rather than silently read
// as the current one's.
interface PollReading {
  videoId: string
  restartToken: number
  progress: DeepAnalysisProgressResponse | null
  unreachable: boolean
}

const STAGE_LABELS: {
  key: keyof NonNullable<ProgressResponse["stages"]>
  label: string
}[] = [
  { key: "transcoding", label: "Transcoding video" },
  { key: "sceneCueScan", label: "Detecting scene changes" },
  { key: "snapshots", label: "Fetching snapshots" },
  { key: "snapshotAnalysis", label: "Analyzing visuals" },
  { key: "audio", label: "Fetching audio" },
  { key: "audioAnalysis", label: "Analyzing audio" },
  { key: "transcriptTaxonomy", label: "Reading window transcripts" },
  { key: "eventSynthesis", label: "Synthesizing retention events" },
]

// Polls /api/videos/:videoId/analysis-progress and folds the raw response into
// a small, card-ready status. Owns the single poll for the whole report (see
// DeepAnalysisStatusProvider below) so the header's processing badge and the
// source-file card's failure prompt read the same data without double-polling.
// Keeps polling while a run is in flight and while the endpoint is unreachable
// (it may recover), and stops once the run has settled or failed — the resting
// "Source file ready" row covers steady state. Bump `restartToken` to start a
// fresh poll after a manual retry.
//
// When a run finishes while the page is open it also refreshes the route once.
// Everything else about a finished deep analysis is server-rendered and gated on
// the pipeline having settled — most visibly the report's deep-analysis
// insights, which the page only loads once progress is complete. Without that
// refresh the processing badge would clear and the insights the run produced
// still wouldn't appear until the user reloaded by hand.
function useDeepAnalysisProgress(
  videoId: string,
  restartToken = 0,
): DeepAnalysisStatus {
  const router = useRouter()
  // The poll's readings are stamped with the run they belong to, so a restart
  // (or a different video) reads as a clean slate from the very first render
  // rather than briefly reporting the previous run's settled state.
  const [reading, setReading] = useState<PollReading>(() => ({
    videoId,
    restartToken,
    progress: null,
    unreachable: false,
  }))
  const stale =
    reading.videoId !== videoId || reading.restartToken !== restartToken
  const progress = stale ? null : reading.progress
  const unreachable = stale ? false : reading.unreachable
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    const stamp = { videoId, restartToken }
    const recordProgress = (data: DeepAnalysisProgressResponse) =>
      setReading({ ...stamp, progress: data, unreachable: false })
    // An unreachable endpoint keeps whatever this run last read, so a blip
    // doesn't wipe the stages out from under the reader.
    const recordUnreachable = () =>
      setReading((current) =>
        current.videoId === videoId && current.restartToken === restartToken
          ? { ...current, unreachable: true }
          : { ...stamp, progress: null, unreachable: true },
      )
    // Whether this mount has actually seen the pipeline unsettled. A page opened
    // on an already-finished analysis settles on its first poll with nothing new
    // to show, so only a run that finished *under us* is worth a refresh.
    let sawUnsettled = false

    async function poll() {
      try {
        const res = await fetch(`/api/videos/${videoId}/analysis-progress`)
        if (cancelled) return
        if (!res.ok) {
          recordUnreachable()
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
          return
        }
        const data = (await res.json()) as DeepAnalysisProgressResponse
        if (cancelled) return
        recordProgress(data)
        // Stop once the run has genuinely settled, or failed outright — either
        // way there's no more live work to reflect. A degraded read is not
        // settled: we still can't see the stages, so keep watching for recovery.
        const complete = data.complete && !data.degraded
        const done = complete || data.pipelineRun?.status === "failed"
        if (!done) {
          sawUnsettled = true
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
          return
        }
        // The run landed while the user was watching: pull the freshly unlocked
        // server-rendered sections in. A failed run has nothing new to render,
        // so it just leaves the card's retry prompt in place.
        if (complete && sawUnsettled) router.refresh()
      } catch {
        if (cancelled) return
        recordUnreachable()
        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [videoId, router, restartToken])

  const pipelineRun = progress?.pipelineRun ?? null
  const failed = pipelineRun?.status === "failed"

  // Analysing whenever a run is genuinely in flight, the endpoint gave a
  // degraded read, or we simply can't reach it yet — anything but a confirmed
  // settled state — and never while we're showing a failure to retry.
  const analysing =
    !failed &&
    (progress == null ||
      progress.degraded === true ||
      (progress.active && !progress.complete) ||
      unreachable ||
      pipelineRun?.status === "running")

  return useMemo(
    () => ({ analysing, failed, progress }),
    [analysing, failed, progress],
  )
}

// What the report's two consumers of deep-analysis state share: the status
// itself, plus a way to restart the poll after a manual retry.
export interface DeepAnalysisStatusValue extends DeepAnalysisStatus {
  restart: () => void
}

// Nothing is analysing until a provider says otherwise, so a component used
// outside one simply renders its resting state rather than needing a null
// check at every call site.
const IDLE_STATUS: DeepAnalysisStatusValue = {
  analysing: false,
  failed: false,
  progress: null,
  restart: () => {},
}

const DeepAnalysisStatusContext =
  createContext<DeepAnalysisStatusValue>(IDLE_STATUS)

// Owns the report page's single deep-analysis poll and hands it to both the
// header (which shows the "Processing…" badge while the pipeline runs) and the
// source-file card at the foot of the report (which prompts a retry when a run
// failed). They sit in different subtrees, so without this they'd poll the same
// endpoint twice over and each fire their own refresh when a run landed.
export function DeepAnalysisStatusProvider({
  videoId,
  children,
}: {
  videoId: string
  children: React.ReactNode
}) {
  const [restartToken, setRestartToken] = useState(0)
  const status = useDeepAnalysisProgress(videoId, restartToken)
  const restart = useCallback(() => setRestartToken((token) => token + 1), [])
  const value = useMemo(() => ({ ...status, restart }), [status, restart])

  return (
    <DeepAnalysisStatusContext.Provider value={value}>
      {children}
    </DeepAnalysisStatusContext.Provider>
  )
}

export function useDeepAnalysisStatus(): DeepAnalysisStatusValue {
  return useContext(DeepAnalysisStatusContext)
}

// The report header's live indicator that the footage-based half of the
// analysis is still running. Deliberately the same amber spinner the analysed
// videos table shows against a processing row, so the two places a video's
// deeper analysis surfaces read as one state.
export function DeepAnalysisProcessingBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-500"
      title="Deeper analysis is still running. This updates automatically when it finishes."
    >
      <Loader2Icon className="size-3.5 animate-spin" />
      Processing…
    </span>
  )
}

// The bare per-stage checklist. Presentational only: given a stage snapshot it
// renders each labelled stage with its status icon. Admin-facing only — the
// report itself says no more than "Processing…", so a reader waiting on their
// analysis isn't watching a list of pipeline internals tick over.
export function DeepAnalysisStageChecklist({
  stages,
  title = "Conducting deeper analysis…",
}: {
  stages: DeepAnalysisStages
  title?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {STAGE_LABELS.map(({ key, label }) => (
          <StageRow key={key} label={label} status={stages[key]} />
        ))}
      </ul>
    </div>
  )
}

function StageRow({
  label,
  status,
}: {
  label: string
  status: "pending" | "in_progress" | "ready" | "failed"
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <StageIcon status={status} />
      <span
        className={status === "pending" ? "text-muted-foreground" : undefined}
      >
        {label}
      </span>
    </li>
  )
}

function StageIcon({
  status,
}: {
  status: "pending" | "in_progress" | "ready" | "failed"
}) {
  switch (status) {
    case "pending":
      return <CircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
    case "in_progress":
      return (
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />
      )
    case "ready":
      return (
        <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
      )
    case "failed":
      return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
  }
}
