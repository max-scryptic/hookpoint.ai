import { describe, expect, it } from "vitest"

import {
  buildEventSignals,
  type EventSignalsInput,
} from "@/lib/retention-window-event-signals"
import { EVENT_SIGNALS_SCHEMA_VERSION } from "@/lib/retention-window-events"
import type {
  AudioAnalysis,
  SnapshotAnalysis,
} from "@/lib/retention-window-media-analysis"

function snapshotAnalysis(
  overrides: Partial<SnapshotAnalysis> = {},
): SnapshotAnalysis {
  return {
    scene: "talking_head",
    face_visible: true,
    contains_text: false,
    contains_code: false,
    motion: "low",
    people_count: 1,
    camera_movement: "static",
    notable_event: null,
    description: "A person talking to camera.",
    ...overrides,
  }
}

function audioAnalysis(overrides: Partial<AudioAnalysis> = {}): AudioAnalysis {
  return {
    music: false,
    music_description: null,
    speakers: 1,
    tone: "measured",
    energy: "moderate",
    notable_events: [],
    speech_rate: 150,
    average_volume: -18,
    silence: 0.05,
    ...overrides,
  }
}

function input(overrides: Partial<EventSignalsInput> = {}): EventSignalsInput {
  return {
    delta: -0.08,
    steepness: -0.4,
    relativePerformance: 0.9,
    editing: { cutsPerMinute: 2, freezeCoverage: 0.1, blackCoverage: 0 },
    baseline: {
      cutsPerMinute: 11,
      freezeCoverage: 0.02,
      blackCoverage: 0.01,
      speechRate: 170,
      motion: 0.3,
    },
    visual: [
      {
        chunkIndex: 3,
        timestampSeconds: 40,
        ocrText: null,
        analysis: snapshotAnalysis(),
      },
      {
        chunkIndex: 4,
        timestampSeconds: 44,
        ocrText: "CHAPTER 2",
        analysis: snapshotAnalysis({
          contains_text: true,
          camera_movement: "cut",
          notable_event: "a chapter card appears",
        }),
      },
    ],
    audio: audioAnalysis(),
    contrast: {
      editingDelta: { cutsPerMinute: -9, freezeCoverage: 0.08, blackCoverage: 0 },
      audioDelta: { averageVolumeDb: -4, silence: 0.03, speechRate: -20 },
      motionDelta: -0.2,
      targetMotion: 0.1,
      controlMotion: 0.3,
    },
    ...overrides,
  }
}

describe("buildEventSignals", () => {
  it("stamps the current schema version and denormalises the window weight", () => {
    const signals = buildEventSignals(input(), 44)
    expect(signals.schemaVersion).toBe(EVENT_SIGNALS_SCHEMA_VERSION)
    expect(signals.window).toEqual({
      delta: -0.08,
      steepness: -0.4,
      relativePerformance: 0.9,
    })
  })

  it("captures editing deviations from the video's own baseline", () => {
    const signals = buildEventSignals(input(), 44)
    expect(signals.editing.cutsPerMinute).toBe(2)
    // 2 cuts/min against an 11 baseline is the slowdown that explains the drop.
    expect(signals.editing.cutsPerMinuteBaselineDelta).toBe(-9)
    expect(signals.editing.freezeCoverageBaselineDelta).toBeCloseTo(0.08)
  })

  it("leaves a baseline delta null when the baseline is unmeasured", () => {
    const signals = buildEventSignals(
      input({
        baseline: {
          cutsPerMinute: null,
          freezeCoverage: null,
          blackCoverage: null,
          speechRate: null,
          motion: null,
        },
      }),
      44,
    )
    expect(signals.editing.cutsPerMinuteBaselineDelta).toBeNull()
    expect(signals.audio?.speechRateBaselineDelta).toBeNull()
  })

  it("flattens the audio read and its speech-rate deviation", () => {
    const signals = buildEventSignals(input(), 44)
    expect(signals.audio).toMatchObject({
      energy: "moderate",
      tone: "measured",
      averageVolumeDb: -18,
      silence: 0.05,
      speechRate: 150,
      // 150 against a 170 baseline.
      speechRateBaselineDelta: -20,
    })
  })

  it("returns a null audio block when no audio was analysed", () => {
    const signals = buildEventSignals(input({ audio: null }), 44)
    expect(signals.audio).toBeNull()
  })

  it("carries the target-minus-control contrast deltas", () => {
    const signals = buildEventSignals(input(), 44)
    expect(signals.contrast).toEqual({
      cutsPerMinuteDelta: -9,
      freezeCoverageDelta: 0.08,
      blackCoverageDelta: 0,
      averageVolumeDbDelta: -4,
      silenceDelta: 0.03,
      speechRateDelta: -20,
      motionDelta: -0.2,
      targetMotion: 0.1,
      controlMotion: 0.3,
    })
  })

  it("returns a null contrast block for hook windows with no control", () => {
    const signals = buildEventSignals(input({ contrast: null }), 44)
    expect(signals.contrast).toBeNull()
  })

  it("links the frame nearest the event timestamp with its vision read", () => {
    const signals = buildEventSignals(input(), 44)
    expect(signals.frame).toEqual({
      chunkIndex: 4,
      timestampSeconds: 44,
      scene: "talking_head",
      faceVisible: true,
      containsText: true,
      containsCode: false,
      motion: "low",
      peopleCount: 1,
      cameraMovement: "cut",
      notableEvent: "a chapter card appears",
      ocrText: "CHAPTER 2",
    })
  })

  it("picks the closest frame when the timestamp falls between samples", () => {
    // 41 is nearer the chunk-3 frame at 40 than the chunk-4 frame at 44.
    const signals = buildEventSignals(input(), 41)
    expect(signals.frame?.chunkIndex).toBe(3)
  })

  it("returns a null frame when the window sampled none", () => {
    const signals = buildEventSignals(input({ visual: [] }), 44)
    expect(signals.frame).toBeNull()
  })
})
