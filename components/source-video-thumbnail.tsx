"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2Icon, XIcon } from "lucide-react"

import { VideoThumbnail } from "@/components/video-thumbnail"
import {
  isPlaybackUrlStale,
  PLAYBACK_URL_MIN_RESIGN_INTERVAL_MS,
  resolvePlaybackUrlExpiry,
} from "@/lib/source-files/playback-url"

interface SourceFileResponse {
  playbackUrl?: string | null
  playbackUrlExpiresAt?: string | null
}

// A signed playback URL together with the moment it stops working, so the
// player can re-sign before a seek rather than after one fails.
interface SignedPlayback {
  url: string
  expiresAtMs: number
}

export const SOURCE_FILE_READY_EVENT = "viewlio:source-file-ready"

export function notifySourceFileReady(videoId: string) {
  window.dispatchEvent(
    new CustomEvent(SOURCE_FILE_READY_EVENT, { detail: { videoId } }),
  )
}

// Fetches (and re-fetches) a signed playback URL for a video's uploaded source
// file. Returns the URL once it is available, plus a loading flag the player
// uses while the media buffers.
//
// The URL is re-signed on three occasions, not just the first:
//
//  1. The source file finishes uploading, so there is finally one to sign.
//  2. The player is about to seek and the URL it holds is at the end of its
//     life. A report is routinely open longer than one signature lives - the
//     reader waits out a deep-analysis run, then works down the tips - and a
//     <video> element only discovers a spent signature when it issues the range
//     request a seek needs, which is precisely the click that opens a
//     highlight. Refreshing beforehand is what keeps that click working on a
//     page that has not been reloaded in an hour.
//  3. The element reports an error we have not just re-signed against, which is
//     the same expiry arriving as a load failure rather than a stalled seek.
function useSourcePlayback(videoId: string) {
  const [playback, setPlayback] = useState<SignedPlayback | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // One request in flight at a time, and never two in quick succession. Both
  // guards matter: the freshness check reads state that a response itself sets,
  // so an unguarded re-sign could chase its own tail.
  const requestRef = useRef<Promise<void> | null>(null)
  const lastRequestedAtRef = useRef(0)

  const loadSourceVideo = useCallback((): Promise<void> => {
    if (requestRef.current) return requestRef.current

    const requestedAt = Date.now()
    lastRequestedAtRef.current = requestedAt
    const request = (async () => {
      try {
        const response = await fetch(`/api/videos/${videoId}/source-file`, {
          cache: "no-store",
        })
        if (!response.ok) return

        const data = (await response.json()) as SourceFileResponse
        if (data.playbackUrl) {
          setIsLoading(true)
          setPlayback({
            url: data.playbackUrl,
            expiresAtMs: resolvePlaybackUrlExpiry(
              data.playbackUrlExpiresAt,
              requestedAt,
            ),
          })
        }
      } catch {
        // Keep the YouTube thumbnail as a fallback if playback signing fails.
      } finally {
        requestRef.current = null
      }
    })()

    requestRef.current = request
    return request
  }, [videoId])

  useEffect(() => {
    // Defer the initial request until after the effect has subscribed. The
    // response callback, rather than the effect body, owns the state update.
    const initialLoad = window.setTimeout(() => void loadSourceVideo(), 0)

    const handleSourceFileReady = (event: Event) => {
      const readyVideoId = (event as CustomEvent<{ videoId?: string }>).detail
        ?.videoId
      if (readyVideoId === videoId) void loadSourceVideo()
    }

    window.addEventListener(SOURCE_FILE_READY_EVENT, handleSourceFileReady)
    return () => {
      window.clearTimeout(initialLoad)
      window.removeEventListener(SOURCE_FILE_READY_EVENT, handleSourceFileReady)
    }
  }, [loadSourceVideo, videoId])

  // Re-sign when the URL we hold is spent, ahead of whatever is about to seek
  // against it. A URL still comfortably inside its life is left alone, so the
  // usual click costs nothing.
  const refreshExpiredPlayback = useCallback(() => {
    const now = Date.now()
    if (playback && !isPlaybackUrlStale(playback.expiresAtMs, now)) return
    if (now - lastRequestedAtRef.current < PLAYBACK_URL_MIN_RESIGN_INTERVAL_MS) {
      return
    }
    void loadSourceVideo()
  }, [loadSourceVideo, playback])

  // What the element's `error` event means depends on how recently we signed.
  // A fresh signature failing says the file itself will not play, so we drop
  // back to the thumbnail and the dismiss control. An old one failing is very
  // likely just expiry, so we re-sign and let the element remount on the new
  // URL rather than losing the player for the rest of the visit.
  const recoverFromPlaybackError = useCallback(() => {
    setIsLoading(false)
    // A re-sign already on its way will replace the source in a moment: the
    // error we just saw belongs to the URL it is replacing.
    if (requestRef.current) return
    if (
      Date.now() - lastRequestedAtRef.current <
      PLAYBACK_URL_MIN_RESIGN_INTERVAL_MS
    ) {
      setPlayback(null)
      return
    }
    void loadSourceVideo()
  }, [loadSourceVideo])

  return {
    playbackUrl: playback?.url ?? null,
    refreshExpiredPlayback,
    recoverFromPlaybackError,
    isLoading,
    setIsLoading,
  }
}

// The static packaging thumbnail shown at the top of the analysis. It no longer
// swaps itself out for the source video - playback now happens in the floating
// SourceVideoPlayer that appears over the retention chart - so this stays a
// constant reference image for the video's packaging.
export function SourceVideoThumbnail({
  thumbnailUrl,
  title,
}: {
  thumbnailUrl: string | null
  title: string
}) {
  return (
    <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-muted sm:w-64">
      <VideoThumbnail src={thumbnailUrl} alt={title} sizes="256px" />
    </div>
  )
}

// A floating source-video player that fills whatever container it is placed in.
// It plays the selected insight window (with sound) when `playbackWindow` is
// set, and previews the scrubbed moment (muted) when `scrubTime` is set. When
// neither is engaged it fades away, leaving the underlying UI (e.g. the chart)
// visible and interactive.
export function SourceVideoPlayer({
  videoId,
  thumbnailUrl,
  title,
  scrubTime,
  playbackWindow,
  onClose,
}: {
  videoId: string
  thumbnailUrl: string
  title: string
  scrubTime?: number | null
  playbackWindow?: {
    id: string
    fromSeconds: number
    toSeconds: number
  } | null
  // Dismiss the open insight (closing the player and clearing the chart
  // highlight). Wired to the same state the outside-click handler clears, so
  // the button and the click-away gesture are two ways to do the one thing.
  onClose?: () => void
}) {
  const {
    playbackUrl,
    refreshExpiredPlayback,
    recoverFromPlaybackError,
    isLoading,
    setIsLoading,
  } = useSourcePlayback(videoId)
  const videoRef = useRef<HTMLVideoElement>(null)

  // The player is only "engaged" while the user has an insight selected (a
  // playback window) or is scrubbing the chart. When neither is true we fade it
  // out rather than leaving the video paused on its last frame.
  const isEngaged = Boolean(playbackWindow) || scrubTime != null
  const isVisible = isEngaged && Boolean(playbackUrl)
  // Only intercept pointer events (for the native video controls) while an
  // insight is actively selected and on screen. During a scrub preview - or
  // whenever the player is faded out - it stays click-through so the chart
  // underneath keeps receiving pointer moves and marker clicks.
  const isInteractive = isVisible && Boolean(playbackWindow)

  // Opening a highlight is a seek, and a seek is what a spent signature fails
  // on. Ask for a fresh URL the moment one is selected: when the one we hold is
  // still good this is a no-op, and when it isn't, the new URL remounts the
  // element below and the play effect runs again against a URL that works.
  useEffect(() => {
    if (!playbackWindow) return
    refreshExpiredPlayback()
  }, [playbackWindow, refreshExpiredPlayback])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playbackUrl || !playbackWindow) return

    const playWindow = () => {
      video.muted = false
      video.currentTime = Math.max(0, playbackWindow.fromSeconds)
      void video.play().catch(() => {
        // Native controls remain available if the browser declines the
        // user-initiated play request.
      })
    }

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      playWindow()
      return
    }

    video.addEventListener("loadedmetadata", playWindow, { once: true })
    return () => video.removeEventListener("loadedmetadata", playWindow)
  }, [playbackUrl, playbackWindow])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playbackUrl || playbackWindow) return

    if (scrubTime == null) {
      video.pause()
      video.muted = false
      return
    }

    const previewAtScrubTime = () => {
      video.muted = true
      if (Math.abs(video.currentTime - scrubTime) > 0.2) {
        video.currentTime = Math.max(0, scrubTime)
      }
      void video.play().catch(() => undefined)
    }

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      previewAtScrubTime()
      return
    }

    video.addEventListener("loadedmetadata", previewAtScrubTime, { once: true })
    return () =>
      video.removeEventListener("loadedmetadata", previewAtScrubTime)
  }, [playbackUrl, playbackWindow, scrubTime])

  // With an insight selected but no uploaded source file to play, there's no
  // video to float here - yet the reader still needs an obvious way to turn the
  // highlight back off. Occupy the same sticky slot the player would, offering a
  // labelled dismiss control that mirrors the player's own close button so the
  // gesture is the same whether or not a raw file has been uploaded.
  if (!playbackUrl) {
    if (!playbackWindow || !onClose) return null
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label="Close highlights"
        >
          <XIcon className="size-4" aria-hidden="true" />
          Close highlights
        </button>
      </div>
    )
  }

  return (
    // Outer wrapper owns the float animation and pointer state; the close
    // button hangs off it so it can sit *outside* the frame without being
    // clipped by the inner `overflow-hidden`.
    <div
      className={`relative aspect-video w-full transition-[opacity,transform] duration-300 ease-out ${
        isVisible
          ? "translate-y-0 scale-100 opacity-100"
          : "translate-y-1.5 scale-[0.97] opacity-0"
      } ${isInteractive ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!isVisible}
    >
      <div className="relative size-full overflow-hidden rounded-xl border border-black/10 bg-black shadow-2xl ring-1 ring-black/5 dark:border-white/10">
        {playbackUrl && (
          <video
            ref={videoRef}
            key={playbackUrl}
            src={playbackUrl}
            poster={thumbnailUrl}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full object-cover"
            onLoadStart={() => setIsLoading(true)}
            onLoadedData={() => setIsLoading(false)}
            onCanPlay={() => setIsLoading(false)}
            onWaiting={() => setIsLoading(true)}
            // A seek that never gets its bytes is the quiet face of an expired
            // signature - no error event, just a buffer that stops filling. A
            // URL still inside its life makes this a no-op, so a genuine
            // network stall is left to recover on its own.
            onStalled={refreshExpiredPlayback}
            onPlaying={() => setIsLoading(false)}
            onTimeUpdate={(event) => {
              if (
                playbackWindow &&
                event.currentTarget.currentTime >= playbackWindow.toSeconds
              ) {
                event.currentTarget.pause()
                event.currentTarget.currentTime = playbackWindow.toSeconds
              }
            }}
            onError={recoverFromPlaybackError}
            aria-label={`Play ${title}`}
          />
        )}

        {isVisible && isLoading && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15"
            role="status"
            aria-label="Loading video"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm">
              <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
            </span>
          </div>
        )}
      </div>

      {/* A visible way to dismiss the player while an insight is open. Sits just
          outside the frame's top-left corner so it never overlaps the native
          video controls (expand/PiP top-left, mute top-right). Shown only when
          the player is interactive (an insight window is selected), so a passing
          scrub preview never puts a stray button on screen. */}
      {isInteractive && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-full top-0 z-10 mr-2 flex size-7 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label="Close video player"
        >
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
