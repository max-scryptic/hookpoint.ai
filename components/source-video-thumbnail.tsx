"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2Icon, XIcon } from "lucide-react"

import { VideoThumbnail } from "@/components/video-thumbnail"

interface SourceFileResponse {
  playbackUrl?: string | null
}

export const SOURCE_FILE_READY_EVENT = "hookpoint:source-file-ready"

export function notifySourceFileReady(videoId: string) {
  window.dispatchEvent(
    new CustomEvent(SOURCE_FILE_READY_EVENT, { detail: { videoId } }),
  )
}

// Fetches (and re-fetches, when the source file finishes uploading) a signed
// playback URL for a video's uploaded source file. Returns the URL once it is
// available, plus a loading flag the player uses while the media buffers.
function useSourcePlayback(videoId: string) {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadSourceVideo = useCallback(async () => {
    try {
      const response = await fetch(`/api/videos/${videoId}/source-file`, {
        cache: "no-store",
      })
      if (!response.ok) return

      const data = (await response.json()) as SourceFileResponse
      if (data.playbackUrl) {
        setIsLoading(true)
        setPlaybackUrl(data.playbackUrl)
      }
    } catch {
      // Keep the YouTube thumbnail as a fallback if playback signing fails.
    }
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

  return { playbackUrl, setPlaybackUrl, isLoading, setIsLoading }
}

// The static packaging thumbnail shown at the top of the analysis. It no longer
// swaps itself out for the source video — playback now happens in the floating
// SourceVideoPlayer that appears over the retention chart — so this stays a
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
  const { playbackUrl, setPlaybackUrl, isLoading, setIsLoading } =
    useSourcePlayback(videoId)
  const videoRef = useRef<HTMLVideoElement>(null)

  // The player is only "engaged" while the user has an insight selected (a
  // playback window) or is scrubbing the chart. When neither is true we fade it
  // out rather than leaving the video paused on its last frame.
  const isEngaged = Boolean(playbackWindow) || scrubTime != null
  const isVisible = isEngaged && Boolean(playbackUrl)
  // Only intercept pointer events (for the native video controls) while an
  // insight is actively selected and on screen. During a scrub preview — or
  // whenever the player is faded out — it stays click-through so the chart
  // underneath keeps receiving pointer moves and marker clicks.
  const isInteractive = isVisible && Boolean(playbackWindow)

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
  // video to float here — yet the reader still needs an obvious way to turn the
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
            onError={() => {
              setPlaybackUrl(null)
              setIsLoading(false)
            }}
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
