// YouTube Reporting API client for thumbnail reach (impressions + CTR).
//
// These metrics are NOT served by the synchronous YouTube Analytics API
// (reports.query) — every metrics/dimensions/filters shape there 400s "query is
// not supported". They live only in the YouTube *Reporting* API, which is a
// different, asynchronous product: you register a reporting job once, YouTube
// generates a daily CSV per day (first one lands ~24-48h after the job is
// created, backfilled ~30 days), and you list + download those CSVs.
//
// The `channel_reach_basic_a1` report gives, per day and per video:
//   date, channel_id, video_id, video_thumbnail_impressions,
//   video_thumbnail_impressions_ctr
// We aggregate every available daily report into a per-video lifetime-within-
// retention figure: summed impressions and impression-weighted CTR.
//
// Everything here is best-effort. A missing job, a report that hasn't been
// generated yet, or a failed download all resolve to null reach so the caller's
// KPI totals are never affected — reach simply stays blank until a report lands.

const REPORTING_API = "https://youtubereporting.googleapis.com/v1"

// The bulk report type carrying daily thumbnail impressions and CTR by video.
const REACH_REPORT_TYPE_ID = "channel_reach_basic_a1"

// Name shown for the job in the API; identifies the one Hookpoint creates.
const REACH_JOB_NAME = "Hookpoint thumbnail reach"

// Bound the work a single refresh does. Reports are daily, retained ~60 days, so
// this comfortably covers the full available window while capping downloads for
// channels that have accumulated many reports.
const MAX_REPORTS = 120
const DOWNLOAD_CONCURRENCY = 8

// Guards the pagination loops against a runaway nextPageToken.
const MAX_PAGES = 50

export interface ThumbnailReach {
  impressions: number | null
  impressionClickThroughRate: number | null
}

interface ReportMeta {
  startTime: string
  createTime: string
  downloadUrl: string
}

async function reportingGet(
  accessToken: string,
  url: string,
): Promise<Response> {
  return fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })
}

// Finds Hookpoint's reach reporting job, creating it if absent. Returns the job
// id, or null if the job can't be found or created (best-effort). Creating the
// job is what starts YouTube generating daily reports, so a brand-new channel
// returns an id here but has no reports to download yet.
async function ensureReachJob(accessToken: string): Promise<string | null> {
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${REPORTING_API}/jobs`)
    if (pageToken) url.searchParams.set("pageToken", pageToken)
    const response = await reportingGet(accessToken, url.toString())
    if (!response.ok) {
      console.error(
        `Reporting API jobs.list failed (${response.status}): ${await response.text()}`,
      )
      return null
    }
    const json = (await response.json()) as {
      jobs?: Array<{ id?: string; reportTypeId?: string }>
      nextPageToken?: string
    }
    const existing = (json.jobs ?? []).find(
      (job) => job.reportTypeId === REACH_REPORT_TYPE_ID && job.id,
    )
    if (existing?.id) return existing.id
    if (!json.nextPageToken) break
    pageToken = json.nextPageToken
  }

  // No existing job — register one. YouTube starts generating reports now.
  const createResponse = await fetch(`${REPORTING_API}/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      reportTypeId: REACH_REPORT_TYPE_ID,
      name: REACH_JOB_NAME,
    }),
  })
  if (!createResponse.ok) {
    console.error(
      `Reporting API jobs.create failed (${createResponse.status}): ${await createResponse.text()}`,
    )
    return null
  }
  const created = (await createResponse.json()) as { id?: string }
  return created.id ?? null
}

// Lists every report the job has produced, newest first, deduped to one report
// per day (YouTube can reissue a corrected report for a day — keep the latest
// createTime so a day is never double-counted).
async function listReachReports(
  accessToken: string,
  jobId: string,
): Promise<ReportMeta[]> {
  const latestByDay = new Map<string, ReportMeta>()
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${REPORTING_API}/jobs/${jobId}/reports`)
    if (pageToken) url.searchParams.set("pageToken", pageToken)
    const response = await reportingGet(accessToken, url.toString())
    if (!response.ok) {
      console.error(
        `Reporting API reports.list failed (${response.status}): ${await response.text()}`,
      )
      break
    }
    const json = (await response.json()) as {
      reports?: Array<{
        startTime?: string
        createTime?: string
        downloadUrl?: string
      }>
      nextPageToken?: string
    }
    for (const report of json.reports ?? []) {
      if (!report.downloadUrl || !report.startTime) continue
      const day = report.startTime
      const createTime = report.createTime ?? ""
      const current = latestByDay.get(day)
      if (!current || createTime > current.createTime) {
        latestByDay.set(day, {
          startTime: day,
          createTime,
          downloadUrl: report.downloadUrl,
        })
      }
    }
    if (!json.nextPageToken) break
    pageToken = json.nextPageToken
  }

  return [...latestByDay.values()]
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .slice(0, MAX_REPORTS)
}

// Accumulates impressions and impression-weighted CTR per video across a set of
// daily report CSVs.
interface ReachAccumulator {
  impressions: number
  weightedCtr: number
}

// Parses one report CSV, folding its rows into the per-video accumulator. Rows
// are located by header name so column order never matters; a report missing the
// reach columns contributes nothing.
function accumulateReport(
  csv: string,
  totals: Map<string, ReachAccumulator>,
): void {
  const lines = csv.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length < 2) return
  const headers = lines[0].split(",")
  const videoIdx = headers.indexOf("video_id")
  const impressionsIdx = headers.indexOf("video_thumbnail_impressions")
  const ctrIdx = headers.indexOf("video_thumbnail_impressions_ctr")
  if (videoIdx === -1 || impressionsIdx === -1 || ctrIdx === -1) return

  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(",")
    const videoId = cells[videoIdx]
    if (!videoId) continue
    const impressions = Number(cells[impressionsIdx])
    const ctr = Number(cells[ctrIdx])
    if (!Number.isFinite(impressions) || impressions <= 0) continue
    const entry = totals.get(videoId) ?? { impressions: 0, weightedCtr: 0 }
    entry.impressions += impressions
    if (Number.isFinite(ctr)) entry.weightedCtr += impressions * ctr
    totals.set(videoId, entry)
  }
}

// Downloads reports with bounded concurrency and folds them all into one
// per-video reach map. A single failed download is skipped, not fatal.
async function aggregateReports(
  accessToken: string,
  reports: ReportMeta[],
): Promise<Map<string, ReachAccumulator>> {
  const totals = new Map<string, ReachAccumulator>()
  for (let start = 0; start < reports.length; start += DOWNLOAD_CONCURRENCY) {
    const batch = reports.slice(start, start + DOWNLOAD_CONCURRENCY)
    const csvs = await Promise.all(
      batch.map(async (report) => {
        try {
          const response = await reportingGet(accessToken, report.downloadUrl)
          if (!response.ok) return null
          return await response.text()
        } catch (error) {
          console.error("Failed to download reach report", error)
          return null
        }
      }),
    )
    for (const csv of csvs) {
      if (csv) accumulateReport(csv, totals)
    }
  }
  return totals
}

// Builds the whole-channel reach map: every video that appears in the available
// reports, with summed impressions and impression-weighted CTR. Empty when the
// job has no reports yet (freshly created) or the API is unavailable.
async function fetchChannelReach(
  accessToken: string,
): Promise<Map<string, ThumbnailReach>> {
  const result = new Map<string, ThumbnailReach>()
  const jobId = await ensureReachJob(accessToken)
  if (!jobId) return result

  const reports = await listReachReports(accessToken, jobId)
  if (reports.length === 0) return result

  const totals = await aggregateReports(accessToken, reports)
  for (const [videoId, entry] of totals) {
    result.set(videoId, {
      impressions: entry.impressions,
      impressionClickThroughRate:
        entry.impressions > 0 ? entry.weightedCtr / entry.impressions : null,
    })
  }
  return result
}

// Thumbnail reach for a single owned video, aggregated across every available
// daily report. Never throws: any failure, or a video that hasn't appeared in a
// report yet, resolves to null so callers degrade gracefully.
export async function getVideoThumbnailReach(
  accessToken: string,
  videoId: string,
): Promise<ThumbnailReach | null> {
  try {
    const channelReach = await fetchChannelReach(accessToken)
    return channelReach.get(videoId) ?? null
  } catch (error) {
    console.error("Failed to fetch thumbnail reach", error)
    return null
  }
}
