// Generates the AI layer of a video analysis: a hook score, a per-drop
// hypothesis for why viewers left, and an overall summary. Grounded in the
// transcript spoken around each moment and — when available — the actual frames
// on screen there, so explanations sit next to real evidence rather than vibes.
//
// Gated on ANTHROPIC_API_KEY: with no key configured, generateVideoInsights
// returns null and the rest of the app behaves exactly as before.

import Anthropic from "@anthropic-ai/sdk"

import {
  computeHookStats,
  detectSignificantDropOffs,
  transcriptForSegment,
  type RetentionPoint,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"
import { getVideoFrames, type VideoFrame } from "@/lib/youtube/storyboard"

const MODEL = "claude-opus-4-8"

// The AI's read on a single significant drop-off.
export interface DropInsight {
  fromTimestampSeconds: number
  toTimestampSeconds: number
  // Absolute share of viewers lost across the segment.
  watchRatioDrop: number
  // YouTube's relative-to-similar-videos performance here, when available.
  relativePerformance: number | null
  // Whether a frame for this moment was supplied to the model.
  hasFrame: boolean
  // The model's best guess at why viewers left — framed as a hypothesis.
  hypothesis: string
  // A concrete, actionable fix.
  suggestion: string
}

// The AI's read on the opening of the video.
export interface HookInsight {
  // 0-100, higher is a stronger hook.
  score: number
  // One short line — the headline verdict.
  verdict: string
  // A paragraph explaining the score and what's working / not.
  analysis: string
}

// The full AI insight payload persisted alongside an analysis.
export interface VideoInsights {
  generatedAt: string
  model: string
  // Whether on-screen frames were available to ground the analysis.
  usedFrames: boolean
  // 2-4 sentence narrative tying the whole picture together.
  summary: string
  hook: HookInsight
  drops: DropInsight[]
}

// The JSON shape we ask the model to return. Structured outputs guarantee it
// validates, so parsing is safe.
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    hook: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer" },
        verdict: { type: "string" },
        analysis: { type: "string" },
      },
      required: ["score", "verdict", "analysis"],
    },
    drops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer" },
          hypothesis: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["index", "hypothesis", "suggestion"],
      },
    },
  },
  required: ["summary", "hook", "drops"],
} as const

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}

const SYSTEM_PROMPT = `You are a YouTube retention analyst helping a creator understand why viewers leave their videos. You are given a video's title, its audience-retention summary, the transcript spoken around key moments, and — when available — the actual frames shown on screen at those moments.

Be specific, practical, and honest. Ground every claim in the evidence provided (what was said, what was shown, how steep the drop was, how it compares to similar videos). Frame each drop explanation as a hypothesis, not a certainty — viewers often decide to leave slightly before they click away, and a single moment rarely tells the whole story. Never invent details that aren't supported by the transcript or frames. Prefer concrete, do-this-next suggestions over generic advice. Keep each field tight: hypotheses and suggestions are 1-2 sentences; the summary is 2-4 sentences.`

// Builds the user-message content blocks: a text brief plus one image block per
// available frame, each labelled with its timestamp and which moment it shows.
function buildContent(
  video: VideoDetails,
  hookStats: ReturnType<typeof computeHookStats>,
  drops: ReturnType<typeof detectSignificantDropOffs>,
  transcript: TranscriptCue[],
  frames: VideoFrame[],
): Anthropic.MessageParam["content"] {
  const framesByTime = new Map(frames.map((f) => [Math.round(f.timestampSeconds), f]))

  const hookTranscript = transcriptForSegment(
    transcript,
    0,
    hookStats?.windowSeconds ?? 30,
  )

  const dropLines = drops
    .map((drop, i) => {
      const text = transcriptForSegment(
        transcript,
        drop.fromTimestampSeconds,
        drop.toTimestampSeconds,
      )
      const rel =
        drop.relativePerformance != null
          ? `${Math.round(drop.relativePerformance * 100)}% vs. similar videos`
          : "no relative data"
      return [
        `Drop #${i} — ${formatTimestamp(drop.fromTimestampSeconds)} to ${formatTimestamp(drop.toTimestampSeconds)}`,
        `  Lost ${(drop.watchRatioDrop * 100).toFixed(1)}% of viewers (${drop.steepness.toFixed(1)}x the typical decline; ${rel}).`,
        `  Said here: ${text ? `"${text}"` : "(no transcript for this moment)"}`,
      ].join("\n")
    })
    .join("\n\n")

  const hookSummary = hookStats
    ? `Retention fell from ${Math.round(hookStats.startWatchRatio * 100)}% to ${Math.round(hookStats.endWatchRatio * 100)}% across the first ${Math.round(hookStats.windowSeconds)}s (lost ${(hookStats.drop * 100).toFixed(1)}%).${
        hookStats.relativePerformance != null
          ? ` Relative performance over the hook: ${Math.round(hookStats.relativePerformance * 100)}% vs. similar videos.`
          : ""
      }`
    : "No hook data available."

  const brief = `Video title: "${video.title}"
Duration: ${formatTimestamp(video.durationSeconds)}

HOOK (first ${Math.round(hookStats?.windowSeconds ?? 30)}s):
${hookSummary}
Said in the hook: ${hookTranscript ? `"${hookTranscript}"` : "(no transcript)"}

SIGNIFICANT DROP-OFFS (steeper than this video's normal decline, or underperforming similar videos):
${drops.length > 0 ? dropLines : "None detected — retention declined fairly evenly."}

${frames.length > 0 ? "Frames captured at these moments are attached below, each labelled with its timestamp." : "No on-screen frames were available for this video."}

Return:
- summary: 2-4 sentences on the overall retention story and the single highest-leverage fix.
- hook: a score 0-100, a one-line verdict, and an analysis paragraph. Judge whether the opening delivers on the title's promise and gets to value fast.
- drops: for EACH drop above (by its index), a hypothesis for why viewers left and a concrete suggestion. Return an empty array if there were no drops.`

  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: brief }]

  // Attach frames after the brief, labelled so the model can tie each to a moment.
  for (let i = 0; i < drops.length; i++) {
    const frame = framesByTime.get(Math.round(drops[i].fromTimestampSeconds))
    if (!frame) continue
    content.push({
      type: "text",
      text: `Frame at ${formatTimestamp(drops[i].fromTimestampSeconds)} (Drop #${i}):`,
    })
    content.push({
      type: "image",
      source: { type: "base64", media_type: frame.mediaType, data: frame.base64 },
    })
  }

  // A hook frame, if we grabbed one.
  const hookFrame = frames.find(
    (f) => !drops.some((d) => Math.round(d.fromTimestampSeconds) === Math.round(f.timestampSeconds)),
  )
  if (hookFrame) {
    content.push({
      type: "text",
      text: `Frame from the hook at ${formatTimestamp(hookFrame.timestampSeconds)}:`,
    })
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: hookFrame.mediaType,
        data: hookFrame.base64,
      },
    })
  }

  return content
}

export interface GenerateInsightsInput {
  videoId: string
  video: VideoDetails
  retention: RetentionPoint[]
  transcript: TranscriptCue[]
}

// Runs the full insight pipeline: compute the moments that matter, best-effort
// fetch the frames around them, then ask Claude to explain them. Returns null
// when no API key is configured. Throws on an actual API failure so the caller
// can surface it.
export async function generateVideoInsights(
  input: GenerateInsightsInput,
): Promise<VideoInsights | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  const { video, retention, transcript } = input

  const hookStats = computeHookStats(retention, video.durationSeconds)
  const drops = detectSignificantDropOffs(retention)

  // Frames to grab: one per drop, plus a couple in the hook window. Best-effort.
  const hookWindow = hookStats?.windowSeconds ?? 30
  const frameTimestamps = [
    ...drops.map((d) => d.fromTimestampSeconds),
    Math.min(3, hookWindow),
    Math.max(0, hookWindow - 5),
  ]
  let frames: VideoFrame[] = []
  try {
    frames = await getVideoFrames(input.videoId, frameTimestamps)
  } catch (error) {
    console.error("Frame extraction failed; continuing without frames", error)
  }

  const client = new Anthropic()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildContent(video, hookStats, drops, transcript, frames),
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI insight response contained no text")
  }

  const parsed = JSON.parse(textBlock.text) as {
    summary: string
    hook: { score: number; verdict: string; analysis: string }
    drops: Array<{ index: number; hypothesis: string; suggestion: string }>
  }

  const byIndex = new Map(parsed.drops.map((d) => [d.index, d]))
  const frameTimes = new Set(frames.map((f) => Math.round(f.timestampSeconds)))

  const dropInsights: DropInsight[] = drops.map((drop, i) => {
    const ai = byIndex.get(i)
    return {
      fromTimestampSeconds: drop.fromTimestampSeconds,
      toTimestampSeconds: drop.toTimestampSeconds,
      watchRatioDrop: drop.watchRatioDrop,
      relativePerformance: drop.relativePerformance,
      hasFrame: frameTimes.has(Math.round(drop.fromTimestampSeconds)),
      hypothesis: ai?.hypothesis ?? "",
      suggestion: ai?.suggestion ?? "",
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    usedFrames: frames.length > 0,
    summary: parsed.summary,
    hook: {
      score: Math.max(0, Math.min(100, Math.round(parsed.hook.score))),
      verdict: parsed.hook.verdict,
      analysis: parsed.hook.analysis,
    },
    drops: dropInsights,
  }
}
