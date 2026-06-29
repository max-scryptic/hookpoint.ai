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

export interface YouTubeChannelDetails {
  id: string
  title: string
  description: string
  thumbnailUrl: string | null
  subscriberCount: number | null
  viewCount: number
  videoCount: number
}

// Sort orders search.list accepts for an uploads listing (forMine=true). YouTube
// sorts each field in a single fixed direction — `date` is newest-first, `title`
// is A–Z, `viewCount` is most-viewed-first — and offers no comment-count order,
// so the upload list's sort menu is limited to these three.
export type RecentVideosOrder = "date" | "title" | "viewCount"

export interface GetRecentVideosOptions {
  maxResults?: number
  // Opaque cursor from a previous page's next/prev token.
  pageToken?: string | null
  // Free-text title/description search passed to search.list's `q` param.
  query?: string | null
  // Server-side sort order. Defaults to newest-first.
  order?: RecentVideosOrder
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

// Fetches a page of the authenticated user's uploads, sorted by `order`
// (newest first by default). `search.list` with forMine=true returns only
// videos owned by the signed-in channel. Title/description search (`query`) is
// applied server-side via the `q` param; pagination is cursor-based via
// `pageToken`, so each page is a separate request (search.list caps results at
// 50 per page). Sorting is server-side too — because only one page is in memory
// at a time, the client can't reorder the full result set itself. Neither privacy
// status nor a publish-date range can be filtered here — the publishedAfter/
// publishedBefore params return a 400 when combined with forMine=true, and
// privacy only arrives with the enrichment call — so callers filter on both
// client-side.
export async function getRecentVideos(
  accessToken: string,
  options: GetRecentVideosOptions = {},
): Promise<RecentVideosPage> {
  const { maxResults = 12, pageToken, query, order = "date" } = options

  const url = new URL(`${DATA_API}/search`)
  url.searchParams.set("part", "snippet")
  url.searchParams.set("forMine", "true")
  url.searchParams.set("type", "video")
  url.searchParams.set("order", order)
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

// Returns the public profile and lifetime statistics for the authenticated
// user's channel. Subscriber count can be hidden by the channel owner, in
// which case YouTube omits it and we expose null to the UI.
export async function getMyChannelDetails(
  accessToken: string,
): Promise<YouTubeChannelDetails | null> {
  const url = new URL(`${DATA_API}/channels`)
  url.searchParams.set("part", "snippet,statistics")
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

  const json = (await response.json()) as {
    items?: Array<{
      id?: string
      snippet?: {
        title?: string
        description?: string
        thumbnails?: Record<string, { url?: string }>
      }
      statistics?: {
        subscriberCount?: string
        hiddenSubscriberCount?: boolean
        viewCount?: string
        videoCount?: string
      }
    }>
  }

  const item = json.items?.[0]
  if (!item?.id) return null

  const thumbnails = item.snippet?.thumbnails ?? {}
  const thumbnailUrl =
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null
  const subscriberCount = item.statistics?.subscriberCount

  return {
    id: item.id,
    title: item.snippet?.title ?? "YouTube channel",
    description: item.snippet?.description ?? "",
    thumbnailUrl,
    subscriberCount:
      item.statistics?.hiddenSubscriberCount || subscriberCount == null
        ? null
        : Number(subscriberCount),
    viewCount: Number(item.statistics?.viewCount ?? 0),
    videoCount: Number(item.statistics?.videoCount ?? 0),
  }
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

  return cleanTranscriptCues(cues)
}

// YouTube's auto-generated captions censor profanity with a bracketed bleep
// marker — rendered as "[ __ ]", with non-breaking spaces (U+00A0) padding the
// underscores. Replace it with four asterisks so the transcript still shows
// that a word was spoken. Only brackets containing nothing but underscores and
// whitespace are replaced; genuine
// caption annotations such as "[Music]" or "[Applause]" contain letters and so
// are left untouched. `\s` matches the non-breaking space used in the marker.
export function replaceCaptionBleeps(text: string): string {
  return text
    .replace(/\[[\s_]*_[\s_]*\]/g, "****")
    .replace(/\s+/g, " ")
    .trim()
}

// Retain the previous export for callers outside this module while its behavior
// now matches the replacement policy above.
export const stripCaptionBleeps = replaceCaptionBleeps

// Canonical cleanup for a freshly parsed or previously cached transcript:
// replaces auto-caption bleep markers with "****", then collapses the
// rolling-window duplication. Applied both at fetch time and on read of cached
// rows, so legacy analyses are healed in place.
export function cleanTranscriptCues(cues: TranscriptCue[]): TranscriptCue[] {
  const cleaned: TranscriptCue[] = []
  for (const cue of cues) {
    const text = replaceCaptionBleeps(cue.text)
    if (!text) continue
    cleaned.push({ ...cue, text })
  }
  return dedupeTranscriptCues(cleaned)
}

// Normalises a word for overlap comparison: lower-cased and stripped of edge
// punctuation, so "Crypto" and "crypto," count as the same token.
function normaliseWord(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}

// Collapses the rolling-window duplication that YouTube auto-generated (ASR)
// caption tracks emit. Those tracks repaint the on-screen text every cue, so the
// same phrase reappears verbatim across two or three consecutive cues — which,
// once joined, reads as "Hey guys Hey guys Hey guys ...". For each cue we drop
// the leading run of words that simply repeats the tail of what we've already
// kept, and discard cues that are wholly duplicates. Human-authored tracks have
// no such overlap, so they pass through untouched.
export function dedupeTranscriptCues(cues: TranscriptCue[]): TranscriptCue[] {
  // How far back to look for an overlap, in words. Caps the work per cue and
  // guards against collapsing genuine long-range repetition in real speech.
  const MAX_OVERLAP = 60

  const result: TranscriptCue[] = []
  // Trailing words of the text kept so far, used to detect each cue's overlap.
  let tail: string[] = []

  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean)
    if (words.length === 0) continue

    // Largest k such that the last k kept words equal this cue's first k words.
    const maxK = Math.min(words.length, tail.length, MAX_OVERLAP)
    let overlap = 0
    for (let k = maxK; k >= 1; k--) {
      let matches = true
      for (let i = 0; i < k; i++) {
        if (normaliseWord(tail[tail.length - k + i]) !== normaliseWord(words[i])) {
          matches = false
          break
        }
      }
      if (matches) {
        overlap = k
        break
      }
    }

    const fresh = words.slice(overlap)
    if (fresh.length === 0) continue // cue was a verbatim repeat — drop it.

    result.push({
      startSeconds: cue.startSeconds,
      endSeconds: cue.endSeconds,
      text: fresh.join(" "),
    })
    tail = tail.concat(fresh).slice(-MAX_OVERLAP)
  }

  return result
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
// steepest `limit` of them, ordered from earliest to latest for display.
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
    .sort((a, b) => a.fromTimestampSeconds - b.fromTimestampSeconds)
}

// The mirror image of detectDropOffs: finds the segments where retention rises
// fastest. A rising curve means viewers re-watched or skipped back to a moment,
// so these are the points that held or grew the audience. Walks consecutive
// points, keeps gains larger than `minGain` absolute watch-ratio, and returns
// the largest `limit` of them, ordered from earliest to latest for display.
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
    .sort((a, b) => a.fromTimestampSeconds - b.fromTimestampSeconds)
}

// A drop-off that has been judged "significant" — i.e. steeper than the video's
// own typical decline, or landing on a moment that underperforms similar videos.
// These are the moments worth explaining; ordinary monotonic decay is not.
export interface SignificantDropOff extends DropOff {
  // YouTube's relativeRetentionPerformance at the end of the segment (0..1,
  // where <0.5 is below the median video of similar length). Null when YouTube
  // has too little data to report it.
  relativePerformance: number | null
  // How many times steeper this drop is than the video's median per-step drop.
  // 2.0 means "twice as steep as the typical decline here".
  steepness: number
  // True when the drop is steeper than the abnormal-steepness threshold (as
  // opposed to being surfaced only because it underperforms similar videos).
  isAbnormallySteep: boolean
}

// Returns the median of a list of numbers, or 0 for an empty list.
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

// Finds the drop-offs that are actually worth a creator's attention, as opposed
// to the natural decay every video shows. A point is surfaced when EITHER:
//   • its drop is meaningfully steeper than the video's own median step drop
//     (steepness >= steepnessFactor), OR
//   • viewers were underperforming similar videos there (relativePerformance
//     below `underperformBelow`) while still losing a non-trivial share.
// This is the gate that keeps the AI from inventing reasons for noise. Results
// are ranked by significance, capped at `limit`, then ordered earliest-first.
export function detectSignificantDropOffs(
  points: RetentionPoint[],
  {
    minDrop = 0.02,
    steepnessFactor = 1.8,
    underperformBelow = 0.5,
    limit = 5,
    ignoreBeforeSeconds = HOOK_COVERAGE_END_SECONDS,
  }: {
    minDrop?: number
    steepnessFactor?: number
    underperformBelow?: number
    limit?: number
    // Drop-offs landing at or before this mark are skipped. Defaults to the end
    // of the fixed "The Hook" windows, which already break out the opening, so
    // this list only surfaces drops the hook section doesn't already cover.
    ignoreBeforeSeconds?: number
  } = {},
): SignificantDropOff[] {
  if (points.length < 2) return []

  // Baseline = the typical positive step-to-step drop across the whole curve.
  const stepDrops: number[] = []
  for (let i = 1; i < points.length; i++) {
    const delta = points[i - 1].watchRatio - points[i].watchRatio
    if (delta > 0) stepDrops.push(delta)
  }
  const baseline = median(stepDrops) || minDrop

  const drops: SignificantDropOff[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    // Skip anything inside the opening already covered by The Hook windows.
    if (curr.timestampSeconds <= ignoreBeforeSeconds) continue
    const delta = prev.watchRatio - curr.watchRatio
    if (delta < minDrop) continue

    const steepness = delta / baseline
    const relativePerformance = curr.relativePerformance
    const isAbnormallySteep = steepness >= steepnessFactor
    const underperforms =
      relativePerformance != null && relativePerformance < underperformBelow

    if (!isAbnormallySteep && !underperforms) continue

    drops.push({
      fromTimestampSeconds: prev.timestampSeconds,
      toTimestampSeconds: curr.timestampSeconds,
      watchRatioDrop: delta,
      relativePerformance,
      steepness,
      isAbnormallySteep,
    })
  }

  return drops
    .sort((a, b) => b.watchRatioDrop - a.watchRatioDrop)
    .slice(0, limit)
    .sort((a, b) => a.fromTimestampSeconds - b.fromTimestampSeconds)
}

// A named, fixed stretch of the video's opening that we analyse for EVERY video,
// independent of where its drop-offs happen to land. The opening seconds are by
// far the highest-leverage part of any video — most of the audience is won or
// lost there — so we always break them out into these explicit windows.
export interface RetentionWindowConfig {
  // Stable identifier, used as a React key.
  id: string
  // Human-readable name shown in the UI (e.g. "Initial Hook").
  label: string
  // Window bounds in seconds from the start of the video, inclusive of
  // `fromSeconds` and up to `toSeconds`.
  fromSeconds: number
  toSeconds: number
}

// The two retention windows analysed for every video by default. These are
// intentionally hard-configured (not derived from the curve) so the same two
// opening windows are always reported, no matter the video.
export const RETENTION_WINDOWS: RetentionWindowConfig[] = [
  { id: "initial-hook", label: "Initial Hook", fromSeconds: 0, toSeconds: 10 },
  { id: "hook-delivery", label: "Hook Delivery", fromSeconds: 10, toSeconds: 30 },
]

// End of the opening stretch covered by the fixed "The Hook" windows above
// (i.e. the last window's `toSeconds`). Drop-offs in this range are already
// broken out window-by-window in The Hook, so the significant-drop detector
// ignores them to avoid double-reporting the same opening moments.
export const HOOK_COVERAGE_END_SECONDS = RETENTION_WINDOWS.reduce(
  (end, window) => Math.max(end, window.toSeconds),
  0,
)

// Performance summary for a single fixed retention window.
export interface RetentionWindowStats extends RetentionWindowConfig {
  // Retention baseline used for this window. The opening starts at 100%, and
  // each subsequent hook window starts where the preceding window ended.
  startWatchRatio: number
  // Absolute retention at the end of the window.
  endWatchRatio: number
  // Share of viewers lost across the window (startWatchRatio - endWatchRatio).
  // Clamped to >= 0; a flat or rising window reports 0.
  drop: number
  // Average relativeRetentionPerformance across the window, or null when
  // YouTube reports no relative data for these points.
  relativePerformance: number | null
  // True when the video is too short to actually reach this window, so its
  // figures are not meaningful and the UI can flag it.
  outOfRange: boolean
}

// Linearly interpolates the absolute watch ratio at an arbitrary second mark.
// The Analytics curve is sampled at fixed elapsed-time ratios (≈1% buckets), so
// a short opening window may straddle, or fall entirely between, samples on a
// long video. Interpolating gives a stable read at the exact window bounds
// rather than depending on a sample happening to land inside the window.
function watchRatioAt(sorted: RetentionPoint[], seconds: number): number {
  if (sorted.length === 0) return 0
  if (seconds <= sorted[0].timestampSeconds) return sorted[0].watchRatio
  const last = sorted[sorted.length - 1]
  if (seconds >= last.timestampSeconds) return last.watchRatio

  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (seconds <= b.timestampSeconds) {
      const span = b.timestampSeconds - a.timestampSeconds
      if (span <= 0) return b.watchRatio
      const t = (seconds - a.timestampSeconds) / span
      return a.watchRatio + t * (b.watchRatio - a.watchRatio)
    }
  }
  return last.watchRatio
}

// Computes performance for a single fixed window of the video.
export function computeRetentionWindowStats(
  points: RetentionPoint[],
  config: RetentionWindowConfig,
  durationSeconds: number,
): RetentionWindowStats | null {
  if (points.length === 0) return null

  const sorted = [...points].sort(
    (a, b) => a.timestampSeconds - b.timestampSeconds,
  )

  const startWatchRatio = watchRatioAt(sorted, config.fromSeconds)
  const endWatchRatio = watchRatioAt(sorted, config.toSeconds)

  // Average the relative-performance of the samples that fall inside the window;
  // null when YouTube reported none there.
  const within = sorted.filter(
    (p) =>
      p.timestampSeconds >= config.fromSeconds &&
      p.timestampSeconds <= config.toSeconds,
  )
  const relPerfs = within
    .map((p) => p.relativePerformance)
    .filter((v): v is number => v != null)
  const relativePerformance =
    relPerfs.length > 0
      ? relPerfs.reduce((sum, v) => sum + v, 0) / relPerfs.length
      : null

  return {
    ...config,
    startWatchRatio,
    endWatchRatio,
    drop: Math.max(0, startWatchRatio - endWatchRatio),
    relativePerformance,
    // A video that ends before the window opens never reaches it.
    outOfRange: durationSeconds > 0 && durationSeconds <= config.fromSeconds,
  }
}

// Computes performance for every configured retention window, in order. Windows
// the video is too short to reach are still returned (flagged `outOfRange`) so
// the caller can decide whether to show them.
export function computeRetentionWindows(
  points: RetentionPoint[],
  durationSeconds: number,
  windows: RetentionWindowConfig[] = RETENTION_WINDOWS,
): RetentionWindowStats[] {
  const computed = windows
    .map((config) =>
      computeRetentionWindowStats(points, config, durationSeconds),
    )
    .filter((stats): stats is RetentionWindowStats => stats !== null)

  return computed.map((stats, index) => {
    // Treat the hook cards as one continuous funnel: everybody starts the
    // video, then each following window inherits the preceding card's ending
    // retention. This avoids using a potentially sub-100% first analytics
    // sample (or a separately interpolated boundary) as the loss baseline.
    const startWatchRatio =
      index === 0 ? 1 : computed[index - 1].endWatchRatio

    return {
      ...stats,
      startWatchRatio,
      drop: Math.max(0, startWatchRatio - stats.endWatchRatio),
    }
  })
}

// Extracts the YYYY-MM-DD portion of an ISO timestamp, which is the format the
// Analytics API expects for startDate/endDate.
function isoDate(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}
