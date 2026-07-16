import { describe, expect, it } from "vitest"

import { selectDeepAnalysisWindows } from "@/lib/deep-analysis-window-selection"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"

function window(
  id: string,
  kind: PersistedRetentionWindow["kind"],
  delta: number,
  overrides: Partial<PersistedRetentionWindow> = {},
): PersistedRetentionWindow {
  return {
    id,
    kind,
    windowIndex: 0,
    windowKey: null,
    label: null,
    fromSeconds: 30,
    toSeconds: 40,
    startWatchRatio: null,
    endWatchRatio: null,
    delta,
    relativePerformance: null,
    steepness: null,
    isAbnormallySteep: null,
    outOfRange: false,
    analysisFromSeconds: 0,
    analysisToSeconds: 50,
    ...overrides,
  }
}

describe("selectDeepAnalysisWindows", () => {
  it("keeps every eligible window when below the cap", () => {
    const windows = [window("hook", "hook", -0.2), window("drop", "drop_off", -0.1)]
    expect(selectDeepAnalysisWindows(windows, 6).map((item) => item.id)).toEqual([
      "hook",
      "drop",
    ])
  })

  it("always keeps the hook and balances the strongest drop and gain", () => {
    const windows = [
      window("hook", "hook", -0.2),
      window("drop-small", "drop_off", -0.04, { steepness: 1.2 }),
      window("drop-big", "drop_off", -0.08, { steepness: 2.5 }),
      window("gain-small", "gain", 0.03),
      window("gain-big", "gain", 0.07),
    ]

    expect(selectDeepAnalysisWindows(windows, 3).map((item) => item.id)).toEqual([
      "hook",
      "drop-big",
      "gain-big",
    ])
  })

  it("keeps both hook windows even under a tight cap", () => {
    const windows = [
      window("initial-hook", "hook", -0.2, { windowIndex: 0 }),
      window("hook-delivery", "hook", -0.15, { windowIndex: 1 }),
      window("drop-big", "drop_off", -0.08, { steepness: 2.5 }),
      window("gain-big", "gain", 0.07),
    ]

    // Both hooks are mandatory, so a cap of 2 spends both slots on them.
    expect(selectDeepAnalysisWindows(windows, 2).map((item) => item.id)).toEqual([
      "initial-hook",
      "hook-delivery",
    ])
  })

  it("excludes windows without an analysis range", () => {
    const windows = [
      window("hook", "hook", -0.2),
      window("unavailable", "gain", 0.5, {
        analysisFromSeconds: null,
        analysisToSeconds: null,
      }),
    ]
    expect(selectDeepAnalysisWindows(windows, 6).map((item) => item.id)).toEqual([
      "hook",
    ])
  })
})
