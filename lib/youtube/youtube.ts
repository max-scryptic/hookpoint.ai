// Helpers for talking to the YouTube Data API (video metadata) and the YouTube
// Analytics API (audience retention), plus the local logic that turns a
// retention curve into the steep drop-off points we surface to the user.

const DATA_API = "https://www.googleapis.com/youtube/v3"
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2"

export type VideoPrivacyStatus = "public" | "unlisted" | "private"

export interface VideoDetails {
  id: string
  title: string
  channelId: string
  publishedAt: string
  durationSeconds: number
  thumbnailUrl: string | null
  // Richer metadata captured at analyse time so the Analysed Videos list can
  // render full stats (description, view/comment counts, visibility) without
  // re-calling the YouTube API. Optional because rows analysed before these
  // fields existed won't have them.
  description?: string
  viewCount?: number | null
  commentCount?: number | null
  privacyStatus?: VideoPrivacyStatus
}

export interface RecentVideo {
  id: string
  title: string
  description: string
  publishedAt: string
  thumbnailUrl: string | null
  // Enriched from videos.list; null when the stat is hidden or unavailable.
  viewCount: number | null
  commentCount: number | null
  durationSeconds: number | null
  privacyStatus: VideoPrivacyStatus
}

export interface RecentVideosPage {
  videos: RecentVideo[]
  // Opaque YouTube cursors for the surrounding pages; null when there is no
  // newer/older page in the current result set.
  nextPageToken: string | null
  prevPageToken: string | null
}

export interface GetRecentVideosOptions {
  maxResults?: number
  // Opaque cursor from a previous page's next/prev token.
  pageToken?: string | null
  // Free-text title/description search passed to search.list's `q` param.
  query?: string | null
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

export interface RetentionGain {
  fromTimestampSeconds: number
  toTimestampSeconds: number
  // How much absolute retention was gained across this segment (positive
  // number). A gain means more viewers were watching at the end of the segment
  // than the start — typically a re-watched or replayed moment.
  watchRatioGain: number
}

// A single timestamped line of spoken text from a video's caption track.
export interface TranscriptCue {
  startSeconds: number
  endSeconds: number
  text: string
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

// Fetches a page of the authenticated user's uploads, newest first.
// `search.list` with forMine=true returns only videos owned by the signed-in
// channel. Title/description search (`query`) is applied server-side via the
// `q` param; pagination is cursor-based via `pageToken`, so each page is a
// separate request (search.list caps results at 50 per page). Neither privacy
// status nor a publish-date range can be filtered here — the publishedAfter/
// publishedBefore params return a 400 when combined with forMine=true, and
// privacy only arrives with the enrichment call — so callers filter on both
// client-side.
export async function getRecentVideos(
  accessToken: string,
  options: GetRecentVideosOptions = {},
): Promise<RecentVideosPage> {
  const { maxResults = 12, pageToken, query } = options

  const url = new URL(`${DATA_API}/search`)
  url.searchParams.set("part", "snippet")
  url.searchParams.set("forMine", "true")
  url.searchParams.set("type", "video")
  url.searchParams.set("order", "date")
  url.searchParams.set("maxResults", String(maxResults))
  if (pageToken) url.searchParams.set("pageToken", pageToken)
  if (query) url.searchParams.set("q", query)

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    // Per-user, token-scoped data — never cache at the fetch layer.
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(
      `YouTube Data API error (${response.status}): ${await response.text()}`,
    )
  }

  const json = (await response.json()) as {
    nextPageToken?: string
    prevPageToken?: string
    items?: Array<{
      id?: { videoId?: string }
      snippet?: {
        title?: string
        description?: string
        publishedAt?: string
        thumbnails?: Record<string, { url?: string }>
      }
    }>
  }

  const videos = (json.items ?? [])
    .map((item): RecentVideo | null => {
      const id = item.id?.videoId
      if (!id) return null

      const thumbnails = item.snippet?.thumbnails ?? {}
      const thumbnailUrl =
        thumbnails.high?.url ??
        thumbnails.medium?.url ??
        thumbnails.default?.url ??
        null

      return {
        id,
        title: item.snippet?.title ?? "",
        description: item.snippet?.description ?? "",
        publishedAt: item.snippet?.publishedAt ?? "",
        thumbnailUrl,
        viewCount: null,
        commentCount: null,
        durationSeconds: null,
        privacyStatus: "private",
      }
    })
    .filter((video): video is RecentVideo => video !== null)

  // search.list omits statistics, privacy status and duration, so enrich the
  // results with a single videos.list call keyed on the IDs we just collected.
  await enrichWithVideoDetails(accessToken, videos)

  return {
    videos,
    nextPageToken: json.nextPageToken ?? null,
    prevPageToken: json.prevPageToken ?? null,
  }
}

// Mutates the passed videos in place, filling in viewCount, commentCount,
// durationSeconds and privacyStatus from the videos.list endpoint. Failures are
// swallowed so the list still renders with the snippet data already in hand.
async function enrichWithVideoDetails(
  accessToken: string,
  videos: RecentVideo[],
): Promise<void> {
  if (videos.length === 0) return

  const url = new URL(`${DATA_API}/videos`)
  url.searchParams.set("part", "statistics,status,contentDetails")
  url.searchParams.set("id", videos.map((video) => video.id).join(","))

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
  } catch (error) {
    console.error("Failed to enrich recent videos with details", error)
    return
  }

  if (!response.ok) {
    console.error(
      `YouTube Data API error enriching videos (${response.status}): ${await response.text()}`,
    )
    return
  }

  const json = (await response.json()) as {
    items?: Array<{
      id?: string
      statistics?: { viewCount?: string; commentCount?: string }
      status?: { privacyStatus?: string }
      contentDetails?: { duration?: string }
    }>
  }

  const byId = new Map(
    (json.items ?? []).map((item) => [item.id ?? "", item] as const),
  )

  for (const video of videos) {
    const details = byId.get(video.id)
    if (!details) continue

    const viewCount = details.statistics?.viewCount
    const commentCount = details.statistics?.commentCount
    const duration = details.contentDetails?.duration

    video.viewCount = viewCount != null ? Number(viewCount) : null
    video.commentCount = commentCount != null ? Number(commentCount) : null
    video.durationSeconds = duration ? parseIso8601Duration(duration) : null

    const privacy = details.status?.privacyStatus
    if (privacy === "public" || privacy === "unlisted" || privacy === "private") {
      video.privacyStatus = privacy
    }
  }
}

// Returns the channel ID of the authenticated user's own channel, or null if
// the account has no channel. Used to confirm a pasted video belongs to the
// connected channel before analysing it.
export async function getMyChannelId(
  accessToken: string,
): Promise<string | null> {
  const url = new URL(`${DATA_API}/channels`)
  url.searchParams.set("part", "id")
  url.searchParams.set("mine", "true")

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(
      `YouTube Data API error (${response.status}): ${await response.text()}`,
    )
  }

  const json = (await response.json()) as { items?: Array<{ id?: string }> }
  return json.items?.[0]?.id ?? null
}

export async function getVideoDetails(
  accessToken: string,
  videoId: string,
): Promise<VideoDetails | null> {
  const url = new URL(`${DATA_API}/videos`)
  // statistics + status come back on the same videos.list call (still 1 quota
  // unit) so we can persist full metadata at analyse time.
  url.searchParams.set("part", "snippet,contentDetails,statistics,status")
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
        description?: string
        channelId?: string
        publishedAt?: string
        thumbnails?: Record<string, { url?: string }>
      }
      contentDetails?: { duration?: string }
      statistics?: { viewCount?: string; commentCount?: string }
      status?: { privacyStatus?: string }
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

  const viewCount = item.statistics?.viewCount
  const commentCount = item.statistics?.commentCount
  const privacy = item.status?.privacyStatus
  const privacyStatus: VideoPrivacyStatus =
    privacy === "public" || privacy === "unlisted" || privacy === "private"
      ? privacy
      : "private"

  return {
    id: item.id,
    title: item.snippet?.title ?? "",
    channelId: item.snippet?.channelId ?? "",
    publishedAt: item.snippet?.publishedAt ?? "",
    durationSeconds: parseIso8601Duration(item.contentDetails?.duration ?? "PT0S"),
    thumbnailUrl,
    description: item.snippet?.description ?? "",
    viewCount: viewCount != null ? Number(viewCount) : null,
    commentCount: commentCount != null ? Number(commentCount) : null,
    privacyStatus,
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

// Fetches the spoken-word transcript for a video the authenticated user owns,
// as a list of timestamped cues. Returns an empty array when the video has no
// caption track or captions are disabled.
//
// Two Data API calls are made: captions.list (50 quota units) to find the best
// track, then captions.download (200 units) to fetch the cue text. Both require
// the youtube.force-ssl scope and only work on videos owned by the signed-in
// channel — exactly the videos Hookpoint analyses.
export async function getVideoTranscript(
  accessToken: string,
  videoId: string,
): Promise<TranscriptCue[]> {
  const trackId = await pickCaptionTrack(accessToken, videoId)
  if (!trackId) return []

  const url = new URL(`${DATA_API}/captions/${trackId}`)
  // WebVTT is the easiest timestamped format to parse back into cues.
  url.searchParams.set("tfmt", "vtt")

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })

  if (!response.ok) {
    // A 403 here usually means the track isn't downloadable (e.g. some
    // third-party-managed tracks). Treat transcript fetching as best-effort so
    // it never blocks the core retention analysis.
    console.error(
      `YouTube captions.download error (${response.status}): ${await response.text()}`,
    )
    return []
  }

  return parseWebVtt(await response.text())
}

// Lists a video's caption tracks and returns the ID of the best one to download,
// or null if there are none. Prefers a human-authored ("standard") track over an
// auto-generated ("ASR") one, and English over other languages, but will fall
// back to whatever exists so non-English channels still get a transcript.
async function pickCaptionTrack(
  accessToken: string,
  videoId: string,
): Promise<string | null> {
  const url = new URL(`${DATA_API}/captions`)
  url.searchParams.set("part", "snippet")
  url.searchParams.set("videoId", videoId)

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })

  if (!response.ok) {
    console.error(
      `YouTube captions.list error (${response.status}): ${await response.text()}`,
    )
    return null
  }

  const json = (await response.json()) as {
    items?: Array<{
      id?: string
      snippet?: { trackKind?: string; language?: string; isDraft?: boolean }
    }>
  }

  const tracks = (json.items ?? []).filter(
    (item) => item.id && !item.snippet?.isDraft,
  )
  if (tracks.length === 0) return null

  const score = (item: (typeof tracks)[number]): number => {
    const isManual = item.snippet?.trackKind !== "ASR"
    const isEnglish = (item.snippet?.language ?? "").toLowerCase().startsWith("en")
    // Manual tracks are far more accurate than auto-captions, so weight that
    // above language; an English caption is a mild tiebreak on top.
    return (isManual ? 2 : 0) + (isEnglish ? 1 : 0)
  }

  const best = tracks.reduce((a, b) => (score(b) > score(a) ? b : a))
  return best.id ?? null
}

// Parses a WebVTT caption file into timestamped cues. Tolerant of the quirks
// YouTube emits: a WEBVTT header, NOTE/STYLE/REGION blocks, optional cue
// identifiers, cue-setting suffixes after the timestamp, and inline timing tags
// (<00:00:01.000>, <c>…</c>) inside auto-generated caption text.
export function parseWebVtt(vtt: string): TranscriptCue[] {
  const cues: TranscriptCue[] = []
  // Normalise line endings, then split into blank-line-separated blocks.
  const blocks = vtt.replace(/\r\n?/g, "\n").split(/\n{2,}/)

  for (const block of blocks) {
    const lines = block.split("\n")
    const timingLineIndex = lines.findIndex((line) => line.includes("-->"))
    if (timingLineIndex === -1) continue

    const timing = lines[timingLineIndex]
    const match = timing.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/,
    )
    if (!match) continue

    const start = parseVttTimestamp(match[1])
    const end = parseVttTimestamp(match[2])
    if (start === null || end === null) continue

    const text = lines
      .slice(timingLineIndex + 1)
      .join(" ")
      // Strip inline tags like <00:00:01.000>, <c>, </c>.
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (!text) continue

    cues.push({ startSeconds: start, endSeconds: end, text })
  }

  return cues
}

// Parses an "HH:MM:SS.mmm" or "MM:SS.mmm" WebVTT timestamp into seconds.
function parseVttTimestamp(value: string): number | null {
  const parts = value.replace(",", ".").split(":")
  if (parts.length < 2 || parts.length > 3) return null
  const nums = parts.map(Number)
  if (nums.some((n) => Number.isNaN(n))) return null
  return parts.length === 3
    ? nums[0] * 3600 + nums[1] * 60 + nums[2]
    : nums[0] * 60 + nums[1]
}

// Returns the transcript text spoken during a [from, to] time window, joined
// into a single string. A cue counts as inside the window if it overlaps it at
// all, so a drop-off that lands mid-sentence still picks up that sentence.
export function transcriptForSegment(
  cues: TranscriptCue[],
  fromSeconds: number,
  toSeconds: number,
): string {
  return cues
    .filter((cue) => cue.endSeconds >= fromSeconds && cue.startSeconds <= toSeconds)
    .map((cue) => cue.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
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

// The mirror image of detectDropOffs: finds the segments where retention rises
// fastest. A rising curve means viewers re-watched or skipped back to a moment,
// so these are the points that held or grew the audience. Walks consecutive
// points, keeps gains larger than `minGain` absolute watch-ratio, and returns
// the largest `limit` of them (biggest gain first).
export function detectRetentionGains(
  points: RetentionPoint[],
  { minGain = 0.03, limit = 5 }: { minGain?: number; limit?: number } = {},
): RetentionGain[] {
  const gains: RetentionGain[] = []

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const delta = curr.watchRatio - prev.watchRatio
    if (delta >= minGain) {
      gains.push({
        fromTimestampSeconds: prev.timestampSeconds,
        toTimestampSeconds: curr.timestampSeconds,
        watchRatioGain: delta,
      })
    }
  }

  return gains
    .sort((a, b) => b.watchRatioGain - a.watchRatioGain)
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
