// Extracts a video's duration with ffprobe. We deliberately shell out to ffprobe
// rather than parse container headers ourselves — ffprobe is the source of truth
// for duration across mp4/mov/mkv/webm and handles the long tail of edge cases.
//
// ffprobe can read directly from an HTTP(S) URL, issuing range requests for just
// the metadata it needs, so for object storage we pass a short-lived signed read
// URL and avoid downloading the whole (10–30 GB) file. A local file path also
// works, which is the fallback when a provider only offers mounted/temp access.

import { spawn } from "node:child_process"

// Raised when the ffprobe binary itself can't be run (not installed / not on
// PATH). Callers should surface this as an infrastructure problem, not a bad
// upload — the file may well be fine.
export class FfprobeUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("ffprobe is not available on this host")
    this.name = "FfprobeUnavailableError"
    if (cause) this.cause = cause
  }
}

// Raised when ffprobe ran but couldn't read a duration out of the input (corrupt
// file, unreadable URL, unsupported stream). This *is* a problem with the upload.
export class FfprobeReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FfprobeReadError"
  }
}

export interface FfprobeOptions {
  // Override the binary name/path. Defaults to FFPROBE_PATH env or "ffprobe".
  ffprobePath?: string
  // Hard timeout for the probe, in ms. Defaults to 60s.
  timeoutMs?: number
}

// Runs: ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 <input>
// and returns the duration in seconds. `input` may be a local path or a URL.
export function extractDurationSeconds(
  input: string,
  options: FfprobeOptions = {},
): Promise<number> {
  const bin = options.ffprobePath || process.env.FFPROBE_PATH || "ffprobe"
  const timeoutMs = options.timeoutMs ?? 60_000

  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    input,
  ]

  return new Promise<number>((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args)
    } catch (error) {
      reject(new FfprobeUnavailableError(error))
      return
    }

    let stdout = ""
    let stderr = ""
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(new FfprobeReadError(`ffprobe timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // ENOENT => binary missing; anything else spawning is also "unavailable".
      reject(new FfprobeUnavailableError(error))
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code !== 0) {
        reject(
          new FfprobeReadError(
            `ffprobe exited with code ${code}: ${stderr.trim() || "no output"}`,
          ),
        )
        return
      }

      const seconds = Number.parseFloat(stdout.trim())
      if (!Number.isFinite(seconds) || seconds <= 0) {
        reject(
          new FfprobeReadError(
            `ffprobe returned an unreadable duration: ${JSON.stringify(stdout.trim())}`,
          ),
        )
        return
      }

      resolve(seconds)
    })
  })
}
