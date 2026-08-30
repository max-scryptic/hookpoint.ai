// Transcribing a plan's footage into the same timestamped cues a published
// video gets from YouTube's caption track.
//
// A published video hands the analysis its transcript for free. A plan has no
// captions, because nobody has published anything, so the words have to come
// out of the footage: ffmpeg reads the audio off a signed read URL (range
// requests, so a 30 GB master is never downloaded) and OpenAI transcribes it.
//
// WHY THE WHOLE VIDEO, WHEN PACKAGING ONLY READS THIRTY SECONDS
//
// Because the transcript is the input to everything else the planner will do.
// Retention prediction reads the script window by window (lib/pacing-analysis,
// lib/retention-attribution, lib/script-taxonomy), and all three take
// TranscriptCue[] over the full runtime. Transcribing the opening alone would
// buy a hook now and a full re-transcribe later, for a saving of a few pence.
//
// WHY whisper-1 AND NOT gpt-4o-transcribe
//
// Timestamps. The gpt-4o transcription models answer in json or plain text
// only; verbose_json, and with it the per-segment start/end times, is
// whisper-1's alone. Cues without times cannot be matched to a retention
// window, which is the entire job here. gpt-4o-mini-transcribe is half the
// price and it does not matter: at $0.006/min a 20-minute video costs about a
// penny, against dollars for the vision passes over the same footage.

import {
  extractAudioSegment,
  measureMediaDuration,
} from "@/lib/media/video-extraction"
import { recordTranscriptionCall, type LlmLogContext } from "@/lib/llm-calls"
import { transcriptionCostUsd } from "@/lib/transcription-cost"
import type { TranscriptCue } from "@/lib/youtube/youtube"

// How much audio goes in one request. OpenAI caps an upload at 25 MB, and
// extractAudioSegment writes 128 kbps mp3, so ten minutes is a little under
// 10 MB: comfortably inside the cap with room for a container that encodes
// fatter than expected, and short enough that one failed chunk is a cheap
// retry rather than a lost hour.
const CHUNK_SECONDS = 10 * 60

// How many chunks are transcribed at once. Each one is an ffmpeg decode plus an
// upload, so a little concurrency turns a long video from minutes into tens of
// seconds; too much and the ffmpeg processes contend for the same function's
// CPU and memory.
const CHUNK_CONCURRENCY = 3

// The ceiling on how much footage is transcribed, as a backstop for a duration
// we could not read. Four hours is far beyond anything the planner is for, so
// reaching it means something is wrong rather than that a creator has a long
// video.
const MAX_TRANSCRIBED_SECONDS = 4 * 60 * 60

// The transcription model. Overridable, but see the note above before moving it
// off whisper-1: a model without verbose_json returns no timestamps, and every
// consumer of these cues is keyed on time.
function transcriptionModel(): string {
  return process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1"
}

interface WhisperSegment {
  start: number
  end: number
  text: string
}

// The chunk boundaries covering `durationSeconds`, as [from, to) pairs.
// Exported for testing: getting the last chunk's end wrong is how you silently
// lose the end of a video.
export function planTranscriptChunks(
  durationSeconds: number,
  chunkSeconds: number = CHUNK_SECONDS,
): { fromSeconds: number; toSeconds: number }[] {
  const total = Math.min(durationSeconds, MAX_TRANSCRIBED_SECONDS)
  if (!Number.isFinite(total) || total <= 0) return []

  const chunks: { fromSeconds: number; toSeconds: number }[] = []
  for (let from = 0; from < total; from += chunkSeconds) {
    chunks.push({
      fromSeconds: from,
      toSeconds: Math.min(from + chunkSeconds, total),
    })
  }
  return chunks
}

// Shifts one chunk's cues into whole-video time and drops the empty ones.
// Whisper reports times relative to the clip it was given, so without this
// every chunk after the first would claim to start at zero.
export function offsetCues(
  segments: WhisperSegment[],
  offsetSeconds: number,
): TranscriptCue[] {
  return segments
    .map((segment) => ({
      startSeconds: segment.start + offsetSeconds,
      endSeconds: segment.end + offsetSeconds,
      text: segment.text.trim(),
    }))
    .filter((cue) => cue.text.length > 0)
}

// Transcribes one already-extracted clip. Returns its segments in clip-relative
// time; the caller offsets them.
async function transcribeClip(
  audio: Buffer,
  apiKey: string,
  model: string,
): Promise<WhisperSegment[]> {
  const form = new FormData()
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }),
    "chunk.mp3",
  )
  form.append("model", model)
  // The whole reason for whisper-1: per-segment start/end times.
  form.append("response_format", "verbose_json")
  form.append("timestamp_granularities[]", "segment")

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      cache: "no-store",
    },
  )

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI transcription failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    segments?: unknown
    text?: unknown
  }

  if (!Array.isArray(json.segments)) {
    // A clip with no speech in it comes back with no segments. That is a real
    // answer (a cold open over music), not a failure.
    return []
  }

  return json.segments.filter(
    (segment): segment is WhisperSegment =>
      typeof segment === "object" &&
      segment !== null &&
      typeof (segment as WhisperSegment).start === "number" &&
      typeof (segment as WhisperSegment).end === "number" &&
      typeof (segment as WhisperSegment).text === "string",
  )
}

export interface TranscribeFootageResult {
  cues: TranscriptCue[]
  // The runtime the transcript covers, which the caller stores so a later pass
  // knows whether it has the whole video or only what we could read.
  durationSeconds: number | null
}

// Transcribes the whole of a plan's footage into timestamped cues.
//
// An empty cue list is a legitimate outcome: footage with no speech in it (a
// silent montage, music over b-roll) genuinely has nothing to transcribe, and
// the packaging prompt is written to fall back to the title and thumbnail. A
// failure to read or transcribe the audio throws instead, because that is a
// plan we could not read rather than a video with nothing said in it.
export async function transcribeFootage(
  sourceUrl: string,
  options: { durationSeconds?: number | null; logContext?: LlmLogContext } = {},
): Promise<TranscribeFootageResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  // The browser measures the duration when the file is picked, but it cannot
  // read every container (.mkv in particular), so fall back to asking ffmpeg.
  const duration =
    options.durationSeconds && options.durationSeconds > 0
      ? options.durationSeconds
      : await measureMediaDuration(sourceUrl)

  if (!duration) {
    throw new Error("Could not read the footage's duration")
  }

  const chunks = planTranscriptChunks(duration)
  const model = transcriptionModel()
  const cuesByChunk = new Array<TranscriptCue[]>(chunks.length)

  // Index-based work queue, the same shape as the browser's multipart upload:
  // incrementing is atomic in JS's single-threaded model, so no two workers
  // take the same chunk, and results land by index so order survives the
  // out-of-order completion.
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++
      if (index >= chunks.length) return

      const chunk = chunks[index]
      const audio = await extractAudioSegment(
        sourceUrl,
        chunk.fromSeconds,
        chunk.toSeconds,
      )
      if (audio.byteLength === 0) {
        // ffmpeg found nothing to encode here: no audio track, or a chunk past
        // the real end of a container whose header overstated its duration.
        cuesByChunk[index] = []
        continue
      }

      const segments = await transcribeClip(audio, apiKey, model)
      cuesByChunk[index] = offsetCues(segments, chunk.fromSeconds)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, () =>
      worker(),
    ),
  )

  if (options.logContext) {
    // Billed per minute of audio, so the cost is the runtime we sent - there
    // are no tokens to count. Best-effort, like every other cost write: an
    // accounting hiccup must not cost the creator their transcript.
    await recordTranscriptionCall(
      transcriptionCostUsd(duration, model),
      model,
      options.logContext,
    ).catch((error) => {
      console.error("Failed to record transcription cost", error)
    })
  }

  return {
    cues: cuesByChunk.flat(),
    durationSeconds: duration,
  }
}
