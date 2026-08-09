import { describe, expect, it } from "vitest"

import {
  CACHED_ANALYSIS_STAGES,
  FRESH_ANALYSIS_STAGES,
  createAnalysisProgressReporter,
  createAnalysisStreamParser,
  encodeAnalysisStreamEvent,
  type AnalysisStreamEvent,
} from "@/lib/analysis-progress-stream"

function collect() {
  const events: AnalysisStreamEvent[] = []
  return {
    events,
    emit: (event: AnalysisStreamEvent) => {
      events.push(event)
    },
  }
}

function stages(events: AnalysisStreamEvent[]) {
  return events.filter(
    (event): event is Extract<AnalysisStreamEvent, { type: "stage" }> =>
      event.type === "stage",
  )
}

describe("stage plans", () => {
  it("hand each stage a slice that ends where the next begins", () => {
    for (const plan of [FRESH_ANALYSIS_STAGES, CACHED_ANALYSIS_STAGES]) {
      const ends = plan.map((entry) => entry.end)
      expect([...ends]).toEqual([...ends].sort((a, b) => a - b))
      // The last stage stops short of 100 so only completion fills the bar.
      expect(ends[ends.length - 1]).toBeLessThan(100)
    }
  })

  // The route only learns which plan applies after the first stage has already
  // been reported, so the plans must agree on that shared prefix.
  it("share the lookup prefix so switching plans can't rewind the bar", () => {
    expect(CACHED_ANALYSIS_STAGES[0]).toEqual(FRESH_ANALYSIS_STAGES[0])
  })
})

describe("createAnalysisProgressReporter", () => {
  it("emits each stage starting where the previous one ended", () => {
    const { events, emit } = collect()
    const reporter = createAnalysisProgressReporter(emit)

    reporter.stage("lookup")
    reporter.stage("details")
    reporter.stage("retention")

    expect(stages(events).map((event) => [event.start, event.end])).toEqual([
      [0, 8],
      [8, 16],
      [16, 28],
    ])
  })

  it("advances within a stage without leaving its slice", () => {
    const { events, emit } = collect()
    const reporter = createAnalysisProgressReporter(emit)

    reporter.stage("extras")
    reporter.advance(0.25)
    reporter.advance(0.5)

    const [entered, quarter, half] = stages(events)
    expect(entered.start).toBe(72)
    expect(quarter.start).toBe(72 + (98 - 72) * 0.25)
    expect(half.start).toBe(72 + (98 - 72) * 0.5)
    // Sub-progress keeps the label and the stage's ceiling.
    expect(half.label).toBe(entered.label)
    expect(half.end).toBe(98)
    // …and shortens the remaining estimate so the easing doesn't restart slow.
    expect(half.estimatedMs).toBeLessThan(entered.estimatedMs)
  })

  it("never moves backwards", () => {
    const { events, emit } = collect()
    const reporter = createAnalysisProgressReporter(emit)

    reporter.stage("pacing")
    reporter.advance(0.8)
    const beforeExtras = stages(events).at(-1)!.start
    reporter.advance(0.1)
    reporter.stage("extras")

    expect(stages(events).map((event) => event.start)).toEqual([
      72 - 14,
      beforeExtras,
      72,
    ])
  })

  it("keeps climbing after switching to the cached plan", () => {
    const { events, emit } = collect()
    const reporter = createAnalysisProgressReporter(emit)

    reporter.stage("lookup")
    reporter.usePlan(CACHED_ANALYSIS_STAGES)
    reporter.stage("transcript")
    reporter.stage("pacing")

    expect(stages(events).map((event) => [event.start, event.end])).toEqual([
      [0, 8],
      [8, 30],
      [30, 60],
    ])
  })

  it("ignores stages the active plan doesn't have", () => {
    const { events, emit } = collect()
    const reporter = createAnalysisProgressReporter(
      emit,
      CACHED_ANALYSIS_STAGES,
    )

    reporter.stage("retention")

    expect(events).toHaveLength(0)
  })
})

describe("createAnalysisStreamParser", () => {
  it("reassembles events split across chunks", () => {
    const parser = createAnalysisStreamParser()
    const encoded = [
      encodeAnalysisStreamEvent({
        type: "stage",
        key: "lookup",
        label: "Looking up your video…",
        start: 0,
        end: 8,
        estimatedMs: 1200,
      }),
      encodeAnalysisStreamEvent({ type: "result", result: { ok: true } }),
    ].join("")

    const first = parser.push(encoded.slice(0, 30))
    const rest = parser.push(encoded.slice(30))

    expect(first).toHaveLength(0)
    expect(rest.map((event) => event.type)).toEqual(["stage", "result"])
  })

  it("returns several events from a single chunk and drops junk lines", () => {
    const parser = createAnalysisStreamParser()

    const events = parser.push(
      `not json\n${encodeAnalysisStreamEvent({
        type: "error",
        status: 402,
        error: "plan_limit_reached",
        message: "Out of analyses",
      })}`,
    )

    expect(events).toEqual([
      {
        type: "error",
        status: 402,
        error: "plan_limit_reached",
        message: "Out of analyses",
      },
    ])
  })

  it("flushes a trailing event that never got its newline", () => {
    const parser = createAnalysisStreamParser()

    parser.push('{"type":"result","result":null}')

    expect(parser.flush()).toEqual([{ type: "result", result: null }])
    expect(parser.flush()).toEqual([])
  })
})
