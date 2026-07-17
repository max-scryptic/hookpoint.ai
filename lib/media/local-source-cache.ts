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
// up front and while streaming, and the file is deleted at the end of the run
// that created it. That run-end cleanup can't be relied on alone, though: a
// run killed by the 300s function timeout is SIGKILLed before its finally
// block, leaking its cached file — so acquireLocalSource also sweeps stale
// leaked files up front (see sweepStaleLocalSources) to keep a warm instance's
// /tmp from filling up and forcing every later run onto the slow HTTPS-stream
// fallback.

import { createWriteStream } from "node:fs"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as WebReadableStream } from "node:stream/web"

// Every cached file lives in a directory named with this prefix, so leaked
// ones (see sweepStaleLocalSources) can be told apart from anything else in
// the shared /tmp.
const CACHE_DIR_PREFIX = "hookpoint-source-"

// A cached file belongs to exactly one extraction run and is deleted in that
// run's finally block. Any cache directory older than this can therefore only
// be a leak from an invocation that was killed before its cleanup ran — most
// often the 300s serverless function timeout, after which SIGKILL skips every
// finally — never a file a live run still holds, since no invocation outlives
// the 300s budget by anything close to this margin. Kept comfortably above
// that budget so the sweep can never race a run that's still reading its own
// cached copy (a long scan reads the file without touching its mtime).
const STALE_LOCAL_SOURCE_MS = 10 * 60 * 1000

export interface LocalSourceHandle {
  // Local filesystem path ffmpeg can read instead of the remote URL.
  path: string
  // Removes the cached file. Never throws.
  cleanup(): Promise<void>
}

// Reclaims cache directories left behind by invocations that were killed
// before their own cleanup ran. Without this the ~hundreds-of-MB files a
// timed-out run leaks accumulate in the shared 512MB /tmp of a warm instance
// until the next download fails with ENOSPC — at which point every run falls
// back to streaming the full proxy over HTTPS (frame-by-frame scene scans then
// sit at frame 0 and time out), and each of those timed-out runs is itself
// killed before cleanup, so the instance never recovers on its own. Running
// this at the start of every acquire makes the fallback self-healing: a run
// that finds a wedged instance clears the stale files first and caches
// normally again. Best-effort throughout — a file another run legitimately
// still owns is younger than STALE_LOCAL_SOURCE_MS and left untouched, and any
// per-entry error is swallowed so a sweep can never fail an extraction.
export async function sweepStaleLocalSources(
  nowMs: number = Date.now(),
  maxAgeMs: number = STALE_LOCAL_SOURCE_MS,
): Promise<void> {
  const tmp = os.tmpdir()
  let entries: string[]
  try {
    entries = await readdir(tmp)
  } catch {
    return
  }

  const cutoff = nowMs - maxAgeMs
  await Promise.all(
    entries
      .filter((name) => name.startsWith(CACHE_DIR_PREFIX))
      .map(async (name) => {
        const full = path.join(tmp, name)
        try {
          const info = await stat(full)
          if (info.mtimeMs < cutoff) {
            await rm(full, { recursive: true, force: true })
          }
        } catch {
          // Raced with another run's own cleanup, or already gone — either way
          // there's nothing left to reclaim here.
        }
      }),
  )
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

  // Clear any leaked caches from previously-killed runs before claiming disk,
  // so a warm instance that filled its /tmp recovers instead of streaming
  // every source over HTTPS from here on.
  await sweepStaleLocalSources()

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
