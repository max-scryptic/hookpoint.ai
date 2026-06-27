"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseVideoId } from "@/lib/youtube/youtube"

export function AnalyseVideoForm() {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // The button only lights up once the input looks like a YouTube video URL or
  // ID. Ownership of the video is confirmed server-side on submit.
  const videoId = parseVideoId(url)
  const canSubmit = videoId !== null && !isValidating

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setError(null)
    setIsValidating(true)

    try {
      const response = await fetch("/api/validate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        videoId?: string
        error?: string
        message?: string
      }

      if (!response.ok || !data.ok || !data.videoId) {
        setError(
          data.error === "reconnect_required"
            ? (data.message ?? "Please reconnect your YouTube account.")
            : (data.error ?? "We couldn't validate that video."),
        )
        setIsValidating(false)
        return
      }

      router.push(`/dashboard/analyse-video/${data.videoId}`)
    } catch {
      setError("Something went wrong. Please try again.")
      setIsValidating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            if (error) setError(null)
          }}
          placeholder="Paste a YouTube video URL from your channel"
          aria-invalid={error ? true : undefined}
          aria-label="YouTube video URL"
          className="h-9"
        />
        <Button type="submit" size="lg" disabled={!canSubmit}>
          {isValidating ? "Checking…" : "Analyse Video"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
