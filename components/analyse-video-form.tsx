"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleCheckIcon } from "lucide-react"

import { AnalysisProcessingOverlay } from "@/components/analysis-processing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseVideoId } from "@/lib/youtube/youtube"

interface AlreadyAnalysed {
  videoId: string
  title?: string
}

export function AnalyseVideoForm() {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [alreadyAnalysed, setAlreadyAnalysed] =
    useState<AlreadyAnalysed | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  // Once we start a brand-new analysis we show a full-screen popup right away —
  // it covers the validate request and the navigation, and hands off to the
  // route's loading.tsx (same popup) so there's no blank gap before the report.
  // Stays true through router.push; the form unmounts on navigation.
  const [isAnalysing, setIsAnalysing] = useState(false)

  // The button only lights up once the input looks like a YouTube video URL or
  // ID. Ownership of the video is confirmed server-side on submit.
  const videoId = parseVideoId(url)
  const canSubmit = videoId !== null && !isValidating

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setError(null)
    setAlreadyAnalysed(null)
    setIsValidating(true)
    setIsAnalysing(true)

    try {
      const response = await fetch("/api/validate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        videoId?: string
        title?: string
        alreadyAnalysed?: boolean
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
        setIsAnalysing(false)
        return
      }

      // Already analysed: don't re-spend quota — surface the saved results.
      if (data.alreadyAnalysed) {
        setAlreadyAnalysed({ videoId: data.videoId, title: data.title })
        setIsValidating(false)
        setIsAnalysing(false)
        return
      }

      // Leave the popup up — it carries through the navigation and is replaced by
      // the analysed-video route's matching loading.tsx popup.
      router.push(`/dashboard/analysed-video/${data.videoId}`)
    } catch {
      setError("Something went wrong. Please try again.")
      setIsValidating(false)
      setIsAnalysing(false)
    }
  }

  return (
    <>
      {isAnalysing && <AnalysisProcessingOverlay />}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            if (error) setError(null)
            if (alreadyAnalysed) setAlreadyAnalysed(null)
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
      {alreadyAnalysed && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <CircleCheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
          <span>
            You&apos;ve already analysed
            {alreadyAnalysed.title ? ` “${alreadyAnalysed.title}”` : " this video"}.
          </span>
          <Link
            href={`/dashboard/analysed-video/${alreadyAnalysed.videoId}`}
            className="font-medium text-emerald-600 underline underline-offset-4 dark:text-emerald-500"
          >
            View analysis
          </Link>
        </div>
      )}
    </form>
    </>
  )
}
