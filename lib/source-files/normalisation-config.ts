// Configuration for the source-file normalisation step (4K/original → 1080p
// proxy via Qencode). Everything here is env-driven and the whole feature is
// gated by `isNormalisationEnabled()`: with no Qencode key / destination
// configured the upload flow behaves exactly as before (the original is kept and
// served), so this can ship dark and be switched on by setting env vars.

import {
  getS3Config,
  getSourceFileBucket,
} from "@/lib/source-files/config"
import type {
  QencodeDestination,
  QencodeFormat,
} from "@/lib/qencode/qencode"

export function getQencodeApiKey(): string | null {
  return process.env.QENCODE_API_KEY || null
}

export function getQencodeBaseUrl(): string | undefined {
  return process.env.QENCODE_API_BASE_URL || undefined
}

// Target height of the proxy. Qencode keeps the aspect ratio and derives the
// width, so this is a cap on the long-or-short edge depending on orientation —
// 1080 gives a 1080p landscape / 1080-wide portrait proxy. Override if you want
// smaller (e.g. 720) cheaper proxies.
export function getProxyTargetHeight(): number {
  const raw = process.env.QENCODE_PROXY_HEIGHT
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1080
}

// Extra Qencode `format` knobs merged over the defaults, as a JSON object env
// (e.g. {"video_bitrate":"4000k","framerate":30}). Lets the proxy profile be
// tuned without a code change. Invalid JSON is ignored.
export function getProxyFormatOverrides(): Partial<QencodeFormat> {
  const raw = process.env.QENCODE_PROXY_FORMAT_OVERRIDES
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

// How long the signed read URL handed to Qencode as the transcode `source` stays
// valid. Must comfortably exceed how long Qencode might take to fetch a large
// original before encoding. Default 6 hours.
export function getNormalisationSourceExpirySeconds(): number {
  const raw = process.env.QENCODE_SOURCE_URL_EXPIRY_SECONDS
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6 * 60 * 60
}

// Public base URL of this app, used to build the callback Qencode POSTs job
// status to. Falls back to Vercel's deployment URL. Required for the callback to
// be reachable, so it's part of the enabled gate.
export function getAppBaseUrl(): string | null {
  const explicit = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/+$/, "")
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`
  return null
}

// Shared secret appended to the callback URL and checked on the way back in, so
// a stranger who guesses the callback path can't forge job-completion events.
export function getNormalisationCallbackSecret(): string | null {
  return process.env.QENCODE_CALLBACK_SECRET || null
}

// The full callback URL Qencode should POST status to, including the shared
// secret as a query param. Null when no base URL is configured.
export function getNormalisationCallbackUrl(): string | null {
  const base = getAppBaseUrl()
  if (!base) return null
  const url = new URL("/api/source-files/normalisation-callback", base)
  const secret = getNormalisationCallbackSecret()
  if (secret) url.searchParams.set("secret", secret)
  return url.toString()
}

// --- Destination (where Qencode writes the proxy: our own S3 bucket) ---
// Defaults derive from the same S3 connection the parallel-multipart upload
// path uses, so a single set of Supabase S3 credentials covers both. Each part
// is independently overridable for buckets/hosts that differ.

interface DestinationConfig {
  // Authority Qencode writes through: the host plus any sub-path the S3 API is
  // mounted under. For Supabase this is `<project>.storage.supabase.co/storage/v1/s3`
  // — the `/storage/v1/s3` prefix is mandatory; drop it and the PUT misses the
  // S3 route and Qencode reports "failed to save output".
  endpoint: string
  bucket: string
  key: string
  secret: string
}

function getDestinationConfig(): DestinationConfig | null {
  const s3 = getS3Config()
  const key = process.env.QENCODE_DEST_S3_KEY || s3?.accessKeyId
  const secret = process.env.QENCODE_DEST_S3_SECRET || s3?.secretAccessKey
  const bucket = process.env.QENCODE_DEST_S3_BUCKET || getSourceFileBucket()
  // QENCODE_DEST_S3_HOST may itself carry a sub-path (e.g. ".../storage/v1/s3").
  const endpoint =
    process.env.QENCODE_DEST_S3_HOST || endpointAuthority(s3?.endpoint)
  if (!key || !secret || !bucket || !endpoint) return null
  return { endpoint, bucket, key, secret }
}

// Derives the Qencode destination authority from an S3 endpoint URL: the host
// plus any sub-path (e.g. Supabase's `/storage/v1/s3`), with the scheme and any
// trailing slash stripped. Qencode addresses generic S3 buckets path-style as
// `s3://<authority>/<bucket>/<key>` → `https://<authority>/<bucket>/<key>`, so
// the sub-path has to ride along here or the write lands off the S3 route.
// Returns null when the endpoint can't be parsed.
function endpointAuthority(endpoint?: string): string | null {
  if (!endpoint) return null
  try {
    const url = new URL(endpoint)
    const path = url.pathname.replace(/\/+$/, "")
    return path ? `${url.host}${path}` : url.host
  } catch {
    return null
  }
}

// Builds the Qencode destination object that writes `objectPath` into our bucket.
// Throws if the destination isn't configured — callers gate on
// isNormalisationEnabled() first, so this is a programming-error guard.
export function buildQencodeDestination(
  objectPath: string,
): QencodeDestination {
  const config = getDestinationConfig()
  if (!config) {
    throw new Error("Qencode destination S3 config is incomplete")
  }
  return {
    url: `s3://${config.endpoint}/${config.bucket}/${objectPath}`,
    key: config.key,
    secret: config.secret,
    permissions: "private",
  }
}

// True only when every piece needed to run a normalisation job is present: the
// Qencode API key, a reachable callback URL, and S3 destination credentials.
// When false the upload flow skips normalisation entirely.
export function isNormalisationEnabled(): boolean {
  return (
    getQencodeApiKey() != null &&
    getNormalisationCallbackUrl() != null &&
    getDestinationConfig() != null
  )
}
