// Hands an unfinished deep-analysis pass to a fresh serverless invocation.
//
// The pipeline runs as one best-effort background pass per invocation (see
// lib/retention-window-media-trigger.ts). A big video's extraction, media
// analysis and synthesis routinely need more than one invocation's budget, and
// for a long time the only thing that ever started the next pass was a browser
// sitting on the report page polling /api/videos/:id/analysis-progress. Close
// the tab and the analysis simply stopped, half-done, until someone opened it
// again.
//
// A pass that ends with work still pending now asks for its own continuation:
// it POSTs to /api/deep-analysis/continue, which starts the pipeline again with
// a full budget. The chain is bounded (see MAX_ATTEMPTS) and every link is
// idempotent - the pipeline-run lease keeps two passes off the same video, and
// each stage only claims rows that are still pending - so the worst case of a
// duplicate dispatch is a no-op pass, not double work.

import { getAppBaseUrl } from "@/lib/source-files/normalisation-config"

// How many times a pass may hand itself on before it stops chaining and leaves
// the rest to the watchdog sweep (lib/deep-analysis-watchdog.ts). Each link
// gets a full invocation, so this is a ceiling on how long one video may keep
// the chain alive on its own, not a retry count for failures.
export const DEEP_ANALYSIS_MAX_CONTINUATION_ATTEMPTS = 8

export const DEEP_ANALYSIS_WORKER_SECRET_HEADER = "x-deep-analysis-worker-secret"

const DISPATCH_TIMEOUT_MS = 10_000

// Every secret this deployment accepts on its internal deep-analysis endpoints.
// DEEP_ANALYSIS_WORKER_SECRET is the dedicated one; the cron secret is accepted
// too so a deployment can be driven by a single configured value (the database
// watchdog calls in with it - see the pg_cron job in supabase/migrations).
// Order matters: the first entry is what outgoing dispatches present.
export function getDeepAnalysisWorkerSecrets(): string[] {
  return [
    process.env.DEEP_ANALYSIS_WORKER_SECRET,
    process.env.DEEP_ANALYSIS_CRON_SECRET,
    process.env.CRON_SECRET,
  ].filter((secret): secret is string => Boolean(secret))
}

// Whether a presented secret matches one this deployment accepts. Compared
// with a length-aware equality that doesn't short-circuit on the first
// differing byte, so a caller can't time its way to a valid secret.
export function isAuthorisedDeepAnalysisWorkerSecret(
  presented: string | null,
): boolean {
  if (!presented) return false
  return getDeepAnalysisWorkerSecrets().some((secret) =>
    safeEqual(presented, secret),
  )
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Whether a continuation can actually be dispatched: we need somewhere to send
// it and a secret to sign it with. Callers use this to fall back to doing the
// work inline rather than assuming the hand-off landed.
export function canDispatchDeepAnalysisContinuation(): boolean {
  return getAppBaseUrl() != null && getDeepAnalysisWorkerSecrets().length > 0
}

// Asks a fresh invocation to continue this video's deep analysis. Resolves once
// the worker has accepted the request (it answers immediately and does the work
// in its own after() callback), so a caller can await this without waiting on
// the pipeline itself. Returns false when the hand-off didn't land, leaving the
// caller to decide between running the work inline and leaving it to the
// watchdog.
export async function dispatchDeepAnalysisContinuation(params: {
  analysedVideoId: string
  // Which link of the chain the *next* pass is. A pass that was itself started
  // by a continuation passes its own attempt + 1.
  attempt: number
}): Promise<boolean> {
  const baseUrl = getAppBaseUrl()
  const [secret] = getDeepAnalysisWorkerSecrets()
  if (!baseUrl || !secret) return false
  if (params.attempt > DEEP_ANALYSIS_MAX_CONTINUATION_ATTEMPTS) return false

  const headers: Record<string, string> = {
    "content-type": "application/json",
    [DEEP_ANALYSIS_WORKER_SECRET_HEADER]: secret,
  }
  // Preview deployments sit behind Vercel's deployment protection, which would
  // answer this server-to-server call with an auth page instead of running it.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (bypass) headers["x-vercel-protection-bypass"] = bypass

  try {
    const response = await fetch(`${baseUrl}/api/deep-analysis/continue`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        analysedVideoId: params.analysedVideoId,
        attempt: params.attempt,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.error("Deep analysis continuation was rejected", {
        analysedVideoId: params.analysedVideoId,
        status: response.status,
      })
      return false
    }
    return true
  } catch (error) {
    console.error("Failed to dispatch deep analysis continuation", {
      analysedVideoId: params.analysedVideoId,
      error,
    })
    return false
  }
}
