// How much of its serverless invocation the deep-analysis pipeline is allowed
// to spend before it stops claiming new work, hands the rest to a fresh
// invocation and returns.
//
// Every trigger point for the pipeline runs under `maxDuration = 300` (see
// /api/analyze, the normalisation callback, /api/deep-analysis/continue, …).
// When a pass overruns that, the platform kills the process outright: no
// catch block runs, the pipeline-run row is left 'running' until the staleness
// sweep reclaims it, and - before this module existed - nothing on the server
// ever picked the remaining work back up. Recovery depended on a human opening
// the report page so its progress poll re-kicked the pipeline.
//
// Rather than race that kill, a pass measures itself against the same budget
// and stops early, while it still has time to record where it got to and ask
// for a continuation (see lib/deep-analysis-continuation.ts).

export const DEEP_ANALYSIS_INVOCATION_BUDGET_MS = 300_000

// Time left over at the end of a pass for the bookkeeping that follows the
// last stage: writing the run's stages, marking it paused, and dispatching the
// continuation request. Everything here is a handful of round-trips, so this
// only has to cover a slow database plus a slow dispatch.
export const DEEP_ANALYSIS_HANDOVER_HEADROOM_MS = 20_000

// What a stage needs on the clock before it's worth starting at all. Stages are
// coarse (a whole video's extraction, a whole video's media analysis), so
// starting one with a minute left mostly buys a killed invocation instead of a
// clean handover. Anything that can't fit goes to the next invocation, which
// gets the full budget for it.
export const DEEP_ANALYSIS_STAGE_HEADROOM_MS = 45_000

export interface DeepAnalysisInvocationBudget {
  // Milliseconds left before the invocation's own budget is spent. Can go
  // negative when a stage overran; callers should treat that as "no time left"
  // rather than as a number to plan with.
  remainingMs(): number
  // Whether there's enough of the budget left to start work needing `needMs`.
  hasRoomFor(needMs: number): boolean
}

export function createDeepAnalysisInvocationBudget(
  budgetMs: number = DEEP_ANALYSIS_INVOCATION_BUDGET_MS,
  now: () => number = Date.now,
): DeepAnalysisInvocationBudget {
  const startedAt = now()
  const remainingMs = () => budgetMs - (now() - startedAt)
  return {
    remainingMs,
    hasRoomFor: (needMs: number) => remainingMs() >= needMs,
  }
}
