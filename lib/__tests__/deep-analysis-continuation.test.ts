import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEEP_ANALYSIS_MAX_CONTINUATION_ATTEMPTS,
  canDispatchDeepAnalysisContinuation,
  dispatchDeepAnalysisContinuation,
  isAuthorisedDeepAnalysisWorkerSecret,
} from "@/lib/deep-analysis-continuation"

const ENV_KEYS = [
  "APP_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "DEEP_ANALYSIS_WORKER_SECRET",
  "DEEP_ANALYSIS_CRON_SECRET",
  "CRON_SECRET",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
] as const

const saved = new Map<string, string | undefined>()

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
})

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  saved.clear()
  vi.unstubAllGlobals()
})

describe("isAuthorisedDeepAnalysisWorkerSecret", () => {
  it("accepts any secret the deployment is configured with", () => {
    process.env.DEEP_ANALYSIS_WORKER_SECRET = "worker-secret"
    process.env.DEEP_ANALYSIS_CRON_SECRET = "cron-secret"

    expect(isAuthorisedDeepAnalysisWorkerSecret("worker-secret")).toBe(true)
    // The database watchdog calls in with the cron secret, so a deployment can
    // be driven by a single configured value.
    expect(isAuthorisedDeepAnalysisWorkerSecret("cron-secret")).toBe(true)
    expect(isAuthorisedDeepAnalysisWorkerSecret("nearly-right")).toBe(false)
    expect(isAuthorisedDeepAnalysisWorkerSecret("")).toBe(false)
    expect(isAuthorisedDeepAnalysisWorkerSecret(null)).toBe(false)
  })

  it("refuses everything when nothing is configured", () => {
    // Otherwise an unconfigured deployment would expose an endpoint that makes
    // it do expensive work for any video id a stranger guessed.
    expect(isAuthorisedDeepAnalysisWorkerSecret("")).toBe(false)
    expect(isAuthorisedDeepAnalysisWorkerSecret("anything")).toBe(false)
  })
})

describe("dispatchDeepAnalysisContinuation", () => {
  it("asks the worker endpoint to carry on with the next attempt", async () => {
    process.env.APP_BASE_URL = "https://app.example.com/"
    process.env.DEEP_ANALYSIS_WORKER_SECRET = "worker-secret"
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      dispatchDeepAnalysisContinuation({
        analysedVideoId: "video-1",
        attempt: 2,
      }),
    ).resolves.toBe(true)

    expect(canDispatchDeepAnalysisContinuation()).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://app.example.com/api/deep-analysis/continue")
    expect(
      (init.headers as Record<string, string>)[
        "x-deep-analysis-worker-secret"
      ],
    ).toBe("worker-secret")
    expect(JSON.parse(init.body as string)).toEqual({
      analysedVideoId: "video-1",
      attempt: 2,
    })
  })

  it("carries the protection bypass so a protected deployment answers itself", async () => {
    process.env.APP_BASE_URL = "https://preview.example.com"
    process.env.DEEP_ANALYSIS_WORKER_SECRET = "worker-secret"
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass"
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await dispatchDeepAnalysisContinuation({
      analysedVideoId: "video-1",
      attempt: 1,
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(
      (init.headers as Record<string, string>)["x-vercel-protection-bypass"],
    ).toBe("bypass")
  })

  it("reports the hand-over as unlanded when it can't be made", async () => {
    // No base URL and no secret: the caller has to know, because the video now
    // depends on the watchdog sweep instead of a back-to-back pass.
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    expect(canDispatchDeepAnalysisContinuation()).toBe(false)
    await expect(
      dispatchDeepAnalysisContinuation({
        analysedVideoId: "video-1",
        attempt: 1,
      }),
    ).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("stops the chain at its ceiling", async () => {
    process.env.APP_BASE_URL = "https://app.example.com"
    process.env.DEEP_ANALYSIS_WORKER_SECRET = "worker-secret"
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      dispatchDeepAnalysisContinuation({
        analysedVideoId: "video-1",
        attempt: DEEP_ANALYSIS_MAX_CONTINUATION_ATTEMPTS + 1,
      }),
    ).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("treats a rejected or unreachable worker as an unlanded hand-over", async () => {
    process.env.APP_BASE_URL = "https://app.example.com"
    process.env.DEEP_ANALYSIS_WORKER_SECRET = "worker-secret"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    )

    await expect(
      dispatchDeepAnalysisContinuation({
        analysedVideoId: "video-1",
        attempt: 1,
      }),
    ).resolves.toBe(false)

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down")
      }),
    )

    await expect(
      dispatchDeepAnalysisContinuation({
        analysedVideoId: "video-1",
        attempt: 1,
      }),
    ).resolves.toBe(false)
  })
})
