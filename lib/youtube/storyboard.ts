// Fetches individual video frames at specific timestamps so the AI analysis can
// "see" what was on screen at a retention drop — without downloading the video.
//
// YouTube generates a storyboard for every video: low-resolution thumbnail
// sprite-sheets used to render the scrubber preview as you hover the progress
// bar. The spec for those sheets lives in the InnerTube player response, not the
// official Data API. We fetch it, work out which sprite cell covers each
// requested timestamp, and crop that cell out with sharp.
//
// Everything here is best-effort: storyboards can be missing, the InnerTube
// shape can drift, and sharp can fail to load in some runtimes. Any failure
// returns no frames so the surrounding analysis still runs transcript-only.

const INNERTUBE_PLAYER_URL =
  "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"

// A single cropped frame ready to hand to a vision model.
export interface VideoFrame {
  timestampSeconds: number
  // Base64-encoded image bytes (no data: prefix).
  base64: string
  mediaType: "image/jpeg" | "image/png"
}

// One storyboard level: a set of equally-spaced thumbnails laid out across one
// or more sprite-sheet images.
interface StoryboardLevel {
  thumbWidth: number
  thumbHeight: number
  thumbCount: number
  cols: number
  rows: number
  // Milliseconds between consecutive thumbnails.
  intervalMs: number
  // The $N replacement template (e.g. "M$M") and the per-level signature.
  nameTemplate: string
  sigh: string
}

// Parses the pipe-delimited storyboard spec string into its base URL template
// and per-level definitions. Returns null if the spec doesn't look valid.
function parseStoryboardSpec(
  spec: string,
): { baseUrl: string; levels: StoryboardLevel[] } | null {
  const parts = spec.split("|")
  if (parts.length < 2) return null

  const baseUrl = parts[0]
  const levels: StoryboardLevel[] = []

  for (const part of parts.slice(1)) {
    const args = part.split("#")
    // width#height#count#cols#rows#interval#nameTemplate#sigh
    if (args.length < 8) continue
    const thumbWidth = Number(args[0])
    const thumbHeight = Number(args[1])
    const thumbCount = Number(args[2])
    const cols = Number(args[3])
    const rows = Number(args[4])
    const intervalMs = Number(args[5])
    const nameTemplate = args[6]
    const sigh = args[7]

    if (
      [thumbWidth, thumbHeight, thumbCount, cols, rows, intervalMs].some(
        (n) => !Number.isFinite(n) || n <= 0,
      )
    ) {
      continue
    }

    levels.push({
      thumbWidth,
      thumbHeight,
      thumbCount,
      cols,
      rows,
      intervalMs,
      nameTemplate,
      sigh,
    })
  }

  return levels.length > 0 ? { baseUrl, levels } : null
}

// Builds the URL of the sprite sheet holding a given thumbnail, for a level.
function spriteUrl(
  baseUrl: string,
  levelIndex: number,
  level: StoryboardLevel,
  sheetIndex: number,
): string {
  const name = level.nameTemplate.replace("$M", String(sheetIndex))
  const url = baseUrl
    .replace("$L", String(levelIndex))
    .replace("$N", name)
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}sigh=${level.sigh}`
}

// Hits the InnerTube player endpoint and returns the storyboard spec string, or
// null. We mimic a web client; no auth is required for storyboards on public or
// unlisted videos.
async function fetchStoryboardSpec(videoId: string): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(INNERTUBE_PLAYER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240101.00.00",
          },
        },
      }),
      cache: "no-store",
    })
  } catch (error) {
    console.error("Storyboard player request failed", error)
    return null
  }

  if (!response.ok) {
    console.error(`Storyboard player request error (${response.status})`)
    return null
  }

  const json = (await response.json()) as {
    storyboards?: {
      playerStoryboardSpecRenderer?: { spec?: string }
    }
  }
  return json.storyboards?.playerStoryboardSpecRenderer?.spec ?? null
}

// Fetches and crops the requested frames. Sprite sheets are fetched at most once
// each and reused across timestamps that share a sheet. Returns frames in the
// same order as the requested (de-duplicated, sorted) timestamps; timestamps
// whose frame couldn't be produced are simply omitted.
export async function getVideoFrames(
  videoId: string,
  timestampsSeconds: number[],
): Promise<VideoFrame[]> {
  if (timestampsSeconds.length === 0) return []

  // sharp is a native dependency; load it defensively so a runtime that can't
  // load it degrades to no frames rather than throwing.
  let sharp: typeof import("sharp").default
  try {
    sharp = (await import("sharp")).default
  } catch (error) {
    console.error("sharp unavailable; skipping frame extraction", error)
    return []
  }

  const spec = await fetchStoryboardSpec(videoId)
  if (!spec) return []

  const parsed = parseStoryboardSpec(spec)
  if (!parsed) return []

  // Use the highest-resolution level available (largest thumbnail width).
  let levelIndex = 0
  for (let i = 1; i < parsed.levels.length; i++) {
    if (parsed.levels[i].thumbWidth > parsed.levels[levelIndex].thumbWidth) {
      levelIndex = i
    }
  }
  const level = parsed.levels[levelIndex]
  const perSheet = level.cols * level.rows

  // De-dupe and order the requested timestamps.
  const unique = Array.from(new Set(timestampsSeconds.map((t) => Math.max(0, t))))
    .sort((a, b) => a - b)

  // Cache of fetched + decoded sprite sheets, keyed by URL.
  const sheetCache = new Map<string, Buffer | null>()

  async function loadSheet(url: string): Promise<Buffer | null> {
    if (sheetCache.has(url)) return sheetCache.get(url) ?? null
    let buf: Buffer | null = null
    try {
      const res = await fetch(url, { cache: "no-store" })
      if (res.ok) {
        buf = Buffer.from(await res.arrayBuffer())
      } else {
        console.error(`Storyboard sheet fetch error (${res.status})`)
      }
    } catch (error) {
      console.error("Storyboard sheet fetch failed", error)
    }
    sheetCache.set(url, buf)
    return buf
  }

  const frames: VideoFrame[] = []
  for (const timestamp of unique) {
    const frameIndex = Math.min(
      level.thumbCount - 1,
      Math.floor((timestamp * 1000) / level.intervalMs),
    )
    if (frameIndex < 0) continue

    const sheetIndex = Math.floor(frameIndex / perSheet)
    const posInSheet = frameIndex % perSheet
    const row = Math.floor(posInSheet / level.cols)
    const col = posInSheet % level.cols

    const url = spriteUrl(parsed.baseUrl, levelIndex, level, sheetIndex)
    const sheet = await loadSheet(url)
    if (!sheet) continue

    try {
      const cropped = await sharp(sheet)
        .extract({
          left: col * level.thumbWidth,
          top: row * level.thumbHeight,
          width: level.thumbWidth,
          height: level.thumbHeight,
        })
        .png()
        .toBuffer()

      frames.push({
        timestampSeconds: timestamp,
        base64: cropped.toString("base64"),
        mediaType: "image/png",
      })
    } catch (error) {
      console.error("Storyboard crop failed", error)
    }
  }

  return frames
}
