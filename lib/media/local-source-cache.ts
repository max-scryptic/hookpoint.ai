// Downloads a source video to the function's own disk (os.tmpdir()) for the
// duration of one extraction run. Every ffmpeg invocation in a run — scene-cue
// scans, one process per thumbnail, audio clips — otherwise opens its own
// HTTPS connection and range-seeks into the signed URL; paying one download
// up front turns all of those into local reads, which is dramatically cheaper
// for the dozens of invocations a multi-window run makes.
//
// Strictly best-effort: any failure (or a source bigger than the disk budget)
// returns null and the caller streams from the signed URL exactly as before.
// A serverless /tmp is small (512MB on Vercel by default) and shared across
// warm invocations, so the size cap is enforced both against the size we know
// up front and while streaming, and the file is always deleted at the end of
// the run that created it.

import { createWriteStream } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as WebReadableStream } from "node:stream/web"

export interface LocalSourceHandle {
  // Local filesystem path ffmpeg can read instead of the remote URL.
  path: string
  // Removes the cached file. Never throws.
  cleanup(): Promise<void>
}

export async function acquireLocalSource(
  url: string,
  options: {
    // Storage-reported size when known — lets an oversized source skip the
    // download without wasting bandwidth on a doomed attempt.
    sizeHintBytes: number | null
    maxBytes: number
  },
): Promise<LocalSourceHandle | null> {
  const { sizeHintBytes, maxBytes } = options
  if (maxBytes <= 0) return null
  if (sizeHintBytes != null && sizeHintBytes > maxBytes) return null

  let dir: string | null = null
  try {
    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new Error(`Source download failed (${response.status})`)
    }

    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body.cancel().catch(() => {})
      return null
    }

    dir = await mkdtemp(path.join(os.tmpdir(), "hookpoint-source-"))
    const filePath = path.join(dir, "source.mp4")

    // Enforce the cap while streaming too: a missing/incorrect content-length
    // must not let an unexpectedly large body fill the disk.
    let receivedBytes = 0
    const capEnforcer = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length
        if (receivedBytes > maxBytes) {
          callback(new Error("Source exceeds the local cache size limit"))
          return
        }
        callback(null, chunk)
      },
    })

    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      capEnforcer,
      createWriteStream(filePath),
    )

    const cacheDir = dir
    return {
      path: filePath,
      cleanup: async () => {
        await rm(cacheDir, { recursive: true, force: true }).catch(() => {})
      },
    }
  } catch (error) {
    console.error(
      "Failed to cache source video locally; falling back to the signed URL",
      error,
    )
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
    return null
  }
}
