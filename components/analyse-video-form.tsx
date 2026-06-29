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
  // Once we start a brand-new analysis we show a full-screen popup and keep it up
  // while the analysis actually runs (the /api/analyze request). Only when that
  // finishes do we navigate to the report — which now reads from the cache the
  // analyse request just wrote, so it loads straight into the finished UI with no
  // "analysing" state. Stays true through router.push; the form unmounts on nav.
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
        return
      }

      // Already analysed: don't re-spend quota — surface the saved results.
      if (data.alreadyAnalysed) {
        setAlreadyAnalysed({ videoId: data.videoId, title: data.title })
        setIsValidating(false)
        return
      }

      // Brand-new analysis: show the popup and keep the user here while the
      // analysis runs. /api/analyze fetches everything and writes it to the
      // cache; only once it resolves do we navigate to the report (now a fast
      // cache read), so the user never lands on an empty "analysing" page.
      setIsAnalysing(true)
      const analyseResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })

      if (!analyseResponse.ok) {
        const analyseData = (await analyseResponse.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        setError(
          analyseData.error === "reconnect_required"
            ? (analyseData.message ?? "Please reconnect your YouTube account.")
            : (analyseData.error ?? "We couldn't analyse that video."),
        )
        setIsValidating(false)
        setIsAnalysing(false)
        return
      }

      // Leave the popup up — it covers the navigation until the form unmounts.
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
