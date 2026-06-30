import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildPacingWindows,
  chunkPacingWindows,
  generatePacingAnalysis,
} from "@/lib/pacing-analysis"

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_PACING_MODEL
  delete process.env.OPENAI_PACING_MAX_WINDOWS_PER_CALL
  delete process.env.OPENAI_PACING_MAX_TRANSCRIPT_CHARS_PER_CALL
  delete process.env.OPENAI_PACING_MAX_PARALLEL_CHUNKS
})

describe("buildPacingWindows", () => {
  it("uses a 30 second hook followed by 60 second windows", () => {
    const windows = buildPacingWindows(200, [
      { startSeconds: 0, endSeconds: 10, text: "one two three four five" },
      { startSeconds: 40, endSeconds: 50, text: "the first full minute" },
    ])

    expect(windows.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds])).toEqual([
      [0, 30],
      [30, 90],
      [90, 150],
      [150, 200],
    ])
    expect(windows[0]).toMatchObject({
      id: "hook",
      label: "Hook",
      kind: "hook",
      wordCount: 5,
      wordsPerMinute: 10,
    })
  })

  it("returns only a shortened hook for videos under 30 seconds", () => {
    expect(buildPacingWindows(18, [])).toMatchObject([
      { startSeconds: 0, endSeconds: 18, kind: "hook" },
    ])
  })

  it("does not add an empty minute window at exactly 30 seconds", () => {
    expect(buildPacingWindows(30, [])).toHaveLength(1)
  })

  it("chunks long analyses by window count and transcript size", () => {
    const windows = buildPacingWindows(190, [
      { startSeconds: 1, endSeconds: 2, text: "123456" },
      { startSeconds: 31, endSeconds: 32, text: "123456" },
      { startSeconds: 91, endSeconds: 92, text: "123456" },
      { startSeconds: 151, endSeconds: 152, text: "123456" },
    ])

    expect(
      chunkPacingWindows(windows, {
        maxWindows: 3,
        maxTranscriptCharacters: 10,
      }).map((chunk) => chunk.length),
    ).toEqual([1, 1, 1, 1])
  })

  it("merges structured GPT judgments with deterministic window metrics", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    process.env.OPENAI_PACING_MODEL = "test-gpt"
    const modelOutput = {
      overallPacing: "A quick hook followed by a steadier explanation.",
      videoWidePatterns: ["The delivery settles after the hook."],
      notableTransitions: [
        { atSeconds: 30, description: "Moves from hook to explanation." },
      ],
      slowOrRepetitiveStretches: [],
      windows: [
        {
          windowIndex: 0,
          role: "Hook",
          pace: "fast",
          informationDensity: "high",
          progression: "strong",
          pacingChange: "stable",
          evidence: ["Introduces the premise immediately."],
          possibleIssue: null,
          confidence: 0.9,
        },
        {
          windowIndex: 1,
          role: "Explanation",
          pace: "moderate",
          informationDensity: "moderate",
          progression: "steady",
          pacingChange: "decelerating",
          evidence: ["Develops one idea in more detail."],
          possibleIssue: null,
          confidence: 0.8,
        },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                { type: "output_text", text: JSON.stringify(modelOutput) },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await generatePacingAnalysis(
      { title: "Test", durationSeconds: 70 },
      [
        { startSeconds: 0, endSeconds: 10, text: "one two three four five" },
        { startSeconds: 35, endSeconds: 45, text: "six seven eight nine" },
      ],
    )

    expect(result).toMatchObject({
      model: "test-gpt",
      overallPacing: modelOutput.overallPacing,
      windows: [
        { startSeconds: 0, endSeconds: 30, wordsPerMinute: 10, pace: "fast" },
        {
          startSeconds: 30,
          endSeconds: 70,
          wordsPerMinute: 6,
          pace: "moderate",
        },
      ],
    })
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(request.text.format).toMatchObject({
      type: "json_schema",
      name: "youtube_pacing_analysis",
      strict: true,
    })
    expect(request.input[1].content[0].text).not.toContain("retention")
  })

  it("uses chunk calls plus a video-wide synthesis for long transcripts", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    process.env.OPENAI_PACING_MODEL = "test-gpt"
    process.env.OPENAI_PACING_MAX_WINDOWS_PER_CALL = "1"

    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body as string)
      const schemaName = request.text.format.name
      const input = JSON.parse(request.input[1].content[0].text)
      let output: unknown

      if (schemaName === "youtube_pacing_analysis_chunk") {
        const windowIndex = input.chunk.windows[0].windowIndex
        output = {
          summary: `Chunk ${windowIndex}`,
          patterns: [`Pattern ${windowIndex}`],
          notableTransitions: [],
          slowOrRepetitiveStretches: [],
          windows: [
            {
              windowIndex,
              role: windowIndex === 0 ? "Hook" : "Explanation",
              pace: "moderate",
              informationDensity: "moderate",
              progression: "steady",
              pacingChange: "stable",
              evidence: [`Evidence ${windowIndex}`],
              possibleIssue: null,
              confidence: 0.8,
            },
          ],
        }
      } else {
        expect(schemaName).toBe("youtube_pacing_analysis_global")
        expect(input.chunks).toHaveLength(2)
        output = {
          overallPacing: "Consistent across the full video.",
          videoWidePatterns: ["The two chunks maintain a steady rhythm."],
          notableTransitions: [],
          slowOrRepetitiveStretches: [],
        }
      }

      return new Response(
        JSON.stringify({
          output: [
            { content: [{ type: "output_text", text: JSON.stringify(output) }] },
          ],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await generatePacingAnalysis(
      { title: "Long test", durationSeconds: 70 },
      [
        { startSeconds: 0, endSeconds: 10, text: "opening words" },
        { startSeconds: 35, endSeconds: 45, text: "later words" },
      ],
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      overallPacing: "Consistent across the full video.",
      windows: [
        { id: "hook", role: "Hook" },
        { id: "minute-1", role: "Explanation" },
      ],
    })
  })
})
