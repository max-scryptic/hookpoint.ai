import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, rm, stat, utimes } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { sweepStaleLocalSources } from "@/lib/media/local-source-cache"

const CACHE_DIR_PREFIX = "viewlio-source-"

// Tracks every directory a test creates in the real os.tmpdir() so it can be
// cleaned up regardless of whether the sweep removed it.
const created: string[] = []

async function makeCacheDir(ageMs: number): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), CACHE_DIR_PREFIX))
  created.push(dir)
  const when = new Date(Date.now() - ageMs)
  await utimes(dir, when, when)
  return dir
}

async function exists(dir: string): Promise<boolean> {
  try {
    await stat(dir)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe("sweepStaleLocalSources", () => {
  it("removes cache dirs older than the staleness window (leaks from killed runs)", async () => {
    const stale = await makeCacheDir(20 * 60 * 1000)

    await sweepStaleLocalSources()

    expect(await exists(stale)).toBe(false)
  })

  it("leaves a fresh cache dir alone — it may still be a live run's own file", async () => {
    const fresh = await makeCacheDir(30 * 1000)

    await sweepStaleLocalSources()

    expect(await exists(fresh)).toBe(true)
  })

  it("reclaims only the stale dirs when both are present", async () => {
    const stale = await makeCacheDir(20 * 60 * 1000)
    const fresh = await makeCacheDir(30 * 1000)

    await sweepStaleLocalSources()

    expect(await exists(stale)).toBe(false)
    expect(await exists(fresh)).toBe(true)
  })

  it("honours a caller-supplied clock and window", async () => {
    const dir = await makeCacheDir(0)

    // Sweep as if it were an hour from now with a 10-minute window: the
    // just-created dir is now well past it.
    await sweepStaleLocalSources(Date.now() + 60 * 60 * 1000, 10 * 60 * 1000)

    expect(await exists(dir)).toBe(false)
  })
})
