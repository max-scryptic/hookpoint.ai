import { describe, expect, it } from "vitest"

import {
  isPlaybackUrlStale,
  PLAYBACK_URL_REFRESH_MARGIN_MS,
  PLAYBACK_URL_TTL_SECONDS,
  playbackUrlExpiryFrom,
  resolvePlaybackUrlExpiry,
} from "@/lib/source-files/playback-url"

const SIGNED_AT = Date.parse("2026-08-26T12:00:00.000Z")
const TTL_MS = PLAYBACK_URL_TTL_SECONDS * 1000

describe("playbackUrlExpiryFrom", () => {
  it("expires one full TTL after signing", () => {
    expect(playbackUrlExpiryFrom(SIGNED_AT)).toBe(SIGNED_AT + TTL_MS)
  })
})

describe("resolvePlaybackUrlExpiry", () => {
  it("uses the expiry the route reported", () => {
    const reported = new Date(SIGNED_AT + 10 * 60 * 1000).toISOString()
    expect(resolvePlaybackUrlExpiry(reported, SIGNED_AT)).toBe(
      SIGNED_AT + 10 * 60 * 1000,
    )
  })

  it("falls back to the client's own reckoning when none is reported", () => {
    expect(resolvePlaybackUrlExpiry(null, SIGNED_AT)).toBe(SIGNED_AT + TTL_MS)
    expect(resolvePlaybackUrlExpiry(undefined, SIGNED_AT)).toBe(
      SIGNED_AT + TTL_MS,
    )
  })

  it("falls back when the reported expiry cannot be parsed", () => {
    expect(resolvePlaybackUrlExpiry("not a date", SIGNED_AT)).toBe(
      SIGNED_AT + TTL_MS,
    )
  })

  it("never trusts a reported expiry beyond the mint window", () => {
    const optimistic = new Date(SIGNED_AT + 10 * TTL_MS).toISOString()
    expect(resolvePlaybackUrlExpiry(optimistic, SIGNED_AT)).toBe(
      SIGNED_AT + TTL_MS,
    )
  })
})

describe("isPlaybackUrlStale", () => {
  const expiresAt = SIGNED_AT + TTL_MS

  it("is fresh well inside its life", () => {
    expect(isPlaybackUrlStale(expiresAt, SIGNED_AT)).toBe(false)
    expect(isPlaybackUrlStale(expiresAt, expiresAt - TTL_MS / 2)).toBe(false)
  })

  it("is stale once inside the refresh margin", () => {
    expect(
      isPlaybackUrlStale(expiresAt, expiresAt - PLAYBACK_URL_REFRESH_MARGIN_MS),
    ).toBe(true)
    expect(
      isPlaybackUrlStale(
        expiresAt,
        expiresAt - PLAYBACK_URL_REFRESH_MARGIN_MS + 1,
      ),
    ).toBe(true)
  })

  it("is fresh just outside the refresh margin", () => {
    expect(
      isPlaybackUrlStale(
        expiresAt,
        expiresAt - PLAYBACK_URL_REFRESH_MARGIN_MS - 1,
      ),
    ).toBe(false)
  })

  it("is stale once the signature has lapsed", () => {
    expect(isPlaybackUrlStale(expiresAt, expiresAt + 1)).toBe(true)
    // The case behind the bug: a report left open for hours, then a highlight
    // clicked against the URL the first render signed.
    expect(isPlaybackUrlStale(expiresAt, SIGNED_AT + 3 * TTL_MS)).toBe(true)
  })
})
