// Transcribing the spoken opening of a plan's footage.
//
// A published video hands the packaging read its hook for free: YouTube has
// captions, and lib/packaging-alignment.ts slices the first thirty seconds out
// of them. A plan has no captions, because nobody has published anything, so
// the hook has to come out of the footage itself.
//
// The route is the same one the deep analysis already uses for its per-window
// audio: ffmpeg reads the opening seconds straight off a signed read URL
// (range requests, so a 30 GB master is never downloaded), and the resulting
// clip goes to OpenAI's transcription endpoint. Thirty seconds of mp3 is a
// couple of hundred kilobytes, so this is a cheap call on a small payload
// rather than anything that needs a worker behind it.

import { extractAudioSegment } from "@/lib/media/video-extraction"
import { PLAN_HOOK_WINDOW_SECONDS } from "@/lib/video-plans/config"

// The transcription model. Kept overridable because this is the one call in the
// planner whose model has no counterpart elsewhere in the app to inherit from.
function transcriptionModel(): string {
  return process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe"
}

// Pulls the first PLAN_HOOK_WINDOW_SECONDS of audio out of the footage and
// transcribes it.
//
// Returns "" rather than throwing when the opening simply has no speech in it
// (a cold open over music, a title card): that is a real and legitimate hook,
// and the packaging prompt is written to read the title and thumbnail alone
// when the transcript is empty. A genuine failure - ffmpeg cannot decode the
// file, the transcription call errors - does throw, because that is a plan we
// could not read rather than a hook with nothing said in it.
export async function transcribeHook(
  sourceUrl: string,
  windowSeconds: number = PLAN_HOOK_WINDOW_SECONDS,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const audio = await extractAudioSegment(sourceUrl, 0, windowSeconds)
  // ffmpeg produced a container with nothing in it: there was no audio track to
  // read at all. Nothing was said, so there is nothing to transcribe.
  if (audio.byteLength === 0) return ""

  const form = new FormData()
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }),
    "hook.mp3",
  )
  form.append("model", transcriptionModel())
  // Plain text back: the packaging read wants the words, and has no use for
  // per-segment timings inside a window this short.
  form.append("response_format", "text")

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
      `OpenAI hook transcription failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  return (await response.text()).trim()
}
