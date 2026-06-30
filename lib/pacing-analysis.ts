import type { TranscriptCue, VideoDetails } from "@/lib/youtube/youtube"

export type PacingRate =
  | "very_slow"
  | "slow"
  | "moderate"
  | "fast"
  | "very_fast"
export type InformationDensity = "low" | "moderate" | "high"
export type NarrativeProgression = "stalled" | "limited" | "steady" | "strong"
export type PacingChange = "decelerating" | "stable" | "accelerating" | "mixed"

export interface PacingWindow {
  id: string
  label: string
  kind: "hook" | "minute"
  startSeconds: number
  endSeconds: number
  wordCount: number
  wordsPerMinute: number
  role: string
  pace: PacingRate
  informationDensity: InformationDensity
  progression: NarrativeProgression
  pacingChange: PacingChange
  evidence: string[]
  possibleIssue: string | null
  confidence: number
}

export interface PacingAnalysis {
  overallPacing: string
  videoWidePatterns: string[]
  notableTransitions: Array<{
    atSeconds: number
    description: string
  }>
  slowOrRepetitiveStretches: Array<{
    startSeconds: number
    endSeconds: number
    reason: string
  }>
  windows: PacingWindow[]
  model: string
  generatedAt: string
}

interface PreparedWindow {
  id: string
  label: string
  kind: "hook" | "minute"
  startSeconds: number
  endSeconds: number
  wordCount: number
  wordsPerMinute: number
  transcript: TranscriptCue[]
}

interface ModelWindow {
  windowIndex: number
  role: string
  pace: PacingRate
  informationDensity: InformationDensity
  progression: NarrativeProgression
  pacingChange: PacingChange
  evidence: string[]
  possibleIssue: string | null
  confidence: number
}

interface ModelOutput {
  overallPacing: string
  videoWidePatterns: string[]
  notableTransitions: Array<{
    atSeconds: number
    description: string
  }>
  slowOrRepetitiveStretches: Array<{
    startSeconds: number
    endSeconds: number
    reason: string
  }>
  windows: ModelWindow[]
}

interface ChunkModelOutput {
  summary: string
  patterns: string[]
  notableTransitions: ModelOutput["notableTransitions"]
  slowOrRepetitiveStretches: ModelOutput["slowOrRepetitiveStretches"]
  windows: ModelWindow[]
}

type GlobalModelOutput = Omit<ModelOutput, "windows">

interface AnalysedChunk {
  startWindowIndex: number
  endWindowIndex: number
  output: ChunkModelOutput
}

const DEFAULT_MAX_WINDOWS_PER_CALL = 40
const DEFAULT_MAX_TRANSCRIPT_CHARS_PER_CALL = 120_000
const DEFAULT_MAX_PARALLEL_CHUNKS = 3

const PACING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overallPacing",
    "videoWidePatterns",
    "notableTransitions",
    "slowOrRepetitiveStretches",
    "windows",
  ],
  properties: {
    overallPacing: { type: "string" },
    videoWidePatterns: { type: "array", items: { type: "string" } },
    notableTransitions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["atSeconds", "description"],
        properties: {
          atSeconds: { type: "number" },
          description: { type: "string" },
        },
      },
    },
    slowOrRepetitiveStretches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["startSeconds", "endSeconds", "reason"],
        properties: {
          startSeconds: { type: "number" },
          endSeconds: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
    windows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "windowIndex",
          "role",
          "pace",
          "informationDensity",
          "progression",
          "pacingChange",
          "evidence",
          "possibleIssue",
          "confidence",
        ],
        properties: {
          windowIndex: { type: "integer" },
          role: { type: "string" },
          pace: {
            type: "string",
            enum: ["very_slow", "slow", "moderate", "fast", "very_fast"],
          },
          informationDensity: {
            type: "string",
            enum: ["low", "moderate", "high"],
          },
          progression: {
            type: "string",
            enum: ["stalled", "limited", "steady", "strong"],
          },
          pacingChange: {
            type: "string",
            enum: ["decelerating", "stable", "accelerating", "mixed"],
          },
          evidence: {
            type: "array",
            items: { type: "string" },
          },
          possibleIssue: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

const MODEL_WINDOW_SCHEMA = PACING_SCHEMA.properties.windows.items

const CHUNK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "patterns",
    "notableTransitions",
    "slowOrRepetitiveStretches",
    "windows",
  ],
  properties: {
    summary: { type: "string" },
    patterns: { type: "array", items: { type: "string" } },
    notableTransitions: PACING_SCHEMA.properties.notableTransitions,
    slowOrRepetitiveStretches:
      PACING_SCHEMA.properties.slowOrRepetitiveStretches,
    windows: { type: "array", items: MODEL_WINDOW_SCHEMA },
  },
} as const

const GLOBAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overallPacing",
    "videoWidePatterns",
    "notableTransitions",
    "slowOrRepetitiveStretches",
  ],
  properties: {
    overallPacing: PACING_SCHEMA.properties.overallPacing,
    videoWidePatterns: PACING_SCHEMA.properties.videoWidePatterns,
    notableTransitions: PACING_SCHEMA.properties.notableTransitions,
    slowOrRepetitiveStretches:
      PACING_SCHEMA.properties.slowOrRepetitiveStretches,
  },
} as const

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function transcriptInWindow(
  transcript: TranscriptCue[],
  startSeconds: number,
  endSeconds: number,
): TranscriptCue[] {
  return transcript
    .filter((cue) => {
      // Assign each cue to exactly one window by its midpoint. Caption cues are
      // short, and this avoids duplicating words when a cue crosses a boundary.
      const midpoint = (cue.startSeconds + cue.endSeconds) / 2
      return midpoint >= startSeconds && midpoint < endSeconds
    })
    .map((cue) => ({ ...cue, text: cue.text.trim() }))
    .filter((cue) => Boolean(cue.text))
}

export function buildPacingWindows(
  durationSeconds: number,
  transcript: TranscriptCue[],
): PreparedWindow[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return []

  const boundaries: Array<{
    startSeconds: number
    endSeconds: number
    kind: "hook" | "minute"
  }> = [
    {
      startSeconds: 0,
      endSeconds: Math.min(30, durationSeconds),
      kind: "hook",
    },
  ]

  for (let startSeconds = 30; startSeconds < durationSeconds; startSeconds += 60) {
    boundaries.push({
      startSeconds,
      endSeconds: Math.min(startSeconds + 60, durationSeconds),
      kind: "minute",
    })
  }

  return boundaries.map((boundary, index) => {
    const windowTranscript = transcriptInWindow(
      transcript,
      boundary.startSeconds,
      boundary.endSeconds,
    )
    const text = windowTranscript.map((cue) => cue.text).join(" ")
    const wordCount = countWords(text)
    const windowDuration = boundary.endSeconds - boundary.startSeconds

    return {
      id: boundary.kind === "hook" ? "hook" : `minute-${index}`,
      label: boundary.kind === "hook" ? "Hook" : `Window ${index + 1}`,
      ...boundary,
      wordCount,
      wordsPerMinute:
        windowDuration > 0 ? Math.round((wordCount / windowDuration) * 60) : 0,
      transcript: windowTranscript,
    }
  })
}

function extractOutputText(response: {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
}): string | null {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text
    }
  }
  return null
}

function isModelOutput(value: unknown): value is ModelOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ModelOutput>
  return (
    typeof candidate.overallPacing === "string" &&
    Array.isArray(candidate.videoWidePatterns) &&
    Array.isArray(candidate.notableTransitions) &&
    Array.isArray(candidate.slowOrRepetitiveStretches) &&
    Array.isArray(candidate.windows)
  )
}

function isChunkModelOutput(value: unknown): value is ChunkModelOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ChunkModelOutput>
  return (
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.patterns) &&
    Array.isArray(candidate.notableTransitions) &&
    Array.isArray(candidate.slowOrRepetitiveStretches) &&
    Array.isArray(candidate.windows)
  )
}

function isGlobalModelOutput(value: unknown): value is GlobalModelOutput {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<GlobalModelOutput>
  return (
    typeof candidate.overallPacing === "string" &&
    Array.isArray(candidate.videoWidePatterns) &&
    Array.isArray(candidate.notableTransitions) &&
    Array.isArray(candidate.slowOrRepetitiveStretches)
  )
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function transcriptCharacterCount(window: PreparedWindow): number {
  return window.transcript.reduce((total, cue) => total + cue.text.length, 0)
}

export function chunkPacingWindows(
  windows: PreparedWindow[],
  options: { maxWindows: number; maxTranscriptCharacters: number },
): PreparedWindow[][] {
  const chunks: PreparedWindow[][] = []
  let chunk: PreparedWindow[] = []
  let characters = 0

  for (const window of windows) {
    const windowCharacters = transcriptCharacterCount(window)
    if (
      chunk.length > 0 &&
      (chunk.length >= options.maxWindows ||
        characters + windowCharacters > options.maxTranscriptCharacters)
    ) {
      chunks.push(chunk)
      chunk = []
      characters = 0
    }
    chunk.push(window)
    characters += windowCharacters
  }

  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

function serialiseWindows(windows: PreparedWindow[], offset = 0) {
  return windows.map((window, index) => ({
    windowIndex: offset + index,
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
    wordCount: window.wordCount,
    wordsPerMinute: window.wordsPerMinute,
    transcript: window.transcript,
  }))
}

async function requestStructuredOutput<T>({
  apiKey,
  model,
  developerPrompt,
  input,
  schemaName,
  schema,
  maxOutputTokens,
  validate,
}: {
  apiKey: string
  model: string
  developerPrompt: string
  input: unknown
  schemaName: string
  schema: object
  maxOutputTokens: number
  validate: (value: unknown) => value is T
}): Promise<T> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: developerPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(input) }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI pacing analysis failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  }
  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no pacing analysis text")

  const parsed: unknown = JSON.parse(outputText)
  if (!validate(parsed)) {
    throw new Error("OpenAI returned an invalid pacing analysis")
  }
  return parsed
}

const WINDOW_ANALYSIS_PROMPT = [
  "You analyse narrative pacing in YouTube transcripts.",
  "Judge each supplied window relative to this video's own rhythm, not an imagined universal ideal.",
  "Use only transcript content and the supplied word metrics. Do not infer editing, visuals, music, vocal energy, audience retention, or causal effects.",
  "Narrative pacing includes novelty, information density, progression, repetition, topic movement, setup/payoff, questions, and open loops.",
  "The first 30-second window is the hook. Every later window is 60 seconds except a shorter final window.",
  "Return exactly one windows entry for every supplied window, using its supplied zero-based windowIndex.",
  "Keep evidence specific and concise. Set possibleIssue to null when there is no meaningful issue.",
].join(" ")

function validateEveryWindow(
  modelWindows: ModelWindow[],
  expectedIndexes: number[],
): void {
  const actualIndexes = modelWindows.map((window) => window.windowIndex)
  if (
    actualIndexes.length !== expectedIndexes.length ||
    new Set(actualIndexes).size !== expectedIndexes.length ||
    expectedIndexes.some((index) => !actualIndexes.includes(index))
  ) {
    throw new Error("OpenAI did not analyse every pacing window")
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++
        results[index] = await mapper(values[index], index)
      }
    },
  )
  await Promise.all(workers)
  return results
}

export async function generatePacingAnalysis(
  video: Pick<VideoDetails, "title" | "durationSeconds">,
  transcript: TranscriptCue[],
): Promise<PacingAnalysis | null> {
  const windows = buildPacingWindows(video.durationSeconds, transcript)
  if (
    windows.length === 0 ||
    windows.every((window) => window.transcript.length === 0)
  ) {
    return null
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model = process.env.OPENAI_PACING_MODEL ?? "gpt-5.4-mini"
  const maxWindows = positiveInteger(
    process.env.OPENAI_PACING_MAX_WINDOWS_PER_CALL,
    DEFAULT_MAX_WINDOWS_PER_CALL,
  )
  const maxTranscriptCharacters = positiveInteger(
    process.env.OPENAI_PACING_MAX_TRANSCRIPT_CHARS_PER_CALL,
    DEFAULT_MAX_TRANSCRIPT_CHARS_PER_CALL,
  )
  const maxParallelChunks = positiveInteger(
    process.env.OPENAI_PACING_MAX_PARALLEL_CHUNKS,
    DEFAULT_MAX_PARALLEL_CHUNKS,
  )
  const windowChunks = chunkPacingWindows(windows, {
    maxWindows,
    maxTranscriptCharacters,
  })

  let parsed: ModelOutput
  if (windowChunks.length === 1) {
    parsed = await requestStructuredOutput({
      apiKey,
      model,
      developerPrompt: WINDOW_ANALYSIS_PROMPT,
      input: {
        video: { title: video.title, durationSeconds: video.durationSeconds },
        windows: serialiseWindows(windows),
      },
      schemaName: "youtube_pacing_analysis",
      schema: PACING_SCHEMA,
      maxOutputTokens: Math.min(
        32_000,
        Math.max(4_000, windows.length * 450),
      ),
      validate: isModelOutput,
    })
    validateEveryWindow(
      parsed.windows,
      windows.map((_, index) => index),
    )
  } else {
    const averageWordsPerMinute = Math.round(
      windows.reduce((sum, window) => sum + window.wordsPerMinute, 0) /
        windows.length,
    )
    let nextChunkOffset = 0
    const chunkOffsets = windowChunks.map((chunk) => {
      const offset = nextChunkOffset
      nextChunkOffset += chunk.length
      return offset
    })

    // Bounded concurrency prevents a very long video from turning into a long
    // serial request while still keeping API bursts modest. The synthesis runs
    // only after every chunk has completed.
    const analysedChunks = await mapWithConcurrency(
      windowChunks,
      maxParallelChunks,
      async (chunk, chunkIndex): Promise<AnalysedChunk> => {
        const startWindowIndex = chunkOffsets[chunkIndex]
        const endWindowIndex = startWindowIndex + chunk.length - 1
        const output = await requestStructuredOutput({
          apiKey,
          model,
          developerPrompt: [
            WINDOW_ANALYSIS_PROMPT,
            "This is one contiguous chunk of an exceptionally long video.",
            "Also return a concise chunk summary, patterns, transitions, and slow stretches for later video-wide synthesis.",
          ].join(" "),
          input: {
            video: {
              title: video.title,
              durationSeconds: video.durationSeconds,
              totalWindows: windows.length,
              averageWordsPerMinute,
            },
            chunk: {
              startWindowIndex,
              endWindowIndex,
              windows: serialiseWindows(chunk, startWindowIndex),
            },
          },
          schemaName: "youtube_pacing_analysis_chunk",
          schema: CHUNK_SCHEMA,
          maxOutputTokens: Math.min(
            32_000,
            Math.max(4_000, chunk.length * 450 + 1_500),
          ),
          validate: isChunkModelOutput,
        })
        validateEveryWindow(
          output.windows,
          chunk.map((_, index) => startWindowIndex + index),
        )
        return { startWindowIndex, endWindowIndex, output }
      },
    )

    const global = await requestStructuredOutput({
      apiKey,
      model,
      developerPrompt: [
        "Synthesize a video-wide narrative pacing assessment from contiguous chunk analyses.",
        "Compare the chunks against the rhythm of the whole video.",
        "Do not invent transcript evidence or infer editing, visuals, music, vocal energy, audience retention, or causal effects.",
        "Merge overlapping findings and keep timestamps within the supplied video duration.",
      ].join(" "),
      input: {
        video: {
          title: video.title,
          durationSeconds: video.durationSeconds,
          totalWindows: windows.length,
          averageWordsPerMinute,
        },
        chunks: analysedChunks.map((chunk) => ({
          startWindowIndex: chunk.startWindowIndex,
          endWindowIndex: chunk.endWindowIndex,
          startSeconds: windows[chunk.startWindowIndex].startSeconds,
          endSeconds: windows[chunk.endWindowIndex].endSeconds,
          summary: chunk.output.summary,
          patterns: chunk.output.patterns,
          notableTransitions: chunk.output.notableTransitions,
          slowOrRepetitiveStretches: chunk.output.slowOrRepetitiveStretches,
        })),
      },
      schemaName: "youtube_pacing_analysis_global",
      schema: GLOBAL_SCHEMA,
      maxOutputTokens: 6_000,
      validate: isGlobalModelOutput,
    })

    parsed = {
      ...global,
      windows: analysedChunks.flatMap((chunk) => chunk.output.windows),
    }
  }

  const modelWindows = new Map(
    parsed.windows.map((window) => [window.windowIndex, window]),
  )

  return {
    overallPacing: parsed.overallPacing,
    videoWidePatterns: parsed.videoWidePatterns,
    notableTransitions: parsed.notableTransitions,
    slowOrRepetitiveStretches: parsed.slowOrRepetitiveStretches,
    windows: windows.map((window, index) => {
      const analysis = modelWindows.get(index)
      if (!analysis) throw new Error(`Missing pacing window ${index}`)
      return {
        id: window.id,
        label: window.label,
        kind: window.kind,
        startSeconds: window.startSeconds,
        endSeconds: window.endSeconds,
        wordCount: window.wordCount,
        wordsPerMinute: window.wordsPerMinute,
        role: analysis.role,
        pace: analysis.pace,
        informationDensity: analysis.informationDensity,
        progression: analysis.progression,
        pacingChange: analysis.pacingChange,
        evidence: analysis.evidence,
        possibleIssue: analysis.possibleIssue,
        confidence: Math.min(1, Math.max(0, analysis.confidence)),
      }
    }),
    model,
    generatedAt: new Date().toISOString(),
  }
}
