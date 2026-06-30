"use client"

import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2Icon } from "lucide-react"

interface SourceFileResponse {
  playbackUrl?: string | null
}

const SOURCE_FILE_READY_EVENT = "hookpoint:source-file-ready"

export function notifySourceFileReady(videoId: string) {
  window.dispatchEvent(
    new CustomEvent(SOURCE_FILE_READY_EVENT, { detail: { videoId } }),
  )
}

export function SourceVideoThumbnail({
  videoId,
  thumbnailUrl,
  title,
  scrubTime,
  playbackWindow,
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
}) {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

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

  return (
    <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-muted sm:w-64">
      <Image
        src={thumbnailUrl}
        alt={title}
        fill
        sizes="256px"
        className={`object-cover transition-[filter,opacity] duration-300 ${
          playbackUrl && isLoading ? "scale-105 blur-md opacity-75" : ""
        }`}
      />

      {playbackUrl && (
        <video
          ref={videoRef}
          key={playbackUrl}
          src={playbackUrl}
          poster={thumbnailUrl}
          controls
          playsInline
          preload="metadata"
          className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${
            isLoading ? "opacity-0" : "opacity-100"
          }`}
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

      {playbackUrl && isLoading && (
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
  )
}
