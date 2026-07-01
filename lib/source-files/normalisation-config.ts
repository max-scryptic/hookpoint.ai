// Configuration for the source-file normalisation step (4K/original → 1080p
// proxy via Qencode). Everything here is env-driven and the whole feature is
// gated by `isNormalisationEnabled()`: with no Qencode key / S3 connection
// configured the upload flow behaves exactly as before (the original is kept and
// served), so this can ship dark and be switched on by setting env vars.
//
// Qencode is not handed a destination to write to directly: a prior version of
// this feature had it PUT the proxy straight into our S3 bucket, but that write
// silently landed as a 0-byte object against Supabase's S3-compatible endpoint
// (Qencode's dashboard reported success regardless). Instead Qencode holds the
// finished proxy on its own temporary storage for 24h and hands back a download
// URL in the completion callback; we pull it into our bucket ourselves with the
// same S3 client already used for uploads.

import { getS3Config } from "@/lib/source-files/config"
import type { QencodeFormat } from "@/lib/qencode/qencode"

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

// True only when every piece needed to run a normalisation job is present: the
// Qencode API key, a reachable callback URL, and an S3 connection to pull the
// finished proxy into. When false the upload flow skips normalisation entirely.
export function isNormalisationEnabled(): boolean {
  return (
    getQencodeApiKey() != null &&
    getNormalisationCallbackUrl() != null &&
    getS3Config() != null
  )
}
