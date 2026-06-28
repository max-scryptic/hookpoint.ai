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

import { ProxyAgent, fetch as proxiedFetch } from "undici"

const INNERTUBE_PLAYER_ENDPOINT = "https://www.youtube.com/youtubei/v1/player"

// Residential proxy for the storyboard *spec* request only. From a datacenter
// IP (Vercel) YouTube bot-challenges the anonymous InnerTube player endpoint and
// returns no storyboard; routing just that one small JSON request through a
// residential exit makes it look like an ordinary viewer, so the challenge goes
// away. Configured via STORYBOARD_PROXY_URL (http://user:pass@host:port); unset
// means we go direct and frames are simply skipped, as before. The sprite-sheet
// images come from ytimg, which isn't challenged, so those stay direct to keep
// proxy bandwidth (and cost) to a minimum.
function buildProxyAgent(): ProxyAgent | null {
  const url = process.env.STORYBOARD_PROXY_URL
  if (!url) return null
  try {
    const parsed = new URL(url)
    // ProxyAgent wants the bare origin; credentials go in a Proxy-Authorization
    // header so they survive regardless of how the agent parses the URI.
    const token =
      parsed.username || parsed.password
        ? `Basic ${Buffer.from(
            `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
          ).toString("base64")}`
        : undefined
    const origin = `${parsed.protocol}//${parsed.host}`
    return new ProxyAgent(token ? { uri: origin, token } : origin)
  } catch (error) {
    console.error("Invalid STORYBOARD_PROXY_URL; falling back to direct", error)
    return null
  }
}

// Built once per runtime and reused across requests.
const proxyAgent = buildProxyAgent()

// The public WEB InnerTube key and a matching desktop User-Agent.
const WEB_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"

const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// We use a single InnerTube client — anonymous WEB — routed through the
// residential proxy. The other paths we used to try are all permanently dead
// now, confirmed by production logs:
//
//   * ANDROID / IOS  → 400 FAILED_PRECONDITION. These clients now require a
//     PoToken / BotGuard attestation we can't mint server-side.
//   * WEB + OAuth     → 400 INVALID_ARGUMENT. The `youtubei/v1/player` endpoint
//     is first-party; it doesn't accept a generic Google OAuth token (our
//     Data-API scopes), no matter the bearer. Only YouTube's own app client-IDs
//     can authenticate to it.
//
// So WEB-anonymous is the only client with a chance, and only from a
// residential exit (a datacenter IP gets LOGIN_REQUIRED). The catch: that exit
// must be geo-located where the video is viewable — a public video coming back
// "Video unavailable" means the proxy IP is in a blocked/mismatched region. See
// STORYBOARD_PROXY_URL in .env.example for the required US geo-targeting.
interface InnertubeClient {
  clientName: string
  clientVersion: string
  apiKey: string
  userAgent: string
  extra?: Record<string, unknown>
}

const WEB_CLIENT: InnertubeClient = {
  clientName: "WEB",
  clientVersion: "2.20240101.00.00",
  apiKey: WEB_API_KEY,
  userAgent: WEB_USER_AGENT,
}

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

// Hits the InnerTube player endpoint with the anonymous WEB client and returns
// the storyboard spec string, or null. The request is routed through the
// residential proxy when one is configured — without it a datacenter IP gets
// bot-challenged. Every failure path logs (including a 200 that carries no
// storyboard) so a missing frame is never silent.
async function fetchStoryboardSpec(videoId: string): Promise<string | null> {
  const client = WEB_CLIENT

  // Whether the spec request is actually being routed through the residential
  // proxy. Folded into the log line below so a "no frames" run says outright if
  // the proxy was live — a Vercel env var added after the running deployment was
  // built isn't picked up until a redeploy, and "direct" makes that obvious.
  const route = proxyAgent ? "proxied" : "direct"
  const label = `${client.clientName}, ${route}`

  let response: Awaited<ReturnType<typeof proxiedFetch>>
  try {
    response = await proxiedFetch(`${INNERTUBE_PLAYER_ENDPOINT}?key=${client.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": client.userAgent,
        Origin: "https://www.youtube.com",
      },
      body: JSON.stringify({
        videoId,
        // contentCheckOk/racyCheckOk pre-acknowledge content warnings that would
        // otherwise come back as an UNPLAYABLE playabilityStatus with no spec.
        contentCheckOk: true,
        racyCheckOk: true,
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
      // Route through the residential proxy when configured; otherwise direct.
      ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
    })
  } catch (error) {
    console.error(`Storyboard player request failed (${label})`, error)
    return null
  }

  if (!response.ok) {
    // Surface a slice of the body — for a 400 it carries the actual reason,
    // which the bare status code hides.
    let detail = ""
    try {
      const body = await response.text()
      if (body) detail = `: ${body.slice(0, 300)}`
    } catch {
      // Ignore — the status code alone still tells us the request failed.
    }
    console.error(
      `Storyboard player request error (${label}: ${response.status})${detail}`,
    )
    return null
  }

  const json = (await response.json()) as {
    playabilityStatus?: { status?: string; reason?: string }
    storyboards?: {
      playerStoryboardSpecRenderer?: { spec?: string }
    }
  }

  const spec = json.storyboards?.playerStoryboardSpecRenderer?.spec
  if (spec) return spec

  // 200, but no storyboard. For a public video an UNPLAYABLE "Video unavailable"
  // here means the proxy exit IP is in a blocked/mismatched region; LOGIN_REQUIRED
  // means the request wasn't routed through a residential exit.
  console.error(
    `Storyboard spec missing (${label}: playabilityStatus=${
      json.playabilityStatus?.status ?? "unknown"
    }${
      json.playabilityStatus?.reason
        ? ` "${json.playabilityStatus.reason}"`
        : ""
    })`,
  )

  return null
}

// Fetches and crops the requested frames. Sprite sheets are fetched at most once
// each and reused across timestamps that share a sheet. Returns frames in the
// same order as the requested (de-duplicated, sorted) timestamps; timestamps
// whose frame couldn't be produced are simply omitted.
//
// The storyboard spec request is anonymous (WEB), so in production it must be
// routed through a residential proxy — see STORYBOARD_PROXY_URL. Without one a
// datacenter IP is bot-challenged and no frames come back.
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
