import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The trigger fires its work inside next/server's after(); capture the callback
// so a test can run it and await the whole pipeline to completion.
const { afterCallbacks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
}))

vi.mock("next/server", () => ({
  after: (cb: () => Promise<void>) => {
    afterCallbacks.push(cb)
  },
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}) as unknown,
}))

vi.mock("@/lib/storage/provider", () => ({
  getStorageProvider: () => ({}) as unknown,
}))

const extractPendingRetentionWindowMedia = vi.fn(async () => {})
vi.mock("@/lib/retention-window-media-extraction", () => ({
  isSourceFileReady: () => true,
  extractPendingRetentionWindowMedia: (...args: unknown[]) =>
    extractPendingRetentionWindowMedia(...(args as [])),
}))

vi.mock("@/lib/retention-window-media-analysis", () => ({
  analyzeRetentionWindowMedia: vi.fn(async () => {}),
}))

// The stage under test in the first case: made to fail, standing in for any
// top-level failure of the best-effort transcript-taxonomy stage (a transient
// OpenAI outage, or the schema drift that shipped this stage's code ahead of
// its columns).
const analyzeRetentionWindowTranscriptTaxonomies = vi.fn(async () => {
  throw new Error("taxonomy boom")
})
vi.mock("@/lib/retention-window-transcript-taxonomy", () => ({
  analyzeRetentionWindowTranscriptTaxonomies: (...args: unknown[]) =>
    analyzeRetentionWindowTranscriptTaxonomies(...(args as [])),
}))

const synthesizeRetentionWindowEvents = vi.fn(async () => {})
vi.mock("@/lib/retention-window-event-synthesis", () => ({
  synthesizeRetentionWindowEvents: (...args: unknown[]) =>
    synthesizeRetentionWindowEvents(...(args as [])),
}))

const finishDeepAnalysisPipelineRun = vi.fn(async (..._args: unknown[]) => {})
vi.mock("@/lib/deep-analysis-pipeline-runs", () => ({
  claimDeepAnalysisPipelineRun: async () => ({ id: "run-1", stages: {} }),
  // Faithful to the real helper's contract: run the task and let it reject.
  runObservedPipelineStage: async (
    _admin: unknown,
    _run: unknown,
    _stage: unknown,
    task: () => Promise<void>,
  ) => task(),
  finishDeepAnalysisPipelineRun: (...args: unknown[]) =>
    finishDeepAnalysisPipelineRun(...(args as [])),
}))

// How much work each successive count of unsettled rows reports: the pass reads
// it once before its stages and once after, so a pair of readings is one pass.
const unsettledReadings: number[] = []
const countUnsettledDeepAnalysisWork = vi.fn(async () =>
  unsettledReadings.length > 0 ? unsettledReadings.shift()! : 0,
)
vi.mock("@/lib/deep-analysis-watchdog", () => ({
  countUnsettledDeepAnalysisWork: () => countUnsettledDeepAnalysisWork(),
}))

const dispatchDeepAnalysisContinuation = vi.fn(async () => true)
vi.mock("@/lib/deep-analysis-continuation", () => ({
  dispatchDeepAnalysisContinuation: (...args: unknown[]) =>
    dispatchDeepAnalysisContinuation(...(args as [])),
}))

// Which budget checks report headroom, in order. `true` forever by default; a
// test pushes `false` to stand in for an invocation about to be spent.
const budgetAnswers: boolean[] = []
vi.mock("@/lib/deep-analysis-invocation-budget", () => ({
  DEEP_ANALYSIS_STAGE_HEADROOM_MS: 45_000,
  createDeepAnalysisInvocationBudget: () => ({
    remainingMs: () => 300_000,
    hasRoomFor: () =>
      budgetAnswers.length > 0 ? budgetAnswers.shift()! : true,
  }),
}))

import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import type { SourceFile } from "@/lib/source-files/source-files"

async function runAfterCallbacks(): Promise<void> {
  while (afterCallbacks.length > 0) {
    await afterCallbacks.shift()!()
  }
}

const sourceFile = {
  userId: "user-1",
  analysedVideoId: "av-1",
} as unknown as SourceFile

beforeEach(() => {
  analyzeRetentionWindowTranscriptTaxonomies.mockImplementation(async () => {
    throw new Error("taxonomy boom")
  })
  extractPendingRetentionWindowMedia.mockImplementation(async () => {})
})

afterEach(() => {
  vi.clearAllMocks()
  afterCallbacks.length = 0
  unsettledReadings.length = 0
  budgetAnswers.length = 0
})

describe("triggerRetentionWindowMediaExtraction", () => {
  it("still synthesizes events when the transcript-taxonomy stage fails", async () => {
    triggerRetentionWindowMediaExtraction(sourceFile)
    await runAfterCallbacks()

    // The enrichment stage failed...
    expect(analyzeRetentionWindowTranscriptTaxonomies).toHaveBeenCalledTimes(1)
    // ...but the core synthesis stage still ran (the bug: a re-thrown taxonomy
    // error used to abort the chain here, stranding every window 'pending' with
    // zero events)...
    expect(synthesizeRetentionWindowEvents).toHaveBeenCalledTimes(1)
    // ...and the run finished successfully rather than being marked failed.
    expect(finishDeepAnalysisPipelineRun).toHaveBeenCalledTimes(1)
    expect(finishDeepAnalysisPipelineRun.mock.calls[0]?.[2]).toEqual({
      status: "ready",
    })
  })

  it("stops before a stage it can't afford and hands the rest to a fresh invocation", async () => {
    // Room for extraction, then the invocation is spent: the pass must stop
    // rather than start a stage the platform would kill it in the middle of.
    budgetAnswers.push(true, false)
    unsettledReadings.push(12, 7)

    triggerRetentionWindowMediaExtraction(sourceFile, { attempt: 2 })
    await runAfterCallbacks()

    expect(extractPendingRetentionWindowMedia).toHaveBeenCalledTimes(1)
    expect(synthesizeRetentionWindowEvents).not.toHaveBeenCalled()
    // Paused, not failed: the analysis is still coming, so the report keeps its
    // processing badge instead of prompting a retry.
    expect(finishDeepAnalysisPipelineRun.mock.calls[0]?.[2]).toEqual({
      status: "paused",
    })
    expect(finishDeepAnalysisPipelineRun.mock.calls[0]?.[3]).toBe(7)
    expect(dispatchDeepAnalysisContinuation).toHaveBeenCalledWith({
      analysedVideoId: "av-1",
      attempt: 3,
    })
  })

  it("hands over when a full pass moved the analysis forward but left work behind", async () => {
    unsettledReadings.push(9, 4)

    triggerRetentionWindowMediaExtraction(sourceFile)
    await runAfterCallbacks()

    expect(finishDeepAnalysisPipelineRun.mock.calls[0]?.[2]).toEqual({
      status: "ready",
    })
    expect(dispatchDeepAnalysisContinuation).toHaveBeenCalledWith({
      analysedVideoId: "av-1",
      attempt: 1,
    })
  })

  it("does not hand over when a full pass changed nothing", async () => {
    // Same work before and after: another immediate pass would repeat the same
    // no-op. The watchdog paces those retries and eventually gives up out loud.
    unsettledReadings.push(4, 4)

    triggerRetentionWindowMediaExtraction(sourceFile)
    await runAfterCallbacks()

    expect(dispatchDeepAnalysisContinuation).not.toHaveBeenCalled()
  })

  it("does not hand over once every row has settled", async () => {
    unsettledReadings.push(4, 0)

    triggerRetentionWindowMediaExtraction(sourceFile)
    await runAfterCallbacks()

    expect(dispatchDeepAnalysisContinuation).not.toHaveBeenCalled()
  })

  it("does not hand over after a stage failed outright", async () => {
    extractPendingRetentionWindowMedia.mockImplementation(async () => {
      throw new Error("extraction boom")
    })
    unsettledReadings.push(9, 9)

    triggerRetentionWindowMediaExtraction(sourceFile)
    await runAfterCallbacks()

    expect(finishDeepAnalysisPipelineRun.mock.calls[0]?.[2]).toEqual({
      status: "failed",
      error: "extraction boom",
    })
    expect(dispatchDeepAnalysisContinuation).not.toHaveBeenCalled()
  })
})
