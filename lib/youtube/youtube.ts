// Helpers for talking to the YouTube Data API (video metadata) and the YouTube
// Analytics API (audience retention), plus the local logic that turns a
// retention curve into the steep drop-off points we surface to the user.

const DATA_API = "https://www.googleapis.com/youtube/v3"
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2"

export interface VideoDetails {
  id: string
  title: string
  channelId: string
  publishedAt: string
  durationSeconds: number
  thumbnailUrl: string | null
}

export interface RetentionPoint {
  // Fraction of the video elapsed, 0.0 -> 1.0.
  elapsedRatio: number
  // Absolute share of viewers still watching at this point.
  watchRatio: number
  // 0..1 performance vs. other YouTube videos of similar length (may be null
  // when YouTube has insufficient data).
  relativePerformance: number | null
  // Convenience: elapsedRatio mapped to seconds using the video duration.
  timestampSeconds: number
}

export interface DropOff {
  fromTimestampSeconds: number
  toTimestampSeconds: number
  // How much absolute retention was lost across this segment (positive number).
  watchRatioDrop: number
}

// Accepts the common YouTube URL shapes (watch?v=, youtu.be/, /shorts/,
// /embed/) as well as a bare 11-character video ID. Returns null if nothing
// looks like a video ID.
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, "")

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0]
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = url.searchParams.get("v")
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v

    const parts = url.pathname.split("/").filter(Boolean)
    if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "v") {
      const id = parts[1]
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
    }
  }

  return null
}

// Parses an ISO 8601 duration (e.g. "PT1H2M30S") into seconds.
export function parseIso8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const [, h, m, s] = match
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)
}

export async function getVideoDetails(
  accessToken: string,
  videoId: string,
): Promise<VideoDetails | null> {
  const url = new URL(`${DATA_API}/videos`)
  url.searchParams.set("part", "snippet,contentDetails")
  url.searchParams.set("id", videoId)

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(
      `YouTube Data API error (${response.status}): ${await response.text()}`,
    )
  }

  const json = (await response.json()) as {
    items?: Array<{
      id: string
      snippet?: {
        title?: string
        channelId?: string
        publishedAt?: string
        thumbnails?: Record<string, { url?: string }>
      }
      contentDetails?: { duration?: string }
    }>
  }

  const item = json.items?.[0]
  if (!item) return null

  const thumbnails = item.snippet?.thumbnails ?? {}
  const thumbnailUrl =
    thumbnails.maxres?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null

  return {
    id: item.id,
    title: item.snippet?.title ?? "",
    channelId: item.snippet?.channelId ?? "",
    publishedAt: item.snippet?.publishedAt ?? "",
    durationSeconds: parseIso8601Duration(item.contentDetails?.duration ?? "PT0S"),
    thumbnailUrl,
  }
}

// Fetches the audience retention curve for a single video the authenticated
// user owns. The Analytics API requires `channel==MINE` and a single video ID
// (it rejects comma-separated lists for this report).
export async function getAudienceRetention(
  accessToken: string,
  video: VideoDetails,
): Promise<RetentionPoint[]> {
  const url = new URL(`${ANALYTICS_API}/reports`)
  url.searchParams.set("ids", "channel==MINE")
  // Start from the day before publication so the full lifetime is covered.
  url.searchParams.set("startDate", isoDate(video.publishedAt) ?? "2005-02-01")
  url.searchParams.set("endDate", isoDate(new Date().toISOString())!)
  url.searchParams.set("dimensions", "elapsedVideoTimeRatio")
  url.searchParams.set("metrics", "audienceWatchRatio,relativeRetentionPerformance")
  url.searchParams.set("filters", `video==${video.id}`)

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(
      `YouTube Analytics API error (${response.status}): ${await response.text()}`,
    )
  }

  const json = (await response.json()) as {
    rows?: Array<[number, number, number | null]>
  }

  const rows = json.rows ?? []
  return rows
    .map(([elapsedRatio, watchRatio, relativePerformance]) => ({
      elapsedRatio,
      watchRatio,
      relativePerformance: relativePerformance ?? null,
      timestampSeconds: elapsedRatio * video.durationSeconds,
    }))
    .sort((a, b) => a.elapsedRatio - b.elapsedRatio)
}

// Finds the segments where retention falls fastest. Walks consecutive points,
// keeps drops larger than `minDrop` absolute watch-ratio, and returns the
// steepest `limit` of them (largest drop first).
export function detectDropOffs(
  points: RetentionPoint[],
  { minDrop = 0.03, limit = 5 }: { minDrop?: number; limit?: number } = {},
): DropOff[] {
  const drops: DropOff[] = []

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const delta = prev.watchRatio - curr.watchRatio
    if (delta >= minDrop) {
      drops.push({
        fromTimestampSeconds: prev.timestampSeconds,
        toTimestampSeconds: curr.timestampSeconds,
        watchRatioDrop: delta,
      })
    }
  }

  return drops
    .sort((a, b) => b.watchRatioDrop - a.watchRatioDrop)
    .slice(0, limit)
}

// Extracts the YYYY-MM-DD portion of an ISO timestamp, which is the format the
// Analytics API expects for startDate/endDate.
function isoDate(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}
