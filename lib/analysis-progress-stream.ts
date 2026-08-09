// The wire format /api/analyze uses to report real progress while it runs.
//
// A fresh analysis is a long chain of work — YouTube reads, a DB write, then
// several LLM calls (pacing, retention attribution, packaging alignment, script
// taxonomy). The client used to guess at all of that with a timer, which meant
// the bar raced to its ceiling in a few seconds and then sat there for the whole
// LLM tail. Instead the route streams a line-delimited JSON event every time it
// enters (or advances within) a stage, and the client animates between the
// percentages those events carry. The bar then moves because the server moved.
//
// Each stage carries the window it owns (start → end) plus how long that stage
// usually takes, so the client can animate *inside* a stage rather than freezing
// between events. Estimates only shape the easing: the client eases
// asymptotically toward the stage's end, so a stage that runs long keeps
// creeping (never overshooting into the next stage's territory) and a stage that
// finishes early is snapped forward by the next event.

export type AnalysisStageKey =
  | "lookup"
  | "details"
  | "retention"
  | "dropoffs"
  | "transcript"
  | "persist"
  | "pacing"
  | "extras"

export interface AnalysisStageUpdate {
  key: AnalysisStageKey
  // User-facing copy for this stage, e.g. "Reading through the transcript…".
  label: string
  // Percentage the bar sits at as the stage begins.
  start: number
  // Percentage the stage climbs toward but never reaches; the next stage's
  // start. The final stage stops short of 100 so the completion snap is the
  // only thing that fills the bar.
  end: number
  // Roughly how long this stage takes, used purely to pace the easing.
  estimatedMs: number
}

export type AnalysisStreamEvent =
  | ({ type: "stage" } & AnalysisStageUpdate)
  // The analysis succeeded; `result` is the same payload the route used to
  // return as plain JSON.
  | { type: "result"; result: unknown }
  // The analysis failed after streaming began, so we can't use a status code —
  // `status` mirrors the one the non-streaming route would have returned.
  | { type: "error"; status: number; error: string; message?: string }

export const ANALYSIS_STREAM_CONTENT_TYPE = "application/x-ndjson"

interface AnalysisStagePlanEntry {
  key: AnalysisStageKey
  label: string
  // Where this stage hands over to the next one. Entries are ordered, and a
  // stage starts wherever the previous one ended (the first starts at 0).
  end: number
  estimatedMs: number
}

// A brand-new analysis: everything is computed from scratch, so the two LLM
// stages at the tail own the bulk of the bar.
export const FRESH_ANALYSIS_STAGES: readonly AnalysisStagePlanEntry[] = [
  { key: "lookup", label: "Looking up your video…", end: 8, estimatedMs: 1200 },
  {
    key: "details",
    label: "Fetching your video details…",
    end: 16,
    estimatedMs: 1500,
  },
  {
    key: "retention",
    label: "Pulling audience retention from YouTube…",
    end: 28,
    estimatedMs: 2500,
  },
  {
    key: "dropoffs",
    label: "Mapping where viewers drop off…",
    end: 34,
    estimatedMs: 600,
  },
  {
    key: "transcript",
    label: "Reading through the transcript…",
    end: 46,
    estimatedMs: 2500,
  },
  {
    key: "persist",
    label: "Saving your retention windows…",
    end: 58,
    estimatedMs: 3000,
  },
  {
    key: "pacing",
    label: "Analysing narrative pacing…",
    end: 72,
    estimatedMs: 9000,
  },
  {
    key: "extras",
    label: "Putting your report together…",
    end: 98,
    estimatedMs: 15000,
  },
] as const

// Replaying a saved analysis: the YouTube work is already done, so the plan is
// just the parts that can still miss their cache. It shares the "lookup" prefix
// with the fresh plan (same key, same window) because the route only discovers
// which plan applies once that first stage's DB read comes back — see
// AnalysisProgressReporter.usePlan.
export const CACHED_ANALYSIS_STAGES: readonly AnalysisStagePlanEntry[] = [
  { key: "lookup", label: "Looking up your video…", end: 8, estimatedMs: 1200 },
  {
    key: "transcript",
    label: "Reading through the transcript…",
    end: 30,
    estimatedMs: 1500,
  },
  {
    key: "pacing",
    label: "Analysing narrative pacing…",
    end: 60,
    estimatedMs: 8000,
  },
  {
    key: "extras",
    label: "Putting your report together…",
    end: 98,
    estimatedMs: 12000,
  },
] as const

export interface AnalysisProgressReporter {
  // Swaps the stage plan mid-flight. Only legal while the stages already
  // reported are a shared prefix of both plans, so the bar never rewinds.
  usePlan(plan: readonly AnalysisStagePlanEntry[]): void
  // Enters a stage, emitting its window to the client. Unknown keys (a stage
  // that isn't in the active plan) are ignored rather than throwing — progress
  // reporting must never be able to fail an analysis.
  stage(key: AnalysisStageKey): void
  // Reports sub-progress within the current stage, 0 → 1. Used where a stage is
  // several independent tasks (the surface extras fan-out) so the bar advances
  // as each one lands instead of waiting on the slowest.
  advance(fraction: number): void
}

export function createAnalysisProgressReporter(
  emit: (event: AnalysisStreamEvent) => void,
  initialPlan: readonly AnalysisStagePlanEntry[] = FRESH_ANALYSIS_STAGES,
): AnalysisProgressReporter {
  let plan = initialPlan
  let current: { entry: AnalysisStagePlanEntry; start: number } | null = null
  // Highest percentage emitted so far; the bar is monotonic by construction.
  let floor = 0

  function startOf(index: number): number {
    return index === 0 ? 0 : plan[index - 1].end
  }

  return {
    usePlan(next) {
      plan = next
    },
    stage(key) {
      const index = plan.findIndex((entry) => entry.key === key)
      if (index === -1) return
      const entry = plan[index]
      const start = Math.max(startOf(index), floor)
      current = { entry, start }
      floor = start
      emit({
        type: "stage",
        key: entry.key,
        label: entry.label,
        start,
        end: entry.end,
        estimatedMs: entry.estimatedMs,
      })
    },
    advance(fraction) {
      if (!current) return
      const clamped = Math.min(Math.max(fraction, 0), 1)
      const { entry, start } = current
      const at = start + (entry.end - start) * clamped
      if (at <= floor) return
      floor = at
      emit({
        type: "stage",
        key: entry.key,
        label: entry.label,
        start: at,
        end: entry.end,
        estimatedMs: Math.max(entry.estimatedMs * (1 - clamped), 500),
      })
    },
  }
}

export function encodeAnalysisStreamEvent(event: AnalysisStreamEvent): string {
  // JSON.stringify escapes newlines inside strings, so one event is always
  // exactly one line.
  return `${JSON.stringify(event)}\n`
}

// Incremental NDJSON reader for the browser side: a network chunk can split a
// line anywhere (or carry several), so hold the tail until its newline arrives.
// Malformed lines are dropped rather than thrown — a garbled progress tick must
// not take down an analysis that is otherwise fine.
export function createAnalysisStreamParser(): {
  push(chunk: string): AnalysisStreamEvent[]
  flush(): AnalysisStreamEvent[]
} {
  let buffer = ""

  function parse(line: string): AnalysisStreamEvent | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed) as AnalysisStreamEvent
    } catch {
      return null
    }
  }

  return {
    push(chunk) {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      return lines
        .map(parse)
        .filter((event): event is AnalysisStreamEvent => event !== null)
    },
    flush() {
      const rest = buffer
      buffer = ""
      const event = parse(rest)
      return event ? [event] : []
    },
  }
}
