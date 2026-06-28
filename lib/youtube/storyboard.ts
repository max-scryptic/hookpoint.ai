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

const INNERTUBE_PLAYER_ENDPOINT =
  "https://www.youtube.com/youtubei/v1/player?key="

// InnerTube clients we try, in order, to fetch the storyboard spec. YouTube
// increasingly bot-challenges the plain WEB client from datacenter IPs
// (Vercel/AWS): the player endpoint answers 200 but with a LOGIN_REQUIRED
// playabilityStatus and no storyboard — so the previous WEB-only request quietly
// returned no frames in production. The mobile clients still hand back
// storyboard specs for public videos from server IPs without a PO token, so we
// try them first and keep WEB as a last resort. Each client carries its own
// long-standing public API key and a matching User-Agent.
interface InnertubeClient {
  clientName: string
  clientVersion: string
  apiKey: string
  userAgent: string
  extra?: Record<string, unknown>
}

const INNERTUBE_CLIENTS: InnertubeClient[] = [
  {
    clientName: "ANDROID",
    clientVersion: "19.09.37",
    apiKey: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
    userAgent: "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
    extra: { androidSdkVersion: 30 },
  },
  {
    clientName: "IOS",
    clientVersion: "19.09.3",
    apiKey: "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc",
    userAgent:
      "com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)",
  },
  {
    clientName: "WEB",
    clientVersion: "2.20240101.00.00",
    apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
]

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
// null. Tries each client in turn and returns the first spec found; no auth is
// required for storyboards on public or unlisted videos. Every failure path
// logs — including a 200 response that simply carries no storyboard, which is
// how a bot-challenged datacenter request looks — so a missing frame is never
// silent.
async function fetchStoryboardSpec(videoId: string): Promise<string | null> {
  for (const client of INNERTUBE_CLIENTS) {
    let response: Response
    try {
      response = await fetch(`${INNERTUBE_PLAYER_ENDPOINT}${client.apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": client.userAgent,
          Origin: "https://www.youtube.com",
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: client.clientName,
              clientVersion: client.clientVersion,
              hl: "en",
              gl: "US",
              ...client.extra,
            },
          },
        }),
        cache: "no-store",
      })
    } catch (error) {
      console.error(
        `Storyboard player request failed (${client.clientName})`,
        error,
      )
      continue
    }

    if (!response.ok) {
      console.error(
        `Storyboard player request error (${client.clientName}: ${response.status})`,
      )
      continue
    }

    const json = (await response.json()) as {
      playabilityStatus?: { status?: string; reason?: string }
      storyboards?: {
        playerStoryboardSpecRenderer?: { spec?: string }
      }
    }

    const spec = json.storyboards?.playerStoryboardSpecRenderer?.spec
    if (spec) return spec

    // 200, but no storyboard — usually a bot challenge (LOGIN_REQUIRED) on this
    // client. Log why and fall through to the next.
    console.error(
      `Storyboard spec missing (${client.clientName}: playabilityStatus=${
        json.playabilityStatus?.status ?? "unknown"
      }${
        json.playabilityStatus?.reason
          ? ` "${json.playabilityStatus.reason}"`
          : ""
      })`,
    )
  }

  return null
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
