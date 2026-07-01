// Thin wrapper for invoking ffmpeg as a subprocess and capturing its stdout as
// a Buffer. Used to grab a single frame or an audio segment straight out of a
// video served over HTTPS (a signed read URL) — ffmpeg seeks and range-requests
// only the bytes it needs, so the source video is never downloaded in full.

import { spawn } from "node:child_process"

// Resolves the ffmpeg binary to run: an explicit override first, then the
// static binary bundled via the ffmpeg-static dependency, then plain "ffmpeg"
// on PATH (for an environment that provides its own, e.g. a base image with it
// installed). Wrapped in try/catch so an environment ffmpeg-static didn't
// publish a build for can still fall through instead of failing to import.
export function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundled = require("ffmpeg-static") as string | null
    if (bundled) return bundled
  } catch {
    // Fall through to PATH.
  }
  return "ffmpeg"
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message)
    this.name = "FfmpegError"
  }
}

// Runs ffmpeg with `args`, capturing both stdout and stderr as a Buffer/string
// pair. Rejects with the captured stderr on a non-zero exit, or if the process
// doesn't finish within `timeoutMs`. Split out from runFfmpeg below because
// some callers (e.g. the volumedetect/silencedetect audio-stats filters) only
// ever write to `pipe:1` with `-f null -`, and read their actual result off
// stderr's log lines even on a successful (code 0) exit.
export function runFfmpegCapturingOutput(
  args: string[],
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(
        new FfmpegError(
          `ffmpeg timed out after ${timeoutMs}ms`,
          Buffer.concat(stderrChunks).toString("utf8"),
        ),
      )
    }, timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))

    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new FfmpegError(`Failed to start ffmpeg: ${err.message}`, ""))
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      if (code !== 0) {
        reject(new FfmpegError(`ffmpeg exited with code ${code}`, stderr))
        return
      }
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr })
    })
  })
}

// Runs ffmpeg with `args`, capturing stdout as a single Buffer — the caller's
// args must write output to `pipe:1`. Rejects with the captured stderr on a
// non-zero exit, or if the process doesn't finish within `timeoutMs`.
export async function runFfmpeg(
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<Buffer> {
  const { stdout } = await runFfmpegCapturingOutput(args, opts)
  return stdout
}
