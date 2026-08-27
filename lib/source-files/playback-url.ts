// How the report's floating player and the source-file route agree on the life
// of a signed playback URL.
//
// The URL handed to the <video> element is a short-lived signature over a
// private storage object. The element does not download the file up front: it
// pulls metadata on mount and then issues fresh range requests every time the
// reader seeks - which is exactly what opening a highlight does. So a signature
// that has lapsed since the page was rendered does not fail loudly at load
// time; it fails on the seek, and the player sits on its poster looking broken.
//
// A report outliving one signature is the normal case rather than the edge one:
// the reader opens it, waits out a deep-analysis run, works through the tips,
// and only then clicks a highlight. These helpers let the client notice that
// its URL is spent and re-sign before playing, instead of handing the element a
// URL it will 403 on.
//
// Deliberately free of `process.env` and of any server-only import so the
// browser bundle can share it with the route that mints the URLs.

// How long a signed playback URL is minted for.
export const PLAYBACK_URL_TTL_SECONDS = 60 * 60

// How much of that life to leave unused. A seek issues new range requests, and
// one started this close to the deadline could still be in flight when the
// signature lapses, so a URL inside the margin counts as spent.
export const PLAYBACK_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000

// Floor on how often the client will ask for a fresh signature. The staleness
// check below reads state that a response itself sets, so without a floor a
// reply that somehow still read as spent could put the client in a re-sign
// loop against its own storage.
export const PLAYBACK_URL_MIN_RESIGN_INTERVAL_MS = 15 * 1000

// When a URL signed at `signedAtMs` stops being valid, in epoch milliseconds.
// Used as the client's own reckoning when a response carries no expiry of its
// own (an older deployment answering a newer bundle), so a URL still ages out
// rather than being trusted forever.
export function playbackUrlExpiryFrom(signedAtMs: number): number {
  return signedAtMs + PLAYBACK_URL_TTL_SECONDS * 1000
}

// Reads the expiry the route reported, falling back to the client's own
// reckoning when it is missing or unparseable. Never returns a value that
// outlives the fallback: a server claiming a longer life than the TTL would
// only delay the re-sign past the point the URL actually dies.
export function resolvePlaybackUrlExpiry(
  reportedExpiresAt: string | null | undefined,
  signedAtMs: number,
): number {
  const fallback = playbackUrlExpiryFrom(signedAtMs)
  if (!reportedExpiresAt) return fallback
  const reported = Date.parse(reportedExpiresAt)
  if (Number.isNaN(reported)) return fallback
  return Math.min(reported, fallback)
}

// Whether a URL expiring at `expiresAtMs` is too close to the end of its life
// to start a seek against.
export function isPlaybackUrlStale(
  expiresAtMs: number,
  now: number = Date.now(),
): boolean {
  return expiresAtMs - now <= PLAYBACK_URL_REFRESH_MARGIN_MS
}
