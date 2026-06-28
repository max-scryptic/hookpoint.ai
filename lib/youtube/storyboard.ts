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

// The public WEB InnerTube key. Used both for the anonymous WEB fallback and as
// the key on the authenticated request (the player endpoint still wants a key
// alongside the OAuth bearer).
const WEB_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"

const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// InnerTube clients we try, in order, to fetch the storyboard spec.
//
// From a datacenter IP (Vercel/AWS) every *anonymous* request is now refused:
// the ANDROID/IOS clients answer 400, and WEB answers 200 with a LOGIN_REQUIRED
// playabilityStatus ("Sign in to confirm you're not a bot") and no storyboard.
// So the only reliable path is an *authenticated* request — one carrying the
// user's Google OAuth token as a bearer. That request is tied to a real account
// (the same account whose retention we already fetch), so YouTube doesn't
// bot-challenge it. When a token is available we try it first; the anonymous
// clients stay as a best-effort fallback (and for any caller without a token).
//
// Each client carries its own long-standing public API key and a matching
// User-Agent; the `oauth` client authenticates with the bearer token instead.
interface InnertubeClient {
  clientName: string
  clientVersion: string
  apiKey: string
  userAgent: string
  extra?: Record<string, unknown>
  // When true, send the user's OAuth token as `Authorization: Bearer` so the
  // request is authenticated rather than anonymous.
  oauth?: boolean
}

// Tried first when an access token is available. WEB still returns the richest
// storyboard spec; with a bearer token it's no longer bot-challenged.
const AUTHENTICATED_CLIENT: InnertubeClient = {
  clientName: "WEB",
  clientVersion: "2.20240101.00.00",
  apiKey: WEB_API_KEY,
  userAgent: WEB_USER_AGENT,
  oauth: true,
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
    apiKey: WEB_API_KEY,
    userAgent: WEB_USER_AGENT,
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
// null. When an OAuth access token is supplied we try an authenticated request
// first — anonymous datacenter requests are now bot-challenged, so the token is
// what actually gets a spec back in production. Tries each remaining client in
// turn and returns the first spec found. Every failure path logs — including a
// 200 that carries no storyboard, which is how a bot-challenged anonymous
// request looks — so a missing frame is never silent.
async function fetchStoryboardSpec(
  videoId: string,
  accessToken?: string,
): Promise<string | null> {
  const clients = accessToken
    ? [AUTHENTICATED_CLIENT, ...INNERTUBE_CLIENTS]
    : INNERTUBE_CLIENTS

  // Whether the spec request is actually being routed through the residential
  // proxy. Folded into every log line below so a "no frames" run says outright
  // if the proxy was live — a Vercel env var added after the running deployment
  // was built isn't picked up until a redeploy, and "direct" makes that obvious.
  const route = proxyAgent ? "proxied" : "direct"

  for (const client of clients) {
    const label = `${client.oauth ? `${client.clientName}+oauth` : client.clientName}, ${route}`
    let response: Awaited<ReturnType<typeof proxiedFetch>>
    try {
      response = await proxiedFetch(`${INNERTUBE_PLAYER_ENDPOINT}?key=${client.apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": client.userAgent,
          Origin: "https://www.youtube.com",
          ...(client.oauth && accessToken
            ? {
                Authorization: `Bearer ${accessToken}`,
                "X-Goog-Api-Format-Version": "2",
              }
            : {}),
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
        // Route through the residential proxy when configured; otherwise direct.
        ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
      })
    } catch (error) {
      console.error(`Storyboard player request failed (${label})`, error)
      continue
    }

    if (!response.ok) {
      // Surface a slice of the body — for a 400 it carries the actual reason
      // (e.g. an invalid argument or a rejected credential), which the bare
      // status code hides.
      let detail = ""
      try {
        const body = await response.text()
        if (body) detail = `: ${body.slice(0, 300)}`
      } catch {
        // Ignore — the status code alone still tells us this client failed.
      }
      console.error(
        `Storyboard player request error (${label}: ${response.status})${detail}`,
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
      `Storyboard spec missing (${label}: playabilityStatus=${
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
//
// `accessToken` is the video owner's Google OAuth token. It's optional, but
// without it the storyboard spec request is anonymous and YouTube bot-challenges
// it from datacenter IPs — so in production this should always be supplied.
export async function getVideoFrames(
  videoId: string,
  timestampsSeconds: number[],
  accessToken?: string,
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

  const spec = await fetchStoryboardSpec(videoId, accessToken)
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
