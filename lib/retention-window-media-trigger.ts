// Best-effort kickoff for retention-window media extraction, immediately
// followed by AI analysis of whatever extraction just finished, then a
// structured transcript read per window, immediately followed by cross-modal
// event synthesis for whichever windows' evidence just finished settling.
// Called from whichever of the two independent async processes finishes second
// for a given video:
//   • /api/analyze, right after the retention windows (and their pending
//     audio/scene-cue-scan/event-synthesis rows) are saved — the source
//     video may already be uploaded and normalised by then.
//   • the Qencode normalisation callback, right after a source file's proxy
//     flips to 'ready' — the retention analysis may already have run.
// Either caller no-ops if its half of the picture isn't ready yet; the other
// caller picks it up once it is.
//
// Runs via Next's after() so it happens once the response has been sent,
// never adding extraction latency to the request/webhook it's triggered from.
// None of extractPendingRetentionWindowMedia, analyzeRetentionWindowMedia, or
// synthesizeRetentionWindowEvents throws on its own (each row's/job's own
// failure is caught and recorded), but this is still wrapped defensively
// since after() callbacks that throw are logged as unhandled by the runtime.
// All three stay strictly sequential, in the same callback: analysis only
// claims rows extraction just marked 'ready', and synthesis only processes
// windows whose scan/snapshot/audio analysis just settled in the analysis
// step right before it.
//
// One pass is not always one analysis. A pass gets a single serverless
// invocation (maxDuration = 300 at every trigger point), and a long video's
// extraction alone can outlive that. It used to simply be killed there: the run
// row stayed 'running' until the staleness sweep reclaimed it, its rows stayed
// 'pending', and the only thing that ever resumed them was a browser polling
// the report page — so an analysis finished only if its owner happened to be
// watching. A pass now measures itself against that budget, stops while it can
// still record where it got to, and asks a fresh invocation to carry on (see
// lib/deep-analysis-continuation.ts). Nothing outside the server is involved,
// and the watchdog sweep (lib/deep-analysis-watchdog.ts) catches the passes
// that die too abruptly to hand over.

import { after } from "next/server"

import { analyzeRetentionWindowMedia } from "@/lib/retention-window-media-analysis"
import { analyzeRetentionWindowTranscriptTaxonomies } from "@/lib/retention-window-transcript-taxonomy"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStorageProvider } from "@/lib/storage/provider"
import {
  extractPendingRetentionWindowMedia,
  isSourceFileReady,
} from "@/lib/retention-window-media-extraction"
import type { SourceFile } from "@/lib/source-files/source-files"
import { synthesizeRetentionWindowEvents } from "@/lib/retention-window-event-synthesis"
import {
  claimDeepAnalysisPipelineRun,
  finishDeepAnalysisPipelineRun,
  runObservedPipelineStage,
  type DeepAnalysisPipelineStage,
} from "@/lib/deep-analysis-pipeline-runs"
import { dispatchDeepAnalysisContinuation } from "@/lib/deep-analysis-continuation"
import {
  createDeepAnalysisInvocationBudget,
  DEEP_ANALYSIS_STAGE_HEADROOM_MS,
} from "@/lib/deep-analysis-invocation-budget"
import { countUnsettledDeepAnalysisWork } from "@/lib/deep-analysis-watchdog"

export interface DeepAnalysisTriggerOptions {
  // Which link of the continuation chain this pass is: 0 for a fresh kickoff
  // (an upload landing, a transcode finishing, a manual retry), and the
  // previous pass's attempt + 1 when one pass hands over to the next.
  attempt?: number
}

interface PipelineStagePlan {
  stage: DeepAnalysisPipelineStage
  run: () => Promise<void>
  // A stage whose failure must not abort the pass. Only the transcript taxonomy
  // qualifies — see the note on its entry below.
  optional?: boolean
}

export function triggerRetentionWindowMediaExtraction(
  sourceFile: SourceFile | null,
  options: DeepAnalysisTriggerOptions = {},
): void {
  if (!isSourceFileReady(sourceFile)) return
  const attempt = options.attempt ?? 0

  after(async () => {
    // Started before any work, so the pass measures the whole invocation it is
    // actually spending, not just the part after the lease was claimed.
    const budget = createDeepAnalysisInvocationBudget()
    const admin = createAdminClient()
    const file = sourceFile as SourceFile
    const run = await claimDeepAnalysisPipelineRun(
      admin,
      file.userId,
      file.analysedVideoId,
    ).catch((error) => {
      console.error("Failed to claim deep analysis pipeline", error)
      return null
    })
    // No lease means another pass owns this video: it will finish the work, and
    // will hand over in turn if it can't.
    if (!run) return

    const countUnsettled = () =>
      countUnsettledDeepAnalysisWork(
        admin,
        file.userId,
        file.analysedVideoId,
      ).catch((error) => {
        console.error("Failed to count unsettled deep analysis work", error)
        return null
      })

    const unsettledBefore = await countUnsettled()

    const plan: PipelineStagePlan[] = [
      {
        stage: "extraction",
        run: () =>
          extractPendingRetentionWindowMedia(admin, getStorageProvider(), file),
      },
      {
        stage: "media_analysis",
        run: () =>
          analyzeRetentionWindowMedia(admin, file.userId, file.analysedVideoId),
      },
      // Runs before event synthesis so the synthesizer can fold each window's
      // structured transcript read into its evidence. Text-only and best-effort
      // per row, like the media analysis before it. Crucially, the taxonomy is
      // pure ENRICHMENT for synthesis: WindowEvidence.transcriptTaxonomy is
      // nullable and the synthesizer treats a missing read as "not generated,"
      // never a prerequisite. So a failure of this whole stage (a transient
      // OpenAI outage, or — as shipped once — a schema drift where its columns
      // don't yet exist) must not abort the pipeline before the events
      // themselves are synthesized. Record the stage failure (runObservedPipeline
      // Stage already persisted it into the run's stages) and continue to
      // synthesis, rather than letting a re-thrown error skip the core step and
      // strand every window's synthesis job 'pending' with zero events.
      {
        stage: "transcript_taxonomy",
        optional: true,
        run: () =>
          analyzeRetentionWindowTranscriptTaxonomies(
            admin,
            file.userId,
            file.analysedVideoId,
          ),
      },
      {
        stage: "event_synthesis",
        run: () =>
          synthesizeRetentionWindowEvents(
            admin,
            file.userId,
            file.analysedVideoId,
          ),
      },
    ]

    try {
      let paused = false
      for (const step of plan) {
        // Stages are coarse — a whole video's extraction, a whole video's media
        // analysis — so one started on a nearly-spent invocation mostly buys a
        // killed process. Stop here instead and let the next invocation start
        // it with a full budget; everything already settled stays settled,
        // because each stage only ever claims rows that are still pending.
        if (!budget.hasRoomFor(DEEP_ANALYSIS_STAGE_HEADROOM_MS)) {
          paused = true
          break
        }
        try {
          await runObservedPipelineStage(admin, run, step.stage, step.run)
        } catch (stageError) {
          if (!step.optional) throw stageError
          console.error(
            `Optional deep analysis stage failed; continuing (${step.stage})`,
            stageError,
          )
        }
      }

      const unsettledAfter = await countUnsettled()
      await finishDeepAnalysisPipelineRun(
        admin,
        run,
        { status: paused ? "paused" : "ready" },
        unsettledAfter,
      )
      await continueIfUnfinished({
        analysedVideoId: file.analysedVideoId,
        attempt,
        paused,
        unsettledBefore,
        unsettledAfter,
      })
    } catch (error) {
      console.error("Failed to run deep analysis pipeline", error)
      // A pass that threw has already recorded which stage failed. It doesn't
      // hand over: an immediate re-run would most likely hit the same failure,
      // and the watchdog sweep retries it on a cooldown and gives up out loud
      // once consecutive passes stop making progress.
      await finishDeepAnalysisPipelineRun(
        admin,
        run,
        {
          status: "failed",
          error:
            error instanceof Error ? error.message : "Deep analysis pipeline failed",
        },
        await countUnsettled(),
      ).catch(() => {})
    }
  })
}

// Asks a fresh invocation to pick up what this pass couldn't finish.
//
// Two cases deserve a hand-over: a pass that stopped early because its budget
// ran out, and a pass that ran every stage, moved the analysis forward, and
// still has rows left (a stage that got through some of its rows before its own
// internal timeouts, say). A pass that ran everything and changed nothing is
// neither: re-running it immediately would just repeat a no-op, so it's left to
// the watchdog, which paces its retries and eventually says so out loud.
async function continueIfUnfinished(params: {
  analysedVideoId: string
  attempt: number
  paused: boolean
  unsettledBefore: number | null
  unsettledAfter: number | null
}): Promise<void> {
  const { unsettledAfter, unsettledBefore, paused, attempt } = params
  if (unsettledAfter == null || unsettledAfter === 0) return
  const madeProgress = unsettledBefore != null && unsettledAfter < unsettledBefore
  if (!paused && !madeProgress) return

  const dispatched = await dispatchDeepAnalysisContinuation({
    analysedVideoId: params.analysedVideoId,
    attempt: attempt + 1,
  })
  if (!dispatched) {
    // Not fatal: the watchdog sweep picks the video up on its next tick. Worth
    // saying, though — a deployment that can never hand over runs the whole
    // pipeline at the sweep's pace instead of back-to-back.
    console.warn("Deep analysis continuation was not dispatched", {
      analysedVideoId: params.analysedVideoId,
      attempt: attempt + 1,
      unsettledAfter,
    })
  }
}
