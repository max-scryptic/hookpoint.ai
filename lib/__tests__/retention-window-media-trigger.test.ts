import { afterEach, describe, expect, it, vi } from "vitest"

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

vi.mock("@/lib/retention-window-media-extraction", () => ({
  isSourceFileReady: () => true,
  extractPendingRetentionWindowMedia: vi.fn(async () => {}),
}))

vi.mock("@/lib/retention-window-media-analysis", () => ({
  analyzeRetentionWindowMedia: vi.fn(async () => {}),
}))

// The stage under test: made to fail, standing in for any top-level failure of
// the best-effort transcript-taxonomy stage (a transient OpenAI outage, or the
// schema drift that shipped this stage's code ahead of its columns).
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
  // The real class, so the trigger's `instanceof` check against it is
  // meaningful — it is what separates "this video failed" from "another run
  // owns this video now".
  DeepAnalysisPipelineSupersededError: class DeepAnalysisPipelineSupersededError extends Error {},
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

afterEach(() => {
  vi.clearAllMocks()
  afterCallbacks.length = 0
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
})
